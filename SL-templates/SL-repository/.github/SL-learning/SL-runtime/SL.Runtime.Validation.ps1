Set-StrictMode -Version Latest

function New-SLValidationIssue {
    param(
        [Parameter(Mandatory)][ValidateSet('error', 'warning')][string] $Severity,
        [Parameter(Mandatory)][string] $Code,
        [Parameter(Mandatory)][string] $Message,
        [AllowNull()][string] $Path
    )

    $Issue = [ordered] @{ severity = $Severity; code = $Code }
    if ($Path) { $Issue['path'] = $Path }
    $Issue['message'] = $Message
    return [pscustomobject] $Issue
}

function Test-SLArtifactRecord {
    param([Parameter(Mandatory)][object] $Artifact)

    return (
        [string] $Artifact.id -cmatch '^SL-[A-Z0-9][A-Z0-9-]*$' -and
        [string] $Artifact.artifactType -cin @('lesson', 'instruction', 'skill', 'system') -and
        [string] $Artifact.classification -cin @('system', 'evidence', 'promoted') -and
        [string] $Artifact.managedBy -ceq 'SL-Repo' -and
        [string] $Artifact.status -cin @('active', 'generated', 'probation', 'raw', 'distilled', 'promotion-candidate', 'promoted', 'stale', 'quarantined', 'superseded', 'deleted') -and
        $Artifact.pinned -is [bool] -and
        (Test-SLProperty $Artifact 'relatedTo')
    )
}

function Test-SLLifecycleEventIntegrity {
    param([Parameter(Mandatory)][object] $Event)

    if (
        $Event.schemaVersion -ne 1 -or
        [string] $Event.eventId -cnotmatch '^SL-EVENT-[A-F0-9]{32}$' -or
        [string] $Event.idempotencyKey -cnotmatch '^sha256:[a-f0-9]{64}$'
    ) { return $false }
    $Source = [ordered] @{
        schemaVersion = 1
        timestamp = $Event.timestamp
        artifactId = $Event.artifactId
        action = $Event.action
    }
    foreach ($Name in @('reason', 'fromStatus', 'toStatus', 'fromPath', 'toPath')) {
        if (Test-SLProperty $Event $Name) { $Source[$Name] = Get-SLProperty $Event $Name }
    }
    $Expected = New-SLLifecycleEvent ([pscustomobject] $Source)
    return $Expected.eventId -ceq $Event.eventId -and $Expected.idempotencyKey -ceq $Event.idempotencyKey
}

function Test-SLRepository {
    param(
        [Parameter(Mandatory)][string] $Root,
        [switch] $IncludeRuntime
    )

    $Issues = [System.Collections.Generic.List[object]]::new()
    try { [void] (Get-SLConfig $Root) } catch {
        $Issues.Add((New-SLValidationIssue error 'config-schema' $_.Exception.Message $script:SLConfigPath))
    }
    $ScopeCatalog = $null
    try { $ScopeCatalog = Get-SLScopeCatalog $Root } catch {
        $Issues.Add((New-SLValidationIssue error 'scope-catalog-invalid' $_.Exception.Message $script:SLScopeCatalogCandidates[0]))
    }
    $Registry = $null
    try { $Registry = Get-SLRegistry $Root } catch {
        $Issues.Add((New-SLValidationIssue error 'scope-state-load' $_.Exception.Message $script:SLStateCatalogPath))
        $Registry = [pscustomobject] @{ schemaVersion = 1; artifacts = @() }
    }
    $StateCatalog = $null
    try { $StateCatalog = Get-SLStateCatalog $Root } catch {
        $Issues.Add((New-SLValidationIssue error 'state-catalog-schema' $_.Exception.Message $script:SLStateCatalogPath))
        $StateCatalog = [pscustomobject] @{ schemaVersion = 1; scopes = @() }
    }
    $CatalogKeys = @{}
    $CatalogShards = @{}
    foreach ($Entry in @($StateCatalog.scopes)) {
        try {
            $Expected = Get-SLStateCatalogEntry $Entry.scope
            if ((ConvertTo-SLCanonicalJson $Expected) -cne (ConvertTo-SLCanonicalJson $Entry)) {
                $Issues.Add((New-SLValidationIssue error 'scope-shard-containment' 'Scope catalog paths do not match their deterministic shard.' $script:SLStateCatalogPath))
                continue
            }
            $Key = Get-SLScopeKey $Entry.scope
            if ($CatalogKeys.ContainsKey($Key)) {
                $Issues.Add((New-SLValidationIssue error 'scope-catalog-duplicate' "Scope $Key appears more than once." $script:SLStateCatalogPath))
            }
            $CatalogKeys[$Key] = $true
            if ($CatalogShards.ContainsKey([string] $Entry.shard) -and $CatalogShards[[string] $Entry.shard] -cne $Key) {
                $Issues.Add((New-SLValidationIssue error 'scope-shard-collision' "Normalized shard $($Entry.shard) is shared by multiple scopes." $script:SLStateCatalogPath))
            }
            $CatalogShards[[string] $Entry.shard] = $Key
            if ($null -ne $ScopeCatalog) {
                $Declared = @($ScopeCatalog.scopes | Where-Object { (Get-SLScopeKey (Get-SLScopeDescriptor $_)) -ceq $Key }).Count -gt 0
                if (-not $Declared) {
                    $Issues.Add((New-SLValidationIssue error 'scope-state-orphan' "State shard $($Entry.shard) references an undeclared scope." $script:SLStateCatalogPath))
                }
            }
            foreach ($Path in @($Entry.registryPath, $Entry.indexPath, $Entry.projectionPath, $Entry.usageEventsPath)) {
                [void] (Resolve-SLContainedPath -Root $Root -RelativePath ([string] $Path))
            }
            if (-not [IO.File]::Exists((Resolve-SLContainedPath -Root $Root -RelativePath ([string] $Entry.registryPath)))) {
                $Issues.Add((New-SLValidationIssue error 'scope-registry-missing' 'Scope registry shard is missing.' ([string] $Entry.registryPath)))
            }
            else {
                $Shard = Read-SLJson -Root $Root -RelativePath ([string] $Entry.registryPath)
                if ($Shard.schemaVersion -ne 1 -or (Get-SLScopeKey $Shard.scope) -cne $Key) {
                    $Issues.Add((New-SLValidationIssue error 'scope-registry-schema' 'Scope registry descriptor does not match its catalog entry.' ([string] $Entry.registryPath)))
                }
                foreach ($ShardArtifact in @($Shard.artifacts | Where-Object { $null -ne $_ })) {
                    if ((Get-SLScopeKey (Get-SLProperty $ShardArtifact 'scope' $Shard.scope)) -cne $Key) {
                        $Issues.Add((New-SLValidationIssue error 'scope-registry-artifact' "Artifact $($ShardArtifact.id) belongs to a different scope." ([string] $Entry.registryPath)))
                    }
                }
            }
            $IndexPath = Resolve-SLContainedPath -Root $Root -RelativePath ([string] $Entry.indexPath)
            if (-not [IO.File]::Exists($IndexPath)) {
                $Issues.Add((New-SLValidationIssue error 'scope-index-missing' 'Scope discovery index is missing.' ([string] $Entry.indexPath)))
            }
            else {
                $StoredIndex = Read-SLJson -Root $Root -RelativePath ([string] $Entry.indexPath)
                $ExpectedArtifacts = [System.Collections.Generic.List[object]]::new()
                foreach ($Artifact in @($Registry.artifacts)) {
                    if (
                        (Get-SLScopeKey (Get-SLProperty $Artifact 'scope' $script:SLDefaultScope)) -cne $Key -or
                        -not $Artifact.path -or
                        $Artifact.classification -ceq 'system' -or
                        [string] $Artifact.status -cnotin $script:SLActiveStatuses -or
                        -not [IO.File]::Exists((Resolve-SLContainedPath -Root $Root -RelativePath ([string] $Artifact.path)))
                    ) { continue }
                    if ($Artifact.classification -ceq 'promoted' -and $Artifact.status -ceq 'active' -and -not (Test-SLPromotionEvaluationCurrent $Root $Artifact)) { continue }
                    $Indexed = [ordered] @{
                        id = $Artifact.id
                        path = $Artifact.path
                        artifactType = $Artifact.artifactType
                        status = $Artifact.status
                    }
                    if (Test-SLProperty $Artifact 'trigger') { $Indexed['trigger'] = Sort-SLOrdinal @($Artifact.trigger) }
                    $Indexed['relatedTo'] = Sort-SLOrdinal @($Artifact.relatedTo)
                    if (Test-SLProperty $Artifact 'dependsOn') { $Indexed['dependsOn'] = Sort-SLOrdinal @($Artifact.dependsOn) }
                    $ExpectedArtifacts.Add([pscustomobject] $Indexed)
                }
                [object[]] $ExpectedArtifactArray = @($ExpectedArtifacts | Sort-Object -Stable -Property @{ Expression = { [string] $_.id } })
                $ExpectedIndex = [pscustomobject] @{ schemaVersion = 2; scope = $Entry.scope; artifacts = $ExpectedArtifactArray }
                if ((ConvertTo-SLCanonicalJson $StoredIndex) -cne (ConvertTo-SLCanonicalJson $ExpectedIndex)) {
                    $Issues.Add((New-SLValidationIssue error 'scope-index-drift' 'Scope discovery index is stale; run project after merging.' ([string] $Entry.indexPath)))
                }
            }
        }
        catch {
            $Issues.Add((New-SLValidationIssue error 'scope-shard-containment' $_.Exception.Message $script:SLStateCatalogPath))
        }
    }
    if ($null -ne $ScopeCatalog) {
        try {
            $ExpectedScopes = @($ScopeCatalog.scopes | ForEach-Object { Get-SLScopeDescriptor $_ })
            foreach ($Artifact in @($Registry.artifacts)) { $ExpectedScopes += Normalize-SLScope (Get-SLProperty $Artifact 'scope' $script:SLDefaultScope) }
            $ExpectedCatalog = New-SLStateCatalog $ExpectedScopes
            if ((ConvertTo-SLCanonicalJson $ExpectedCatalog) -cne (ConvertTo-SLCanonicalJson $StateCatalog)) {
                $Issues.Add((New-SLValidationIssue error 'state-catalog-drift' 'Scope state catalog is stale; run project after merging.' $script:SLStateCatalogPath))
            }
        }
        catch {
            $Issues.Add((New-SLValidationIssue error 'state-catalog-invalid' $_.Exception.Message $script:SLStateCatalogPath))
        }
    }
    $Ids = @{}
    $Paths = @{}
    foreach ($Artifact in @($Registry.artifacts)) {
        if (-not (Test-SLArtifactRecord $Artifact)) {
            $Issues.Add((New-SLValidationIssue error 'registry-schema' "Artifact $($Artifact.id) has invalid typed fields." $script:SLLegacyRegistryPath))
        }
        if ($Ids.ContainsKey([string] $Artifact.id)) {
            $Issues.Add((New-SLValidationIssue error 'duplicate-id' "Duplicate artifact ID: $($Artifact.id)" $null))
        }
        $Ids[[string] $Artifact.id] = $true
        $Scope = Normalize-SLScope (Get-SLProperty $Artifact 'scope' $script:SLDefaultScope)
        if ($null -ne $ScopeCatalog -and @($ScopeCatalog.scopes | Where-Object { (Get-SLScopeKey (Get-SLScopeDescriptor $_)) -ceq (Get-SLScopeKey $Scope) }).Count -eq 0) {
            $Issues.Add((New-SLValidationIssue error 'artifact-scope-invalid' "Artifact $($Artifact.id) references undeclared scope $($Scope.id):$($Scope.path)." ([string] $Artifact.path)))
        }
        if ($Artifact.path) {
            try {
                $Normalized = ConvertTo-SLNormalizedPath ([string] $Artifact.path)
                if ($Normalized -cne $Artifact.path) {
                    $Issues.Add((New-SLValidationIssue error 'non-normalized-path' 'Registry paths must use normalized repository-relative separators.' ([string] $Artifact.path)))
                }
                if ($Paths.ContainsKey($Normalized)) {
                    $Issues.Add((New-SLValidationIssue error 'duplicate-path' 'Multiple registry entries own the same path.' $Normalized))
                }
                $Paths[$Normalized] = $true
                $Absolute = Resolve-SLContainedPath -Root $Root -RelativePath $Normalized
                if (-not [IO.File]::Exists($Absolute) -and $Artifact.status -cne 'deleted') {
                    $Issues.Add((New-SLValidationIssue error 'missing-artifact' "Registered artifact $($Artifact.id) does not exist." $Normalized))
                }
                elseif ([IO.File]::Exists($Absolute)) {
                    $Content = Read-SLSafeText -Root $Root -RelativePath $Normalized
                    if ($Artifact.classification -cne 'system' -and (Test-SLSensitiveText $Content)) {
                        $Issues.Add((New-SLValidationIssue error 'sensitive-content' 'Potential secret, credential, or absolute user-profile path detected.' $Normalized))
                    }
                    if ($Normalized.EndsWith('.md') -and $Artifact.classification -cne 'system') {
                        try { [void] (Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact) } catch {
                            $Issues.Add((New-SLValidationIssue error 'artifact-ownership-mismatch' $_.Exception.Message $Normalized))
                        }
                    }
                    if ($Artifact.classification -ceq 'promoted' -and $Artifact.status -ceq 'active' -and -not (Test-SLPromotionEvaluationCurrent $Root $Artifact)) {
                        $Issues.Add((New-SLValidationIssue error 'promotion-evaluation-stale' 'Active promotion evaluation is missing, failed, or no longer matches artifact and contract content.' $Normalized))
                    }
                    if ($Artifact.classification -ceq 'promoted' -and $Artifact.status -ceq 'probation' -and (Get-SLProperty (Get-SLProperty $Artifact 'promotionEvaluation') 'status') -ceq 'passed' -and -not (Test-SLPromotionEvaluationCurrent $Root $Artifact)) {
                        $Issues.Add((New-SLValidationIssue error 'promotion-evaluation-stale' 'Probation promotion content changed after its passing evaluation.' $Normalized))
                    }
                }
            }
            catch {
                $Issues.Add((New-SLValidationIssue error 'unsafe-artifact-path' $_.Exception.Message ([string] $Artifact.path)))
            }
        }
        foreach ($Related in @($Artifact.relatedTo) + @((Get-SLProperty $Artifact 'dependsOn' @()))) {
            if (-not @($Registry.artifacts | Where-Object id -ceq $Related).Count) {
                $Issues.Add((New-SLValidationIssue error 'broken-reference' "$($Artifact.id) references unknown artifact $Related." ([string] $Artifact.path)))
            }
        }
        if ($Artifact.classification -ceq 'promoted') {
            $Sources = @((Get-SLProperty $Artifact 'dependsOn' @()))
            if ($Sources.Count -eq 0 -or @($Sources | Where-Object {
                $SourceId = $_
                @($Registry.artifacts | Where-Object {
                    $_.id -ceq $SourceId -and $_.classification -ceq 'evidence' -and [string] $_.status -cin $script:SLActiveStatuses -and $_.path
                }).Count -eq 0
            }).Count -gt 0) {
                $Issues.Add((New-SLValidationIssue error 'promotion-source' 'Promoted artifacts must depend on available active evidence source IDs.' ([string] $Artifact.path)))
            }
        }
    }
    $UsageEvents = @()
    try { $UsageEvents = @(Get-SLUsageEvents $Root) } catch {
        $Issues.Add((New-SLValidationIssue error 'usage-event-json' $_.Exception.Message $script:SLUsageRoot))
    }
    $EventIds = @{}
    $Idempotency = @{}
    $Applications = @{}
    foreach ($Event in $UsageEvents) {
        $Path = Get-SLUsageEventPath $Event
        if ($EventIds.ContainsKey([string] $Event.eventId)) {
            $Issues.Add((New-SLValidationIssue error 'usage-event-duplicate-id' "Usage event ID is already present at $($EventIds[[string] $Event.eventId])." $Path))
        }
        $EventIds[[string] $Event.eventId] = $Path
        if ($Idempotency.ContainsKey([string] $Event.idempotencyKey) -and $Idempotency[[string] $Event.idempotencyKey] -cne $Path) {
            $Issues.Add((New-SLValidationIssue error 'usage-event-duplicate-idempotency' "Usage idempotency key is already present at $($Idempotency[[string] $Event.idempotencyKey])." $Path))
        }
        $Idempotency[[string] $Event.idempotencyKey] = $Path
        if (-not $Ids.ContainsKey([string] $Event.artifactId)) {
            $Issues.Add((New-SLValidationIssue error 'usage-event-artifact' "Usage event references unknown artifact $($Event.artifactId)." $Path))
        }
        if ($null -ne $ScopeCatalog -and @($ScopeCatalog.scopes | Where-Object { (Get-SLScopeKey (Get-SLScopeDescriptor $_)) -ceq (Get-SLScopeKey $Event.scope) }).Count -eq 0) {
            $Issues.Add((New-SLValidationIssue error 'usage-event-scope' 'Usage event references an undeclared source scope.' $Path))
        }
        if (-not $Applications.ContainsKey([string] $Event.applicationId)) { $Applications[[string] $Event.applicationId] = [System.Collections.Generic.List[object]]::new() }
        $Applications[[string] $Event.applicationId].Add($Event)
    }
    foreach ($ApplicationId in $Applications.Keys) {
        $ApplicationEvents = @($Applications[$ApplicationId])
        $Identities = @($ApplicationEvents | ForEach-Object {
            "$($_.artifactId)$([char]0)$($_.artifactVersion)$([char]0)$($_.taskRunId)$([char]0)$(Get-SLScopeKey $_.scope)"
        } | Sort-Object -Unique)
        if ($Identities.Count -ne 1) {
            $Issues.Add((New-SLValidationIssue error 'usage-application-identity' "Application $ApplicationId is bound to conflicting artifact identity data." $null))
        }
        foreach ($StageGroup in @($ApplicationEvents | Group-Object stage)) {
            if ($StageGroup.Count -gt 1) {
                $Issues.Add((New-SLValidationIssue error 'usage-application-duplicate-stage' "Application $ApplicationId has $($StageGroup.Count) distinct $($StageGroup.Name) events." $null))
            }
        }
        $Outcomes = @($ApplicationEvents | Where-Object { $_.stage -cin @('outcome', 'verified') } | ForEach-Object outcome | Sort-Object -Unique)
        if ($Outcomes.Count -gt 1) {
            $Issues.Add((New-SLValidationIssue error 'usage-application-outcome' "Application $ApplicationId has conflicting terminal outcomes." $null))
        }
    }
    $ExpectedProjections = @(Project-SLUsageEvents $UsageEvents)
    foreach ($Entry in @($StateCatalog.scopes)) {
        $ProjectionPath = Resolve-SLContainedPath -Root $Root -RelativePath ([string] $Entry.projectionPath
        )
        if (-not [IO.File]::Exists($ProjectionPath)) {
            $Issues.Add((New-SLValidationIssue error 'usage-projection-missing' 'Usage projection shard is missing.' ([string] $Entry.projectionPath)))
            continue
        }
        try {
            $Stored = Read-SLJson -Root $Root -RelativePath ([string] $Entry.projectionPath)
            [object[]] $Expected = @($ExpectedProjections | Where-Object { (Get-SLScopeKey $_.scope) -ceq (Get-SLScopeKey $Entry.scope) })
            [object[]] $StoredProjections = @($Stored.projections | Where-Object { $null -ne $_ })
            $ProjectionMatches = (
                $Expected.Count -eq $StoredProjections.Count -and
                (
                    $Expected.Count -eq 0 -or
                    (ConvertTo-SLCanonicalJson -Value (, $StoredProjections)) -ceq (ConvertTo-SLCanonicalJson -Value (, $Expected))
                )
            )
            if (-not $ProjectionMatches) {
                $Issues.Add((New-SLValidationIssue error 'usage-projection-drift' 'Usage projection is stale; run project after merging.' ([string] $Entry.projectionPath)))
            }
        }
        catch {
            $Issues.Add((New-SLValidationIssue error 'usage-projection-schema' $_.Exception.Message ([string] $Entry.projectionPath)))
        }
    }
    $LifecycleRoot = Resolve-SLContainedPath -Root $Root -RelativePath $script:SLLifecycleRoot
    if ([IO.Directory]::Exists($LifecycleRoot)) {
        $LifecycleIds = @{}
        foreach ($File in [IO.Directory]::EnumerateFiles($LifecycleRoot, '*', [IO.SearchOption]::AllDirectories)) {
            $Relative = [IO.Path]::GetRelativePath($Root, $File).Replace('\', '/')
            if (-not $Relative.EndsWith('.json')) {
                $Issues.Add((New-SLValidationIssue error 'lifecycle-event-extension' 'Lifecycle event directories may contain only immutable JSON event files.' $Relative))
                continue
            }
            try {
                $Event = Read-SLJson -Root $Root -RelativePath $Relative
                if (-not (Test-SLLifecycleEventIntegrity $Event)) { throw 'Lifecycle event identity does not match its content.' }
                if ((Get-SLLifecycleEventPath $Event) -cne $Relative) {
                    $Issues.Add((New-SLValidationIssue error 'lifecycle-event-path' 'Lifecycle event path does not match its timestamp and event ID.' $Relative))
                }
                if ($LifecycleIds.ContainsKey([string] $Event.eventId)) {
                    $Issues.Add((New-SLValidationIssue error 'lifecycle-event-duplicate-id' "Lifecycle event ID is already present at $($LifecycleIds[[string] $Event.eventId])." $Relative))
                }
                $LifecycleIds[[string] $Event.eventId] = $Relative
                if (-not $Ids.ContainsKey([string] $Event.artifactId)) {
                    $Issues.Add((New-SLValidationIssue error 'lifecycle-event-artifact' "Lifecycle event references unknown artifact $($Event.artifactId)." $Relative))
                }
            }
            catch {
                $Issues.Add((New-SLValidationIssue error 'lifecycle-event-integrity' $_.Exception.Message $Relative))
            }
        }
    }
    if ($IncludeRuntime) {
        $Runtime = Test-SLRuntimeInstallation -RuntimeHome $PSScriptRoot -ExpectedRuntimeVersion $script:SLRuntimeVersion
        foreach ($Check in @($Runtime.checks | Where-Object status -ceq 'error')) {
            $Issues.Add((New-SLValidationIssue error ([string] $Check.code) ([string] $Check.message) '.github/SL-learning/SL-runtime'))
        }
    }
    return @($Issues | Sort-Object -Stable -Property @(
        @{ Expression = { [string] $_.severity } },
        @{ Expression = { [string] $_.code } },
        @{ Expression = { [string] (Get-SLProperty $_ 'path' '') } },
        @{ Expression = { [string] $_.message } }
    ))
}

function Invoke-SLDoctor {
    param([Parameter(Mandatory)][string] $Root)

    $Runtime = Test-SLRuntimeInstallation -RuntimeHome $PSScriptRoot -ExpectedRuntimeVersion $script:SLRuntimeVersion
    $Issues = @(Test-SLRepository -Root $Root -IncludeRuntime)
    $Registry = try { Get-SLRegistry $Root } catch { [pscustomobject] @{ artifacts = @() } }
    $Counts = [ordered] @{}
    foreach ($Artifact in @($Registry.artifacts)) {
        $Status = [string] $Artifact.status
        if (-not $Counts.Contains($Status)) { $Counts[$Status] = 0 }
        $Counts[$Status] += 1
    }
    return [pscustomobject] @{
        healthy = @($Issues | Where-Object severity -ceq 'error').Count -eq 0
        artifactCount = @($Registry.artifacts).Count
        statusCounts = [pscustomobject] $Counts
        issueCount = $Issues.Count
        issues = $Issues
        checks = $Runtime.checks
    }
}
