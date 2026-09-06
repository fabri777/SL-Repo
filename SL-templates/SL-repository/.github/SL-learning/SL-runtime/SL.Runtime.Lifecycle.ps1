Set-StrictMode -Version Latest

function Get-SLRetrievedArtifacts {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $TargetPath,
        [AllowNull()][string] $Trigger
    )

    $Catalog = Get-SLScopeCatalog $Root
    $Resolution = Resolve-SLScope -Root $Root -Path $TargetPath -Catalog $Catalog
    $Registry = Get-SLRegistry $Root
    $Order = @{}
    for ($Index = 0; $Index -lt $Resolution.orderedScopeIds.Count; $Index += 1) {
        $Order[[string] $Resolution.orderedScopeIds[$Index]] = $Index
    }
    $ById = @{}
    foreach ($Definition in @($Catalog.scopes)) { $ById[[string] $Definition.id] = $Definition }
    $RootScope = @($Catalog.scopes | Where-Object { -not (Test-SLProperty $_ 'parentScopeId') })[0]
    $Ancestors = @{}
    $Current = $ById[[string] $Resolution.primaryScopeId]
    while (Test-SLProperty $Current 'parentScopeId') {
        $Ancestors[[string] $Current.parentScopeId] = $true
        $Current = $ById[[string] $Current.parentScopeId]
    }
    $Selected = [System.Collections.Generic.List[object]]::new()
    foreach ($Artifact in @($Registry.artifacts)) {
        $Scope = Normalize-SLScope (Get-SLProperty $Artifact 'scope' $script:SLDefaultScope)
        if (
            -not $Order.ContainsKey([string] $Scope.id) -or
            -not $Artifact.path -or
            $Artifact.classification -ceq 'system' -or
            [string] $Artifact.status -cnotin $script:SLActiveStatuses -or
            -not [IO.File]::Exists((Resolve-SLContainedPath -Root $Root -RelativePath ([string] $Artifact.path)))
        ) { continue }
        if ($Artifact.classification -ceq 'promoted' -and $Artifact.status -ceq 'active' -and -not (Test-SLPromotionEvaluationCurrent $Root $Artifact)) {
            continue
        }
        if ($Trigger) {
            $Matched = @((Get-SLProperty $Artifact 'trigger' @()) | Where-Object {
                ([string] $_).Equals($Trigger, [StringComparison]::OrdinalIgnoreCase)
            }).Count -gt 0
            if (-not $Matched) { continue }
        }
        $Provenance = [System.Collections.Generic.List[string]]::new()
        foreach ($Value in @((Get-SLProperty $Artifact 'dependsOn' @())) + @($Artifact.relatedTo)) {
            if (-not $Provenance.Contains([string] $Value)) { $Provenance.Add([string] $Value) }
        }
        $Selected.Add([pscustomobject] @{
            id = $Artifact.id
            path = $Artifact.path
            artifactType = $Artifact.artifactType
            status = $Artifact.status
            scope = $Scope
            precedence = [int] $Order[[string] $Scope.id]
            relation = $(if ($Scope.id -ceq $Resolution.primaryScopeId) {
                'local'
            } elseif ($Scope.id -ceq $RootScope.id) {
                'root'
            } elseif ($Ancestors.ContainsKey([string] $Scope.id)) {
                'ancestor'
            } else {
                'dependency'
            })
            provenance = $Provenance.ToArray()
            trigger = Sort-SLOrdinal @((Get-SLProperty $Artifact 'trigger' @()))
        })
    }
    $Contracts = [System.Collections.Generic.List[object]]::new()
    foreach ($Item in $Selected) {
        $Artifact = Find-SLArtifact $Registry $Item.id
        if ($Artifact.classification -cne 'promoted') { continue }
        $Snapshot = Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact
        $ContractPath = Get-SLProperty $Snapshot.frontmatter 'validationContract'
        if (-not $ContractPath) { continue }
        $Evaluation = Invoke-SLValidationContract -Root $Root -ArtifactId $Artifact.id -ArtifactType $Artifact.artifactType -ArtifactPath $(if (Test-SLProperty $Artifact 'promotionTargetPath') { $Artifact.promotionTargetPath } else { $Artifact.path }) -ContentPath $Artifact.path -SourceIds @((Get-SLProperty $Artifact 'dependsOn' @())) -ContractPath $ContractPath -Frontmatter $Snapshot.frontmatter -ExpectedStatus $Artifact.status
        if ($Evaluation.status -ceq 'passed') {
            $Contracts.Add([pscustomobject] @{ artifactId = $Artifact.id; contract = $Evaluation.contract; artifact = $Artifact })
        }
    }
    $Conflicts = @(Get-SLValidationContractConflicts $Contracts.ToArray())
    foreach ($Conflict in $Conflicts) {
        $Left = Find-SLArtifact $Registry $Conflict.leftArtifactId
        $Right = Find-SLArtifact $Registry $Conflict.rightArtifactId
        $Resolved = $false
        foreach ($Candidate in @($Left, $Right)) {
            $Resolutions = @((Get-SLProperty (Get-SLProperty $Candidate 'promotionEvaluation') 'governance' | ForEach-Object {
                Get-SLProperty $_ 'conflictResolutions' @()
            }))
            if (@($Resolutions | Where-Object {
                $_.status -ceq 'explicit-override' -and
                $_.declarationKey -ceq $Conflict.declarationKey -and
                @($_.narrowerArtifactId, $_.broaderArtifactId) -contains $Left.id -and
                @($_.narrowerArtifactId, $_.broaderArtifactId) -contains $Right.id
            }).Count -gt 0) {
                $Resolved = $true
            }
        }
        if (-not $Resolved) {
            Throw-SLContractError -Code 'retrieval-conflict' -Message "Unresolved active guidance conflict: $($Conflict.message)"
        }
    }
    $Artifacts = @($Selected | Sort-Object -Stable -Property @(
        @{ Expression = { [int] $_.precedence } },
        @{ Expression = { [string] $_.id } }
    ))
    return [pscustomobject] @{
        path = $Resolution.normalizedPath
        primaryScopeId = $Resolution.primaryScopeId
        orderedScopeIds = $Resolution.orderedScopeIds
        artifacts = $Artifacts
    }
}

function Test-SLActiveIncomingReference {
    param([Parameter(Mandatory)][object] $Registry, [Parameter(Mandatory)][string] $ArtifactId)

    return @($Registry.artifacts | Where-Object {
        $_.id -cne $ArtifactId -and
        [string] $_.status -cin $script:SLReferenceProtectingStatuses -and
        @((Get-SLProperty $_ 'dependsOn' @())) -contains $ArtifactId
    }).Count -gt 0
}

function Set-SLQuarantined {
    param(
        [string] $Root,
        [object] $Artifact,
        [string] $Reason,
        [int] $GraceDays,
        [string] $Timestamp,
        [System.Collections.Generic.List[object]] $Changes,
        [switch] $DryRun
    )

    if (-not $Artifact.path) {
        Throw-SLContractError -Code 'forget-path' -Message "Artifact $($Artifact.id) has no active path."
    }
    $SourcePath = [string] $Artifact.path
    $TargetPath = "$script:SLQuarantineRoot/$($Artifact.id)/$([IO.Path]::GetFileName($SourcePath))"
    if ([IO.File]::Exists((Resolve-SLContainedPath -Root $Root -RelativePath $TargetPath))) {
        Throw-SLContractError -Code 'forget-clobber' -Message "Quarantine path already exists: $TargetPath"
    }
    $Snapshot = Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact
    Set-SLProperty $Snapshot.frontmatter 'status' 'quarantined'
    Write-SLTextChange -Root $Root -RelativePath $SourcePath -Content (
        ConvertTo-SLFrontmatterText -Frontmatter $Snapshot.frontmatter -Body $Snapshot.body
    ) -Changes $Changes -DryRun:$DryRun
    Move-SLContainedFile -Root $Root -SourceRelativePath $SourcePath -TargetRelativePath $TargetPath -Changes $Changes -DryRun:$DryRun
    $PreviousStatus = [string] $Artifact.status
    if (-not (Test-SLProperty $Artifact 'originalPath')) { Set-SLProperty $Artifact 'originalPath' $SourcePath }
    Set-SLProperty $Artifact 'path' $TargetPath
    Set-SLProperty $Artifact 'previousStatus' $PreviousStatus
    Set-SLProperty $Artifact 'status' 'quarantined'
    Set-SLProperty $Artifact 'forgetReason' $Reason
    Set-SLProperty $Artifact 'quarantinedAt' $Timestamp
    $DeleteEligible = ([DateTimeOffset]::Parse($Timestamp, [Globalization.CultureInfo]::InvariantCulture)).AddDays($GraceDays)
    Set-SLProperty $Artifact 'deleteEligibleAt' $DeleteEligible.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    return [pscustomobject] @{
        timestamp = $Timestamp
        artifactId = $Artifact.id
        action = 'quarantined'
        reason = $Reason
        fromStatus = $PreviousStatus
        toStatus = 'quarantined'
        fromPath = $SourcePath
        toPath = $TargetPath
    }
}

function Forget-SLArtifact {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $ArtifactId,
        [Parameter(Mandatory)][ValidateSet('wrong', 'irrelevant', 'superseded')][string] $Reason,
        [AllowNull()][string] $Now,
        [switch] $DryRun
    )

    return Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation {
        $Timestamp = Get-SLNormalizedTimestamp $Now
        $Config = Get-SLConfig $Root
        $Registry = Get-SLRegistry $Root
        $Artifact = Find-SLArtifact $Registry $ArtifactId
        if ($Artifact.classification -ceq 'system') { Throw-SLContractError -Code 'forget-system' -Message 'System artifacts cannot be forgotten.' }
        if ($Artifact.pinned) { Throw-SLContractError -Code 'forget-pinned' -Message 'Pinned artifacts must be unpinned before forgetting.' }
        if ($Artifact.status -ceq 'deleted') { Throw-SLContractError -Code 'forget-deleted' -Message 'Deleted artifacts cannot be forgotten again.' }
        if ($Artifact.status -ceq 'quarantined') { Throw-SLContractError -Code 'forget-quarantined' -Message 'Artifact is already quarantined.' }
        if (Test-SLActiveIncomingReference $Registry $ArtifactId) { Throw-SLContractError -Code 'forget-reference' -Message 'Artifact has an active dependent and cannot be forgotten.' }
        [void] (Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact)
        $Changes = [System.Collections.Generic.List[object]]::new()
        $Grace = $(if ($Reason -ceq 'wrong') { $Config.retention.wrongDeleteAfterDays } else { $Config.retention.deleteAfterQuarantineDays })
        $Event = Set-SLQuarantined -Root $Root -Artifact $Artifact -Reason $Reason -GraceDays $Grace -Timestamp $Timestamp -Changes $Changes -DryRun:$DryRun
        Assert-SLLifecycleEventsWritable -Root $Root -Events @($Event)
        [void] (Save-SLRegistry -Root $Root -Registry $Registry -Changes $Changes -DryRun:$DryRun)
        Write-SLIndexes -Root $Root -Registry $Registry -Changes $Changes -Projections @(Project-SLUsageEvents (Get-SLUsageEvents $Root)) -DryRun:$DryRun
        Write-SLLifecycleEvents -Root $Root -Events @($Event) -DryRun:$DryRun
        return [pscustomobject] @{ changes = $Changes.ToArray(); events = @($Event) }
    }
}

function Get-SLStateSnapshotPaths {
    param([string] $Root)

    $Paths = [System.Collections.Generic.List[string]]::new()
    foreach ($Path in @($script:SLLegacyRegistryPath, $script:SLLegacyIndexPath, $script:SLStateCatalogPath)) { $Paths.Add($Path) }
    foreach ($Entry in @((Get-SLStateCatalog $Root).scopes)) {
        foreach ($Path in @($Entry.registryPath, $Entry.indexPath, $Entry.projectionPath, $Entry.resourceProjectionPath)) { $Paths.Add([string] $Path) }
    }
    return Sort-SLOrdinal @($Paths | Select-Object -Unique)
}

function Get-SLFileSnapshots {
    param([string] $Root, [string[]] $Paths)

    $Snapshots = [System.Collections.Generic.List[object]]::new()
    foreach ($RelativePath in $Paths) {
        $Path = Resolve-SLContainedPath -Root $Root -RelativePath $RelativePath
        $Snapshots.Add([pscustomobject] @{
            path = $RelativePath
            exists = [IO.File]::Exists($Path)
            bytes = $(if ([IO.File]::Exists($Path)) { [IO.File]::ReadAllBytes($Path) } else { $null })
        })
    }
    return $Snapshots.ToArray()
}

function Restore-SLFileSnapshots {
    param([string] $Root, [object[]] $Snapshots)

    foreach ($Snapshot in $Snapshots) {
        $Path = Resolve-SLContainedPath -Root $Root -RelativePath ([string] $Snapshot.path)
        if (-not $Snapshot.exists) {
            if ([IO.File]::Exists($Path)) { [IO.File]::Delete($Path) }
            continue
        }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
        [IO.File]::WriteAllBytes($Path, [byte[]] $Snapshot.bytes)
    }
}

function Restore-SLArtifact {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $ArtifactId,
        [AllowNull()][string] $Now,
        [switch] $DryRun
    )

    return Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation {
        $Timestamp = Get-SLNormalizedTimestamp $Now
        $Registry = Get-SLRegistry $Root
        $Artifact = Find-SLArtifact $Registry $ArtifactId
        if ($Artifact.status -cne 'quarantined' -or -not $Artifact.path -or -not (Test-SLProperty $Artifact 'originalPath')) {
            Throw-SLContractError -Code 'restore-state' -Message 'Only quarantined artifacts with an original path can be restored.'
        }
        $Snapshot = Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact
        $Promoted = $Artifact.classification -ceq 'promoted' -and $Artifact.artifactType -cin @('instruction', 'skill')
        $TargetPath = if ($Promoted) {
            Get-SLProbationPath $Artifact.id $Artifact.artifactType ([string] (Get-SLProperty $Artifact 'promotionTargetPath' $Artifact.originalPath))
        } else {
            [string] $Artifact.originalPath
        }
        if ([IO.File]::Exists((Resolve-SLContainedPath -Root $Root -RelativePath $TargetPath))) {
            Throw-SLContractError -Code 'restore-clobber' -Message "$(if ($Promoted) { 'Promotion probation' } else { 'Evidence restore' }) path already exists: $TargetPath"
        }
        $RestoredStatus = $(if ($Promoted) { 'probation' } else { [string] (Get-SLProperty $Artifact 'previousStatus' 'raw') })
        Set-SLProperty $Snapshot.frontmatter 'status' $RestoredStatus
        $Event = [pscustomobject] @{
            timestamp = $Timestamp
            artifactId = $ArtifactId
            action = 'restored'
            fromStatus = 'quarantined'
            toStatus = $RestoredStatus
            fromPath = $Artifact.path
            toPath = $TargetPath
        }
        Assert-SLLifecycleEventsWritable -Root $Root -Events @($Event)
        $SnapshotPaths = @([string] $Artifact.path, $TargetPath) + @(Get-SLStateSnapshotPaths $Root)
        $FileSnapshots = $(if ($DryRun) { @() } else { @(Get-SLFileSnapshots -Root $Root -Paths $SnapshotPaths) })
        $Changes = [System.Collections.Generic.List[object]]::new()
        try {
            Write-SLTextChange -Root $Root -RelativePath ([string] $Artifact.path) -Content (
                ConvertTo-SLFrontmatterText -Frontmatter $Snapshot.frontmatter -Body $Snapshot.body
            ) -Changes $Changes -DryRun:$DryRun
            $OldPath = [string] $Artifact.path
            Move-SLContainedFile -Root $Root -SourceRelativePath $OldPath -TargetRelativePath $TargetPath -Changes $Changes -DryRun:$DryRun
            Set-SLProperty $Artifact 'path' $TargetPath
            Set-SLProperty $Artifact 'status' $RestoredStatus
            if ($Promoted) {
                Set-SLProperty $Artifact 'promotionTargetPath' ([string] (Get-SLProperty $Artifact 'promotionTargetPath' $Artifact.originalPath))
                Remove-SLProperty $Artifact 'promotionEvaluation'
                Remove-SLProperty $Artifact 'activatedAt'
                Remove-SLProperty $Artifact 'originalPath'
            }
            Remove-SLProperty $Artifact 'previousStatus'
            Remove-SLProperty $Artifact 'quarantinedAt'
            Remove-SLProperty $Artifact 'deleteEligibleAt'
            Remove-SLProperty $Artifact 'forgetReason'
            [void] (Save-SLRegistry -Root $Root -Registry $Registry -Changes $Changes -DryRun:$DryRun)
            Write-SLIndexes -Root $Root -Registry $Registry -Changes $Changes -Projections @(Project-SLUsageEvents (Get-SLUsageEvents $Root)) -DryRun:$DryRun
            Write-SLLifecycleEvents -Root $Root -Events @($Event) -DryRun:$DryRun
            return [pscustomobject] @{ changes = $Changes.ToArray(); events = @($Event) }
        }
        catch {
            if (-not $DryRun) {
                Restore-SLFileSnapshots -Root $Root -Snapshots $FileSnapshots
            }
            throw
        }
    }
}

function Invoke-SLSweep {
    param(
        [Parameter(Mandatory)][string] $Root,
        [AllowNull()][string] $Now,
        [switch] $DryRun
    )

    return Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation {
        $Timestamp = Get-SLNormalizedTimestamp $Now
        $Current = [DateTimeOffset]::Parse($Timestamp, [Globalization.CultureInfo]::InvariantCulture)
        $Config = Get-SLConfig $Root
        $Changes = [System.Collections.Generic.List[object]]::new()
        $Registry = Sync-SLProjection -Root $Root -DryRun:$DryRun -Changes $Changes
        $Events = [System.Collections.Generic.List[object]]::new()
        foreach ($Artifact in @($Registry.artifacts)) {
            if ($Artifact.classification -ceq 'system' -or $Artifact.pinned -or $Artifact.status -cin @('deleted', 'superseded')) { continue }
            if ($Artifact.status -cne 'quarantined' -and (Test-SLActiveIncomingReference $Registry $Artifact.id)) {
                $Changes.Add([pscustomobject] @{ action = 'skip'; path = $(if ($Artifact.path) { $Artifact.path } else { $Artifact.id }); detail = 'artifact has an active dependent' })
                continue
            }
            if ($Artifact.status -ceq 'quarantined') {
                $Reason = $null
                if (-not $Artifact.deleteEligibleAt) { $Reason = 'quarantine metadata is incomplete' }
                else {
                    [DateTimeOffset] $Eligible = [DateTimeOffset]::MinValue
                    if (-not [DateTimeOffset]::TryParse([string] $Artifact.deleteEligibleAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref] $Eligible)) {
                        $Reason = 'delete eligibility timestamp is invalid'
                    }
                    elseif ($Eligible -gt $Current) { $Reason = 'quarantine grace period has not elapsed' }
                    elseif (Test-SLActiveIncomingReference $Registry $Artifact.id) { $Reason = 'artifact has an active dependent' }
                }
                if ($Reason) {
                    $Changes.Add([pscustomobject] @{ action = 'skip'; path = $Artifact.path; detail = $Reason })
                    continue
                }
                [void] (Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact)
                $DeletedPath = [string] $Artifact.path
                Remove-SLContainedFile -Root $Root -RelativePath $DeletedPath -Changes $Changes -DryRun:$DryRun
                Set-SLProperty $Artifact 'path' $null
                Set-SLProperty $Artifact 'status' 'deleted'
                Set-SLProperty $Artifact 'deletedAt' $Timestamp
                $Events.Add([pscustomobject] @{
                    timestamp = $Timestamp; artifactId = $Artifact.id; action = 'deleted'
                    reason = (Get-SLProperty $Artifact 'forgetReason' 'retention elapsed')
                    fromStatus = 'quarantined'; toStatus = 'deleted'; fromPath = $DeletedPath; toPath = $null
                })
                continue
            }
            $Activity = [string] (Get-SLProperty $Artifact 'lastSuccessfulUseAt' (Get-SLProperty $Artifact 'lastVerifiedAt' $Artifact.createdAt))
            $ActivityDate = [DateTimeOffset]::Parse($Activity, [Globalization.CultureInfo]::InvariantCulture)
            $Age = [Math]::Floor(($Current - $ActivityDate).TotalDays)
            $Promoted = $Artifact.classification -ceq 'promoted'
            if ($Artifact.status -ceq 'stale') {
                $StaleDate = [DateTimeOffset]::Parse([string] (Get-SLProperty $Artifact 'staleAt' $Activity), [Globalization.CultureInfo]::InvariantCulture)
                $StaleAge = [Math]::Floor(($Current - $StaleDate).TotalDays)
                $ShouldQuarantine = $(if ($Promoted) { $StaleAge -ge $Config.retention.promotedQuarantineAfterDays } else { $Age -ge $Config.retention.quarantineAfterDays })
                if ($ShouldQuarantine) {
                    $Events.Add((Set-SLQuarantined -Root $Root -Artifact $Artifact -Reason unused -GraceDays $Config.retention.deleteAfterQuarantineDays -Timestamp $Timestamp -Changes $Changes -DryRun:$DryRun))
                }
                continue
            }
            $StaleAfter = $(if ($Promoted) { $Config.retention.promotedStaleAfterDays } else { $Config.retention.staleAfterDays })
            if ($Age -ge $StaleAfter) {
                $Previous = [string] $Artifact.status
                $Snapshot = Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact
                Set-SLProperty $Snapshot.frontmatter 'status' 'stale'
                Write-SLTextChange -Root $Root -RelativePath ([string] $Artifact.path) -Content (
                    ConvertTo-SLFrontmatterText -Frontmatter $Snapshot.frontmatter -Body $Snapshot.body
                ) -Changes $Changes -DryRun:$DryRun
                Set-SLProperty $Artifact 'previousStatus' $Previous
                Set-SLProperty $Artifact 'status' 'stale'
                Set-SLProperty $Artifact 'staleAt' $Timestamp
                Set-SLProperty $Artifact 'forgetReason' 'unused'
                $Events.Add([pscustomobject] @{
                    timestamp = $Timestamp; artifactId = $Artifact.id; action = 'marked-stale'; reason = 'unused'
                    fromStatus = $Previous; toStatus = 'stale'; fromPath = $Artifact.path; toPath = $Artifact.path
                })
            }
        }
        Assert-SLLifecycleEventsWritable -Root $Root -Events $Events.ToArray()
        [void] (Save-SLRegistry -Root $Root -Registry $Registry -Changes $Changes -DryRun:$DryRun)
        Write-SLIndexes -Root $Root -Registry $Registry -Changes $Changes -Projections @(Project-SLUsageEvents (Get-SLUsageEvents $Root)) -DryRun:$DryRun
        Write-SLLifecycleEvents -Root $Root -Events $Events.ToArray() -DryRun:$DryRun
        return [pscustomobject] @{ changes = $Changes.ToArray(); events = $Events.ToArray() }
    }
}
