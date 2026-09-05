Set-StrictMode -Version Latest

$script:SLMutableFrontmatterFields = @(
    'id',
    'schemaVersion',
    'managedBy',
    'status',
    'previousStatus',
    'pinned',
    'hits',
    'retrievals',
    'notUsefulVotes',
    'lastRetrievedAt',
    'lastSuccessfulUseAt',
    'lastVerifiedAt',
    'staleAt',
    'quarantinedAt',
    'deleteEligibleAt',
    'deletedAt',
    'activatedAt',
    'forgetReason'
)

function Read-SLOwnedMarkdown {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [object] $Artifact,

        [AllowNull()]
        [string] $ExpectedArtifactType,

        [AllowNull()]
        [string] $ExpectedClassification
    )

    $ErrorMessage = "Artifact $($Artifact.id) file ownership does not match the registry."
    if (
        $Artifact.managedBy -cne 'SL-Repo' -or
        -not $Artifact.path -or
        -not ([string] $Artifact.path).EndsWith('.md') -or
        ($ExpectedArtifactType -and $Artifact.artifactType -cne $ExpectedArtifactType) -or
        ($ExpectedClassification -and $Artifact.classification -cne $ExpectedClassification)
    ) {
        Throw-SLContractError -Code 'artifact-ownership' -Message $ErrorMessage
    }
    $Path = Resolve-SLContainedPath -Root $Root -RelativePath ([string] $Artifact.path)
    if (-not [IO.File]::Exists($Path)) {
        Throw-SLContractError -Code 'artifact-ownership' -Message $ErrorMessage
    }
    try {
        $Content = Read-SLSafeText -Root $Root -RelativePath ([string] $Artifact.path)
        $Markdown = ConvertFrom-SLFrontmatter -Content $Content
        if (
            (Get-SLProperty $Markdown.frontmatter 'id') -cne $Artifact.id -or
            (Get-SLProperty $Markdown.frontmatter 'schemaVersion') -ne 1 -or
            (Get-SLProperty $Markdown.frontmatter 'managedBy') -cne 'SL-Repo' -or
            (Get-SLProperty $Markdown.frontmatter 'status') -cne $Artifact.status -or
            [bool] (Get-SLProperty $Markdown.frontmatter 'pinned' $false) -ne [bool] $Artifact.pinned
        ) {
            Throw-SLContractError -Code 'artifact-ownership' -Message $ErrorMessage
        }
        $Name = [IO.Path]::GetFileName(([string] $Artifact.path).Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (
            ($Artifact.artifactType -ceq 'lesson' -and (
                $Artifact.classification -cne 'evidence' -or
                -not $Name.StartsWith('SL-') -or
                -not $Name.EndsWith('.md') -or
                (Get-SLProperty $Markdown.frontmatter 'kind') -cnotin @('win', 'pitfall', 'mixed')
            )) -or
            ($Artifact.artifactType -ceq 'instruction' -and (
                $Artifact.classification -cne 'promoted' -or
                -not $Name.StartsWith('SL-') -or
                -not $Name.EndsWith('.instructions.md')
            )) -or
            ($Artifact.artifactType -ceq 'skill' -and (
                $Artifact.classification -cne 'promoted' -or
                $Name -cne 'SKILL.md'
            ))
        ) {
            Throw-SLContractError -Code 'artifact-ownership' -Message $ErrorMessage
        }
        return [pscustomobject] @{
            content = $Content
            frontmatter = $Markdown.frontmatter
            body = $Markdown.body
        }
    }
    catch {
        if ($_.Exception.Data['SLCode'] -ceq 'artifact-ownership') {
            throw
        }
        Throw-SLContractError -Code 'artifact-ownership' -Message $ErrorMessage
    }
}

function Get-SLArtifactUsageContentHash {
    param([Parameter(Mandatory)][string] $Content)

    $Markdown = ConvertFrom-SLFrontmatter -Content $Content
    $Filtered = [ordered] @{}
    $Names = if ($Markdown.frontmatter -is [System.Collections.IDictionary]) {
        [string[]] @($Markdown.frontmatter.Keys | ForEach-Object { [string] $_ })
    }
    else {
        [string[]] @($Markdown.frontmatter.PSObject.Properties.Name)
    }
    [Array]::Sort($Names, [StringComparer]::Ordinal)
    foreach ($Name in $Names) {
        if ($Name -cnotin $script:SLMutableFrontmatterFields) {
            $Filtered[$Name] = Get-SLProperty $Markdown.frontmatter $Name
        }
    }
    return Get-SLSha256 -Value (ConvertTo-SLCanonicalJson ([pscustomobject] @{
        frontmatter = [pscustomobject] $Filtered
        body = $Markdown.body.Replace("`r`n", "`n").Replace("`r", "`n")
    }))
}

function New-SLCaptureLesson {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [string] $Title,

        [Parameter(Mandatory)]
        [ValidateSet('win', 'pitfall', 'mixed')]
        [string] $Kind,

        [Parameter(Mandatory)]
        [string] $LessonScope,

        [Parameter(Mandatory)]
        [string[]] $Triggers,

        [AllowNull()]
        [string] $ScopeId,

        [AllowNull()]
        [string] $TargetPath,

        [AllowNull()]
        [string] $StateScopePath,

        [AllowNull()]
        [string] $StateScopeId,

        [AllowNull()]
        [string] $Now,

        [switch] $DryRun
    )

    return Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation {
        $Timestamp = Get-SLNormalizedTimestamp $Now
        $Date = $Timestamp.Substring(0, 10)
        $Slug = ConvertTo-SLSlug $Title
        if (-not $Slug) {
            Throw-SLContractError -Code 'capture-title' -Message 'Lesson title must contain letters or numbers.'
        }
        $CleanTriggers = [System.Collections.Generic.List[string]]::new()
        foreach ($Trigger in $Triggers) {
            $Clean = $Trigger.Trim()
            if ($Clean -and -not $CleanTriggers.Contains($Clean)) {
                if (Test-SLSensitiveText $Clean) {
                    Throw-SLContractError -Code 'capture-sensitive' -Message 'Lesson triggers cannot contain secrets or personal paths.'
                }
                $CleanTriggers.Add($Clean)
            }
        }
        if ($CleanTriggers.Count -eq 0) {
            Throw-SLContractError -Code 'capture-trigger' -Message 'At least one trigger is required.'
        }
        if (Test-SLSensitiveText "$Title`n$LessonScope") {
            Throw-SLContractError -Code 'capture-sensitive' -Message 'Lesson metadata cannot contain secrets or personal paths.'
        }
        $Registry = Get-SLRegistry $Root
        $StateScope = if ($StateScopePath) {
            Normalize-SLScope ([pscustomobject] @{
                id = $(if ($StateScopeId) { $StateScopeId } else { ConvertTo-SLSlug $StateScopePath })
                path = $StateScopePath
            })
        }
        else {
            (Resolve-SLScopeDescriptor -Root $Root -ScopeId $ScopeId -TargetPath $TargetPath).scope
        }
        $BaseId = "SL-$($Date.Replace('-', ''))-$($Slug.ToUpperInvariant())"
        $Id = $BaseId
        $Suffix = 2
        while (@($Registry.artifacts | Where-Object { $_.id -ceq $Id }).Count -gt 0) {
            $Id = "$BaseId-$Suffix"
            $Suffix += 1
        }
        $Path = "$script:SLLessonsRoot/$($Date.Substring(0, 7))/SL-$Date-$Slug.md"
        if ([IO.File]::Exists((Resolve-SLContainedPath -Root $Root -RelativePath $Path))) {
            Throw-SLContractError -Code 'capture-path' -Message "Lesson file already exists: $Path"
        }
        $RelatedCues = @($Registry.artifacts | Where-Object {
            $_.artifactType -ceq 'lesson' -and
            $_.classification -ceq 'evidence' -and
            @($_.trigger | Where-Object {
                $Candidate = [string] $_
                @($CleanTriggers | Where-Object { $_.Equals($Candidate, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
            }).Count -gt 0
        } | ForEach-Object { [string] $_.id } | Sort-Object -Unique)
        $Frontmatter = [ordered] @{
            id = $Id
            schemaVersion = 1
            managedBy = 'SL-Repo'
            date = $Date
            kind = $Kind
            scope = $LessonScope
            status = 'raw'
            trigger = $CleanTriggers.ToArray()
            hits = 0
            retrievals = 0
            lastVerifiedAt = $Date
            pinned = $false
            relatedTo = @()
        }
        $BodyLines = [System.Collections.Generic.List[string]]::new()
        $BodyLines.Add('')
        $BodyLines.Add('## Context')
        $BodyLines.Add('Describe the verified situation that produced this lesson.')
        $BodyLines.Add('')
        if ($Kind -cne 'pitfall') {
            $BodyLines.Add('## What worked')
            $BodyLines.Add('- Replace with the verified reusable approach.')
            $BodyLines.Add('')
        }
        if ($Kind -cne 'win') {
            $BodyLines.Add('## What did NOT work')
            $BodyLines.Add('- Replace with the failed approach and the symptom that exposed it.')
            $BodyLines.Add('')
        }
        $BodyLines.Add('## Why')
        $BodyLines.Add('Explain the underlying reason so the lesson generalizes.')
        $BodyLines.Add('')
        $BodyLines.Add('## Re-use cue')
        $BodyLines.Add('- Describe when a future agent should retrieve this lesson.')
        $Changes = [System.Collections.Generic.List[object]]::new()
        $LifecycleEvent = [pscustomobject] @{
            timestamp = $Timestamp
            artifactId = $Id
            action = 'captured'
            toStatus = 'raw'
            toPath = $Path
        }
        Assert-SLLifecycleEventsWritable -Root $Root -Events @($LifecycleEvent)
        Write-SLTextChange -Root $Root -RelativePath $Path -Content (
            ConvertTo-SLFrontmatterText -Frontmatter $Frontmatter -Body ($BodyLines -join "`n")
        ) -Changes $Changes -DryRun:$DryRun
        $Artifact = [pscustomobject] @{
            id = $Id
            path = $Path
            artifactType = 'lesson'
            classification = 'evidence'
            managedBy = 'SL-Repo'
            status = 'raw'
            createdAt = $Timestamp
            lastVerifiedAt = $Timestamp
            pinned = $false
            relatedTo = @()
            trigger = $CleanTriggers.ToArray()
            hits = 0
            retrievals = 0
            notUsefulVotes = 0
            scope = $StateScope
        }
        $Registry.artifacts = @($Registry.artifacts) + @($Artifact)
        [void] (Save-SLRegistry -Root $Root -Registry $Registry -Changes $Changes -DryRun:$DryRun)
        Write-SLIndexes -Root $Root -Registry $Registry -Changes $Changes -Projections @() -DryRun:$DryRun
        Write-SLLifecycleEvents -Root $Root -Events @($LifecycleEvent) -DryRun:$DryRun
        return [pscustomobject] @{
            id = $Id
            path = $Path
            scope = $StateScope
            searchCues = $CleanTriggers.ToArray()
            possibleDuplicates = $RelatedCues
            changes = $Changes.ToArray()
        }
    }
}

function New-SLUsageEvent {
    param(
        [Parameter(Mandatory)][string] $ArtifactId,
        [Parameter(Mandatory)][string] $ArtifactContentHash,
        [Parameter(Mandatory)][string] $TaskRunId,
        [Parameter(Mandatory)][string] $ApplicationId,
        [Parameter(Mandatory)][ValidateSet('selected', 'applied', 'outcome', 'verified')][string] $Stage,
        [Parameter(Mandatory)][ValidateSet('success', 'failure', 'partial', 'unknown')][string] $Outcome,
        [Parameter(Mandatory)][string] $VerifierType,
        [Parameter(Mandatory)][string] $Timestamp,
        [Parameter(Mandatory)][string] $IdempotencyKey,
        [AllowNull()][string] $EvidenceRef,
        [AllowNull()][object] $Scope
    )

    foreach ($Value in @($ArtifactId, $TaskRunId, $ApplicationId, $VerifierType)) {
        if ($Value -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$') {
            Throw-SLContractError -Code 'usage-identity' -Message 'Usage identifiers contain unsupported characters.'
        }
    }
    if ($ArtifactId -cnotmatch '^SL-[A-Z0-9][A-Z0-9-]*$' -or $ArtifactContentHash -cnotmatch '^[a-f0-9]{64}$') {
        Throw-SLContractError -Code 'usage-artifact' -Message 'Usage artifact identity is invalid.'
    }
    if (-not $IdempotencyKey.Trim()) {
        Throw-SLContractError -Code 'usage-idempotency' -Message 'idempotencyKey is required.'
    }
    if ($EvidenceRef -and -not (Test-SLOpaqueReference $EvidenceRef)) {
        Throw-SLContractError -Code 'usage-evidence' -Message 'evidenceRef must be an opaque, non-PII reference without embedded source content.'
    }
    if ($Stage -cin @('selected', 'applied') -and ($Outcome -cne 'unknown' -or $VerifierType -cne 'unverified')) {
        Throw-SLContractError -Code 'usage-stage' -Message 'Selected and applied events must remain unverified with unknown outcome.'
    }
    if ($Stage -ceq 'verified' -and $VerifierType.ToLowerInvariant() -cin @('none', 'self-report', 'self-reported', 'unknown', 'unverified')) {
        Throw-SLContractError -Code 'usage-verifier' -Message 'Verified events require a trustworthy verifier type.'
    }
    $Hash = Get-SLSha256 $IdempotencyKey.Trim()
    $Event = [ordered] @{
        schemaVersion = 1
        eventType = 'usage'
        eventId = "SL-USE-$($Hash.Substring(0, 32).ToUpperInvariant())"
        idempotencyKey = "sha256:$Hash"
        artifactId = $ArtifactId
        artifactVersion = "sha256:$ArtifactContentHash"
        artifactContentHash = $ArtifactContentHash
        taskRunId = $TaskRunId
        applicationId = $ApplicationId
        stage = $Stage
        outcome = $Outcome
        verifierType = $VerifierType
        timestamp = Get-SLNormalizedTimestamp $Timestamp
    }
    if ($EvidenceRef) {
        $Event['evidenceRef'] = $EvidenceRef
    }
    $Event['scope'] = Normalize-SLScope $Scope
    return [pscustomobject] $Event
}

function Get-SLUsageEventPath {
    param([Parameter(Mandatory)][object] $Event)

    $ScopeEntry = Get-SLStateCatalogEntry (Normalize-SLScope $Event.scope)
    $ArtifactShard = Get-SLArtifactShardName ([string] $Event.artifactId)
    return "$($ScopeEntry.usageEventsPath)/$ArtifactShard/$(([string] $Event.timestamp).Substring(0, 7))/SL-usage-$(([string] $Event.eventId).Substring(7)).json"
}

function Get-SLUsageEvents {
    param([Parameter(Mandatory)][string] $Root)

    $LearningPath = Resolve-SLContainedPath -Root $Root -RelativePath $script:SLLearningRoot
    if (-not [IO.Directory]::Exists($LearningPath)) {
        return @()
    }
    $Files = @(
        [IO.Directory]::EnumerateFiles($LearningPath, '*.json', [IO.SearchOption]::AllDirectories) |
            Where-Object {
                $Relative = [IO.Path]::GetRelativePath($Root, $_).Replace('\', '/')
                $Relative.StartsWith("$script:SLUsageRoot/") -or
                $Relative -match '^\.github/SL-learning/SL-scopes/[^/]+/SL-usage-events/'
            }
    )
    [Array]::Sort($Files, [StringComparer]::Ordinal)
    $Events = [System.Collections.Generic.List[object]]::new()
    foreach ($File in $Files) {
        $Relative = [IO.Path]::GetRelativePath($Root, $File).Replace('\', '/')
        $Event = Read-SLJson -Root $Root -RelativePath $Relative
        Assert-SLUsageEvent $Event
        $Events.Add($Event)
    }
    return $Events.ToArray()
}

function Assert-SLUsageEvent {
    param([Parameter(Mandatory)][object] $Event)

    if (
        $Event.schemaVersion -ne 1 -or
        $Event.eventType -cnotin @('usage', 'legacy-baseline') -or
        [string] $Event.eventId -cnotmatch '^SL-USE-[A-F0-9]{32}$' -or
        [string] $Event.idempotencyKey -cnotmatch '^sha256:[a-f0-9]{64}$' -or
        [string] $Event.eventId -cne "SL-USE-$(([string] $Event.idempotencyKey).Substring(7, 32).ToUpperInvariant())" -or
        [string] $Event.artifactVersion -cne "sha256:$($Event.artifactContentHash)"
    ) {
        Throw-SLContractError -Code 'usage-event-integrity' -Message 'Usage event identity does not match its content.'
    }
    if ((Get-SLUsageEventPath $Event) -notmatch [Regex]::Escape(([string] $Event.eventId).Substring(7))) {
        Throw-SLContractError -Code 'usage-event-path' -Message 'Usage event path identity is invalid.'
    }
}

function Test-SLUsageEventEquivalent {
    param([Parameter(Mandatory)][object] $Left, [Parameter(Mandatory)][object] $Right)

    $LeftCopy = Copy-SLValue $Left
    $RightCopy = Copy-SLValue $Right
    if ($Left.eventType -ceq 'usage' -and $Right.eventType -ceq 'usage') {
        Remove-SLProperty $LeftCopy 'timestamp'
        Remove-SLProperty $RightCopy 'timestamp'
    }
    return (ConvertTo-SLCanonicalJson $LeftCopy) -ceq (ConvertTo-SLCanonicalJson $RightCopy)
}

function Write-SLUsageEvent {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][object] $Event,
        [switch] $DryRun
    )

    Assert-SLUsageEvent $Event
    $RelativePath = Get-SLUsageEventPath $Event
    $Path = Resolve-SLContainedPath -Root $Root -RelativePath $RelativePath
    if ([IO.File]::Exists($Path)) {
        $Existing = Read-SLJson -Root $Root -RelativePath $RelativePath
        if (-not (Test-SLUsageEventEquivalent $Existing $Event)) {
            Throw-SLContractError -Code 'usage-event-collision' -Message "Immutable SL usage event collision: $RelativePath"
        }
        return [pscustomobject] @{ action = 'skip'; path = $RelativePath; detail = 'idempotent event already recorded' }
    }
    if (-not $DryRun) {
        Update-SLMutationLease
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
        $Stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $Content = "$(ConvertTo-Json $Event -Depth 100)`n".Replace("`r`n", "`n").Replace("`r", "`n")
            $Bytes = [Text.UTF8Encoding]::new($false).GetBytes($Content)
            $Stream.Write($Bytes, 0, $Bytes.Length)
        }
        finally {
            $Stream.Dispose()
        }
    }
    return [pscustomobject] @{ action = 'create'; path = $RelativePath; detail = $(if ($DryRun) { 'planned' } else { 'written' }) }
}

function Assert-SLApplicationIdentity {
    param([object[]] $Events, [object] $Identity)

    foreach ($Event in $Events) {
        if (
            $Event.artifactId -cne $Identity.artifactId -or
            $Event.artifactVersion -cne $Identity.artifactVersion -or
            $Event.artifactContentHash -cne $Identity.artifactContentHash -or
            $Event.taskRunId -cne $Identity.taskRunId -or
            (Get-SLScopeKey $Event.scope) -cne (Get-SLScopeKey $Identity.scope)
        ) {
            Throw-SLContractError -Code 'usage-application-identity' -Message "Application ID $($Identity.applicationId) is already bound to different usage identity data."
        }
    }
}

function Get-SLUsageIdentity {
    param([string] $Root, [object] $Artifact, [AllowNull()][object] $Scope)

    if (
        $Artifact.artifactType -cnotin @('lesson', 'instruction', 'skill') -or
        $Artifact.classification -ceq 'system' -or
        [string] $Artifact.status -cnotin $script:SLActiveStatuses -or
        -not $Artifact.path
    ) {
        Throw-SLContractError -Code 'usage-inactive' -Message "Artifact $($Artifact.id) is not an active lesson, instruction, or skill."
    }
    $Snapshot = Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact
    $Hash = Get-SLArtifactUsageContentHash $Snapshot.content
    return [pscustomobject] @{
        artifactId = $Artifact.id
        artifactVersion = "sha256:$Hash"
        artifactContentHash = $Hash
        scope = Normalize-SLScope $(if ($null -ne $Scope) { $Scope } else { $Artifact.scope })
    }
}

function Start-SLUsage {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $ArtifactId,
        [AllowNull()][string] $ApplicationId,
        [AllowNull()][string] $TaskRunId,
        [AllowNull()][string] $IdempotencyKey,
        [AllowNull()][object] $Scope,
        [AllowNull()][string] $Now,
        [switch] $DryRun
    )

    return Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation {
        $Registry = Get-SLRegistry $Root
        $Artifact = Find-SLArtifact $Registry $ArtifactId
        $Identity = Get-SLUsageIdentity -Root $Root -Artifact $Artifact -Scope $Scope
        $Application = $(if ($ApplicationId) { $ApplicationId } else { "usage-$([Guid]::NewGuid().ToString())" })
        $Task = $(if ($TaskRunId) { $TaskRunId } else { $Application })
        Set-SLProperty $Identity 'taskRunId' $Task
        Set-SLProperty $Identity 'applicationId' $Application
        $Timestamp = Get-SLNormalizedTimestamp $Now
        $Base = $(if ($IdempotencyKey) { $IdempotencyKey } else { "usage-start:$ArtifactId`:$($Identity.artifactVersion):$Application" })
        $Events = @(Get-SLUsageEvents $Root)
        $ApplicationEvents = @($Events | Where-Object { $_.eventType -ceq 'usage' -and $_.applicationId -ceq $Application })
        Assert-SLApplicationIdentity $ApplicationEvents $Identity
        $Selected = New-SLUsageEvent -ArtifactId $ArtifactId -ArtifactContentHash $Identity.artifactContentHash -TaskRunId $Task -ApplicationId $Application -Stage selected -Outcome unknown -VerifierType unverified -Timestamp $Timestamp -IdempotencyKey "$Base`:selected" -Scope $Identity.scope
        $Applied = New-SLUsageEvent -ArtifactId $ArtifactId -ArtifactContentHash $Identity.artifactContentHash -TaskRunId $Task -ApplicationId $Application -Stage applied -Outcome unknown -VerifierType unverified -Timestamp $Timestamp -IdempotencyKey "$Base`:applied" -Scope $Identity.scope
        if ($ApplicationEvents.Count -gt 0) {
            $ExistingSelected = @($ApplicationEvents | Where-Object stage -ceq 'selected')
            $ExistingApplied = @($ApplicationEvents | Where-Object stage -ceq 'applied')
            if (
                $ApplicationEvents.Count -gt 2 -or
                $ExistingSelected.Count -ne 1 -or
                ($ExistingApplied.Count -gt 1) -or
                -not (Test-SLUsageEventEquivalent $ExistingSelected[0] $Selected) -or
                ($ExistingApplied.Count -eq 1 -and -not (Test-SLUsageEventEquivalent $ExistingApplied[0] $Applied))
            ) {
                Throw-SLContractError -Code 'usage-retry' -Message "Application ID $Application can only retry the exact selected and applied event identities."
            }
        }
        foreach ($Planned in @($Selected, $Applied)) {
            $Collision = @($Events | Where-Object { $_.eventId -ceq $Planned.eventId -or $_.idempotencyKey -ceq $Planned.idempotencyKey })
            if ($Collision.Count -gt 0 -and -not (Test-SLUsageEventEquivalent $Collision[0] $Planned)) {
                Throw-SLContractError -Code 'usage-event-collision' -Message "Immutable SL usage event collision: $(Get-SLUsageEventPath $Collision[0])"
            }
        }
        $Changes = [System.Collections.Generic.List[object]]::new()
        $Changes.Add((Write-SLUsageEvent -Root $Root -Event $Selected -DryRun:$DryRun))
        $Changes.Add((Write-SLUsageEvent -Root $Root -Event $Applied -DryRun:$DryRun))
        $Projected = @($Events)
        foreach ($Planned in @($Selected, $Applied)) {
            if (@($Projected | Where-Object eventId -ceq $Planned.eventId).Count -eq 0) {
                $Projected += $Planned
            }
        }
        [void] (Sync-SLProjection -Root $Root -DryRun:$DryRun -Changes $Changes -SuppliedEvents $Projected)
        return [pscustomobject] @{
            artifactId = $ArtifactId
            artifactVersion = $Identity.artifactVersion
            artifactContentHash = $Identity.artifactContentHash
            taskRunId = $Task
            applicationId = $Application
            receiptId = $Applied.eventId
            eventIds = [pscustomobject] @{ selected = $Selected.eventId; applied = $Applied.eventId }
            events = [pscustomobject] @{ selected = $Selected; applied = $Applied }
            changes = $Changes.ToArray()
        }
    }
}

function Finish-SLUsage {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $Reference,
        [Parameter(Mandatory)][ValidateSet('success', 'failure', 'partial', 'unknown')][string] $Outcome,
        [switch] $Verified,
        [AllowNull()][string] $VerifierType,
        [AllowNull()][string] $EvidenceRef,
        [AllowNull()][string] $IdempotencyKey,
        [AllowNull()][string] $Now,
        [switch] $DryRun
    )

    return Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation {
        $Events = @(Get-SLUsageEvents $Root)
        $Receipt = @($Events | Where-Object { $_.eventType -ceq 'usage' -and $_.eventId -ceq $Reference })
        $Application = if ($Receipt.Count -gt 0) {
            [string] $Receipt[0].applicationId
        }
        elseif (@($Events | Where-Object { $_.eventType -ceq 'usage' -and $_.applicationId -ceq $Reference }).Count -gt 0) {
            $Reference
        }
        else {
            Throw-SLContractError -Code 'usage-not-found' -Message "Usage application or receipt not found: $Reference"
        }
        $ApplicationEvents = @($Events | Where-Object { $_.eventType -ceq 'usage' -and $_.applicationId -ceq $Application })
        $First = $ApplicationEvents[0]
        if (@($ApplicationEvents | Where-Object stage -ceq 'applied').Count -ne 1) {
            Throw-SLContractError -Code 'usage-transition' -Message "Usage application $Application has not reached the applied stage."
        }
        $Identity = [pscustomobject] @{
            artifactId = $First.artifactId
            artifactVersion = $First.artifactVersion
            artifactContentHash = $First.artifactContentHash
            taskRunId = $First.taskRunId
            applicationId = $Application
            scope = $First.scope
        }
        Assert-SLApplicationIdentity $ApplicationEvents $Identity
        if ($Verified -and -not $VerifierType) {
            Throw-SLContractError -Code 'usage-verifier' -Message '--verified requires an explicit --verifier-type declaration.'
        }
        $Verifier = $(if ($VerifierType) { $VerifierType } else { 'unverified' })
        if ($Verified -and $Verifier.ToLowerInvariant() -cin @('none', 'self-report', 'self-reported', 'unknown', 'unverified')) {
            Throw-SLContractError -Code 'usage-verifier' -Message 'A verified outcome requires a trustworthy verifier type.'
        }
        $Stage = $(if ($Verified) { 'verified' } else { 'outcome' })
        $Key = $(if ($IdempotencyKey) {
            $IdempotencyKey
        } else {
            "usage-finish:$($First.artifactId):$($First.artifactVersion):$Application`:$Stage`:$Outcome`:$Verifier`:$EvidenceRef"
        })
        $Event = New-SLUsageEvent -ArtifactId $First.artifactId -ArtifactContentHash $First.artifactContentHash -TaskRunId $First.taskRunId -ApplicationId $Application -Stage $Stage -Outcome $Outcome -VerifierType $Verifier -Timestamp (Get-SLNormalizedTimestamp $Now) -IdempotencyKey $Key -EvidenceRef $EvidenceRef -Scope $First.scope
        $OtherTerminal = @($ApplicationEvents | Where-Object { $_.stage -cin @('outcome', 'verified') -and $_.eventId -cne $Event.eventId })
        if (@($OtherTerminal | Where-Object outcome -cne $Outcome).Count -gt 0) {
            Throw-SLContractError -Code 'usage-conflict' -Message "Usage application $Application already has a conflicting outcome."
        }
        if (@($OtherTerminal | Where-Object stage -ceq 'verified').Count -gt 0) {
            Throw-SLContractError -Code 'usage-conflict' -Message "Usage application $Application already has a verified outcome."
        }
        if ($Stage -ceq 'outcome' -and @($OtherTerminal | Where-Object stage -ceq 'outcome').Count -gt 0) {
            Throw-SLContractError -Code 'usage-conflict' -Message "Usage application $Application already has an unverified outcome."
        }
        $Change = Write-SLUsageEvent -Root $Root -Event $Event -DryRun:$DryRun
        $Changes = [System.Collections.Generic.List[object]]::new()
        $Changes.Add($Change)
        $Projected = @($Events)
        if (@($Projected | Where-Object eventId -ceq $Event.eventId).Count -eq 0) {
            $Projected += $Event
        }
        [void] (Sync-SLProjection -Root $Root -DryRun:$DryRun -Changes $Changes -SuppliedEvents $Projected)
        return [pscustomobject] @{
            artifactId = $First.artifactId
            artifactVersion = $First.artifactVersion
            artifactContentHash = $First.artifactContentHash
            taskRunId = $First.taskRunId
            applicationId = $Application
            receiptId = $Event.eventId
            outcome = $Outcome
            verified = [bool] $Verified
            verifierType = $Verifier
            event = $Event
            change = $Change
            changes = $Changes.ToArray()
        }
    }
}

function Project-SLUsageEvents {
    param([Parameter(Mandatory)][AllowNull()][AllowEmptyCollection()][object[]] $Events)

    $Events = @($Events | Where-Object { $null -ne $_ })
    $Unique = @{}
    foreach ($Event in @($Events | Sort-Object -Stable -Property @{ Expression = { [string] $_.eventId } })) {
        Assert-SLUsageEvent $Event
        if ($Unique.ContainsKey([string] $Event.eventId)) {
            if (-not (Test-SLUsageEventEquivalent $Unique[[string] $Event.eventId] $Event)) {
                Throw-SLContractError -Code 'usage-event-duplicate' -Message "Conflicting usage events share eventId $($Event.eventId)."
            }
            continue
        }
        $Unique[[string] $Event.eventId] = $Event
    }
    $ByIdempotency = @{}
    foreach ($Event in @($Unique.Values | Sort-Object -Stable -Property @{ Expression = { [string] $_.eventId } })) {
        if (-not $ByIdempotency.ContainsKey([string] $Event.idempotencyKey)) {
            $ByIdempotency[[string] $Event.idempotencyKey] = $Event
        }
    }
    $Groups = @{}
    foreach ($Event in @($ByIdempotency.Values)) {
        $Key = "$(Get-SLScopeKey $Event.scope)$([char]0)$($Event.artifactId)$([char]0)$($Event.artifactVersion)"
        if (-not $Groups.ContainsKey($Key)) {
            $Groups[$Key] = [System.Collections.Generic.List[object]]::new()
        }
        $Groups[$Key].Add($Event)
    }
    $Results = [System.Collections.Generic.List[object]]::new()
    foreach ($Group in @($Groups.Values)) {
        $Ordered = @($Group | Sort-Object -Stable -Property @(
            @{ Expression = { [string] $_.timestamp } },
            @{ Expression = { [string] $_.eventId } }
        ))
        $First = $Ordered[0]
        $Applications = @{}
        foreach ($Event in $Ordered) {
            if (-not $Applications.ContainsKey([string] $Event.applicationId)) {
                $Applications[[string] $Event.applicationId] = [System.Collections.Generic.List[object]]::new()
            }
            $Applications[[string] $Event.applicationId].Add($Event)
        }
        $RetrievalCount = 0
        $ApplicationCount = 0
        $OutcomeSuccess = 0
        $OutcomeFailure = 0
        $OutcomePartial = 0
        $OutcomeUnknown = 0
        $VerifiedSuccess = 0
        $VerifiedFailure = 0
        $Unknown = 0
        $LastRetrieved = $null
        $LastApplied = $null
        $LastSuccess = $null
        $LastFailure = $null
        foreach ($ApplicationEvents in @($Applications.Values)) {
            $RetrievalCount += 1
            $Selected = @($ApplicationEvents | Where-Object stage -ceq 'selected')
            $RetrievalCandidates = $(if ($Selected.Count -gt 0) { $Selected } else { @($ApplicationEvents)[0] })
            foreach ($Event in @($RetrievalCandidates)) {
                if (-not $LastRetrieved -or $Event.timestamp -cgt $LastRetrieved) { $LastRetrieved = [string] $Event.timestamp }
            }
            $Applied = @($ApplicationEvents | Where-Object { $_.stage -cin @('applied', 'outcome', 'verified') })
            if ($Applied.Count -eq 0) {
                continue
            }
            $ApplicationCount += 1
            $ExplicitApplied = @($ApplicationEvents | Where-Object stage -ceq 'applied')
            foreach ($Event in $(if ($ExplicitApplied.Count -gt 0) { $ExplicitApplied } else { @($Applied)[0] })) {
                if (-not $LastApplied -or $Event.timestamp -cgt $LastApplied) { $LastApplied = [string] $Event.timestamp }
            }
            $Terminal = @($ApplicationEvents | Where-Object { $_.stage -cin @('outcome', 'verified') })
            $Outcomes = @($Terminal | ForEach-Object { [string] $_.outcome } | Sort-Object -Unique)
            if ($Terminal.Count -gt 0) {
                if ($Outcomes.Count -eq 1 -and $Outcomes[0] -ceq 'success') { $OutcomeSuccess += 1 }
                elseif ($Outcomes.Count -eq 1 -and $Outcomes[0] -ceq 'failure') { $OutcomeFailure += 1 }
                elseif ($Outcomes.Count -eq 1 -and $Outcomes[0] -ceq 'partial') { $OutcomePartial += 1 }
                else { $OutcomeUnknown += 1 }
            }
            $Verified = @($ApplicationEvents | Where-Object stage -ceq 'verified')
            $VerifiedOutcomes = @($Verified | ForEach-Object { [string] $_.outcome } | Sort-Object -Unique)
            if ($VerifiedOutcomes.Count -eq 1 -and $VerifiedOutcomes[0] -ceq 'success') {
                $VerifiedSuccess += 1
                foreach ($Event in $Verified) {
                    if (-not $LastSuccess -or $Event.timestamp -cgt $LastSuccess) { $LastSuccess = [string] $Event.timestamp }
                }
            }
            elseif ($VerifiedOutcomes.Count -eq 1 -and $VerifiedOutcomes[0] -ceq 'failure') {
                $VerifiedFailure += 1
                foreach ($Event in $Verified) {
                    if (-not $LastFailure -or $Event.timestamp -cgt $LastFailure) { $LastFailure = [string] $Event.timestamp }
                }
            }
            else {
                $Unknown += 1
            }
        }
        $Resolved = $VerifiedSuccess + $VerifiedFailure
        $OutcomeCount = $OutcomeSuccess + $OutcomeFailure + $OutcomePartial + $OutcomeUnknown
        $OutcomeResolved = $OutcomeSuccess + $OutcomeFailure + $OutcomePartial
        $Projection = [ordered] @{
            scope = Normalize-SLScope $First.scope
            artifactId = $First.artifactId
            artifactVersion = $First.artifactVersion
            artifactContentHash = $First.artifactContentHash
            retrievalCount = [Math]::Max($RetrievalCount, $ApplicationCount)
            applicationCount = [Math]::Max($ApplicationCount, $Resolved + $Unknown)
            applicationRate = $(if ($RetrievalCount -eq 0) { $null } else { $ApplicationCount / $RetrievalCount })
            outcomeCount = $OutcomeCount
            outcomeSuccessCount = $OutcomeSuccess
            outcomeFailureCount = $OutcomeFailure
            outcomePartialCount = $OutcomePartial
            outcomeUnknownCount = $OutcomeUnknown
            outcomeSuccessRate = $(if ($OutcomeResolved -eq 0) { $null } else { $OutcomeSuccess / $OutcomeResolved })
            verifiedCount = $Resolved
            resolvedCount = $Resolved
            verifiedSuccessCount = $VerifiedSuccess
            verifiedFailureCount = $VerifiedFailure
            unknownCount = $Unknown
            verifiedSuccessRate = $(if ($Resolved -eq 0) { $null } else { $VerifiedSuccess / $Resolved })
        }
        foreach ($Pair in @(
            @('lastRetrievedAt', $LastRetrieved),
            @('lastAppliedAt', $LastApplied),
            @('lastVerifiedSuccessAt', $LastSuccess),
            @('lastVerifiedFailureAt', $LastFailure)
        )) {
            if ($Pair[1]) { $Projection[$Pair[0]] = $Pair[1] }
        }
        $Results.Add([pscustomobject] $Projection)
    }
    return @($Results | Sort-Object -Stable -Property @(
        @{ Expression = { Get-SLScopeKey $_.scope } },
        @{ Expression = { [string] $_.artifactId } },
        @{ Expression = { [string] $_.artifactVersion } }
    ))
}

function Set-SLArtifactFrontmatterStatus {
    param(
        [string] $Root,
        [object] $Artifact,
        [string] $Status,
        [System.Collections.Generic.List[object]] $Changes,
        [switch] $DryRun
    )

    if (-not $Artifact.path -or -not ([string] $Artifact.path).EndsWith('.md')) {
        return
    }
    $Snapshot = Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact
    Set-SLProperty $Snapshot.frontmatter 'status' $Status
    Write-SLTextChange -Root $Root -RelativePath ([string] $Artifact.path) -Content (
        ConvertTo-SLFrontmatterText -Frontmatter $Snapshot.frontmatter -Body $Snapshot.body
    ) -Changes $Changes -DryRun:$DryRun
}

function Sync-SLProjection {
    param(
        [Parameter(Mandatory)][string] $Root,
        [switch] $DryRun,
        [AllowNull()][System.Collections.Generic.List[object]] $Changes,
        [AllowNull()][object[]] $SuppliedEvents
    )

    if ($null -eq $Changes) {
        $Changes = [System.Collections.Generic.List[object]]::new()
    }
    $Registry = Get-SLRegistry $Root
    $Events = if ($null -ne $SuppliedEvents) { @($SuppliedEvents) } else { @(Get-SLUsageEvents $Root) }
    $Projections = @(Project-SLUsageEvents $Events)
    foreach ($Artifact in @($Registry.artifacts)) {
        if ($Artifact.classification -ceq 'system' -or -not $Artifact.path -or $Artifact.status -ceq 'deleted') {
            continue
        }
        $Snapshot = $null
        try {
            $Snapshot = Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact
        }
        catch {
            if (@($Events | Where-Object artifactId -ceq $Artifact.id).Count -gt 0) {
                throw
            }
            continue
        }
        $Hash = Get-SLArtifactUsageContentHash $Snapshot.content
        $Version = "sha256:$Hash"
        $OwningKey = Get-SLScopeKey (Get-SLProperty $Artifact 'scope' $script:SLDefaultScope)
        $Current = @($Projections | Where-Object {
            $_.artifactId -ceq $Artifact.id -and
            $_.artifactVersion -ceq $Version -and
            (Get-SLScopeKey $_.scope) -ceq $OwningKey
        })
        $CurrentProjection = if ($Current.Count -gt 0) {
            $Current[0]
        }
        elseif (@($Events | Where-Object artifactId -ceq $Artifact.id).Count -gt 0) {
            [pscustomobject] @{
                scope = Normalize-SLScope (Get-SLProperty $Artifact 'scope' $script:SLDefaultScope)
                artifactId = $Artifact.id
                artifactVersion = $Version
                artifactContentHash = $Hash
                retrievalCount = 0
                applicationCount = 0
                applicationRate = $null
                outcomeCount = 0
                outcomeSuccessCount = 0
                outcomeFailureCount = 0
                outcomePartialCount = 0
                outcomeUnknownCount = 0
                outcomeSuccessRate = $null
                verifiedCount = 0
                resolvedCount = 0
                verifiedSuccessCount = 0
                verifiedFailureCount = 0
                unknownCount = 0
                verifiedSuccessRate = $null
            }
        }
        else {
            $null
        }
        if ($null -ne $CurrentProjection) {
            Set-SLProperty $Artifact 'usageProjection' $CurrentProjection
            if (Test-SLProperty $CurrentProjection 'lastRetrievedAt') {
                Set-SLProperty $Artifact 'lastRetrievedAt' $CurrentProjection.lastRetrievedAt
            }
            else {
                Remove-SLProperty $Artifact 'lastRetrievedAt'
            }
        }
        else {
            Remove-SLProperty $Artifact 'usageProjection'
            Remove-SLProperty $Artifact 'lastRetrievedAt'
        }
        $Successes = @($Projections | Where-Object {
            $_.artifactId -ceq $Artifact.id -and
            $_.artifactVersion -ceq $Version -and
            (Test-SLProperty $_ 'lastVerifiedSuccessAt')
        } | ForEach-Object { [string] $_.lastVerifiedSuccessAt })
        if ($Successes.Count -gt 0) {
            $Latest = @($Successes | Sort-Object -Descending)[0]
            Set-SLProperty $Artifact 'lastSuccessfulUseAt' $Latest
        }
        else {
            Remove-SLProperty $Artifact 'lastSuccessfulUseAt'
        }
        $NextStatus = [string] $Artifact.status
        if ($Artifact.classification -ceq 'evidence' -and $Artifact.status -cnotin @('promoted', 'superseded', 'quarantined', 'deleted')) {
            if ($null -ne $CurrentProjection) {
                if ($CurrentProjection.verifiedSuccessCount -ge 3) { $NextStatus = 'promotion-candidate' }
                elseif ($CurrentProjection.verifiedSuccessCount -ge 2) { $NextStatus = 'distilled' }
                else { $NextStatus = 'raw' }
            }
        }
        elseif (
            $Artifact.classification -ceq 'promoted' -and
            $Artifact.status -cin @('stale', 'quarantined') -and
            $Successes.Count -gt 0
        ) {
            $InactiveAt = $(if ($Artifact.status -ceq 'stale') { Get-SLProperty $Artifact 'staleAt' } else { Get-SLProperty $Artifact 'quarantinedAt' })
            if ($InactiveAt -and $Latest -cgt [string] $InactiveAt) {
                $NextStatus = 'probation'
            }
        }
        if ($NextStatus -cne $Artifact.status) {
            $OldStatus = [string] $Artifact.status
            if ($NextStatus -ceq 'probation' -and $Artifact.classification -ceq 'promoted') {
                Move-SLPromotionToProbation -Root $Root -Artifact $Artifact -Changes $Changes -DryRun:$DryRun
                Remove-SLProperty $Artifact 'promotionEvaluation'
                Remove-SLProperty $Artifact 'activatedAt'
                Remove-SLProperty $Artifact 'quarantinedAt'
                Remove-SLProperty $Artifact 'deleteEligibleAt'
            }
            Set-SLProperty $Artifact 'status' $NextStatus
            if ($NextStatus -cne 'probation') {
                Set-SLProperty $Snapshot.frontmatter 'status' $NextStatus
                Write-SLTextChange -Root $Root -RelativePath ([string] $Artifact.path) -Content (
                    ConvertTo-SLFrontmatterText -Frontmatter $Snapshot.frontmatter -Body $Snapshot.body
                ) -Changes $Changes -DryRun:$DryRun
            }
            if ($OldStatus -ceq 'stale' -and $NextStatus -cne 'stale') {
                Remove-SLProperty $Artifact 'staleAt'
                Remove-SLProperty $Artifact 'forgetReason'
                Remove-SLProperty $Artifact 'previousStatus'
            }
        }
    }
    [void] (Save-SLRegistry -Root $Root -Registry $Registry -Changes $Changes -DryRun:$DryRun)
    Write-SLIndexes -Root $Root -Registry $Registry -Changes $Changes -Projections $Projections -DryRun:$DryRun
    return $Registry
}

function Vote-SLLesson {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $ArtifactId,
        [Parameter(Mandatory)][ValidateSet('useful', 'not-useful')][string] $Result,
        [AllowNull()][string] $ApplicationId,
        [AllowNull()][string] $TaskRunId,
        [AllowNull()][string] $IdempotencyKey,
        [AllowNull()][string] $VerifierType,
        [AllowNull()][string] $EvidenceRef,
        [AllowNull()][object] $Scope,
        [AllowNull()][string] $Now,
        [switch] $DryRun
    )

    return Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation {
        $Registry = Get-SLRegistry $Root
        $Artifact = Find-SLArtifact $Registry $ArtifactId
        if ($Artifact.artifactType -cne 'lesson' -or $Artifact.classification -cne 'evidence') {
            Throw-SLContractError -Code 'vote-artifact' -Message 'Only SL lesson evidence can receive reuse votes.'
        }
        $Identity = Get-SLUsageIdentity -Root $Root -Artifact $Artifact -Scope $Scope
        $Application = $(if ($ApplicationId) { $ApplicationId } else { "vote-$([Guid]::NewGuid().ToString())" })
        $Task = $(if ($TaskRunId) { $TaskRunId } else { $Application })
        $Key = $(if ($IdempotencyKey) { $IdempotencyKey } else { "lesson-vote:$ArtifactId`:$($Identity.artifactVersion):$Application" })
        $Event = New-SLUsageEvent -ArtifactId $ArtifactId -ArtifactContentHash $Identity.artifactContentHash -TaskRunId $Task -ApplicationId $Application -Stage verified -Outcome $(if ($Result -ceq 'useful') { 'success' } else { 'failure' }) -VerifierType $(if ($VerifierType) { $VerifierType } else { 'lesson-vote' }) -Timestamp (Get-SLNormalizedTimestamp $Now) -IdempotencyKey $Key -EvidenceRef $EvidenceRef -Scope $Identity.scope
        $Events = @(Get-SLUsageEvents $Root)
        $ApplicationEvents = @($Events | Where-Object { $_.eventType -ceq 'usage' -and $_.applicationId -ceq $Application })
        Assert-SLApplicationIdentity $ApplicationEvents ([pscustomobject] @{
            artifactId = $ArtifactId
            artifactVersion = $Identity.artifactVersion
            artifactContentHash = $Identity.artifactContentHash
            taskRunId = $Task
            applicationId = $Application
            scope = $Identity.scope
        })
        $ExistingVerified = @($ApplicationEvents | Where-Object stage -ceq 'verified')
        if ($ExistingVerified.Count -gt 0 -and -not (Test-SLUsageEventEquivalent $ExistingVerified[0] $Event)) {
            Throw-SLContractError -Code 'usage-vote-conflict' -Message "Application ID $Application already has a different verified stage."
        }
        $Changes = [System.Collections.Generic.List[object]]::new()
        $Changes.Add((Write-SLUsageEvent -Root $Root -Event $Event -DryRun:$DryRun))
        $Projected = @($Events)
        if (@($Projected | Where-Object eventId -ceq $Event.eventId).Count -eq 0) { $Projected += $Event }
        [void] (Sync-SLProjection -Root $Root -DryRun:$DryRun -Changes $Changes -SuppliedEvents $Projected)
        return [pscustomobject] @{ event = $Event; changes = $Changes.ToArray() }
    }
}

function Get-SLUsageProjection {
    param([Parameter(Mandatory)][string] $Root, [AllowNull()][string] $ArtifactId)

    $Projections = @(Project-SLUsageEvents (Get-SLUsageEvents $Root))
    if ($ArtifactId) {
        $Projections = @($Projections | Where-Object artifactId -ceq $ArtifactId)
    }
    return $Projections
}

function Get-SLUsageScopeAggregates {
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]] $Projections)

    $Groups = @{}
    foreach ($Projection in $Projections) {
        $Key = Get-SLScopeKey $Projection.scope
        if (-not $Groups.ContainsKey($Key)) {
            $Groups[$Key] = [pscustomobject] @{
                scope = $Projection.scope
                retrievalCount = 0
                applicationCount = 0
                outcomeCount = 0
                outcomeSuccessCount = 0
                outcomeFailureCount = 0
                outcomePartialCount = 0
                outcomeUnknownCount = 0
                verifiedCount = 0
                verifiedSuccessCount = 0
                verifiedFailureCount = 0
            }
        }
        $Group = $Groups[$Key]
        foreach ($Name in @(
            'retrievalCount', 'applicationCount', 'outcomeCount',
            'outcomeSuccessCount', 'outcomeFailureCount',
            'outcomePartialCount', 'outcomeUnknownCount', 'verifiedCount',
            'verifiedSuccessCount', 'verifiedFailureCount'
        )) {
            $Group.$Name += [int] $Projection.$Name
        }
    }
    $Results = foreach ($Group in $Groups.Values) {
        $ResolvedOutcomes = $Group.outcomeSuccessCount + $Group.outcomeFailureCount + $Group.outcomePartialCount
        [pscustomobject] @{
            scope = $Group.scope
            retrievalCount = $Group.retrievalCount
            applicationCount = $Group.applicationCount
            outcomeCount = $Group.outcomeCount
            outcomeSuccessCount = $Group.outcomeSuccessCount
            outcomeFailureCount = $Group.outcomeFailureCount
            outcomePartialCount = $Group.outcomePartialCount
            outcomeUnknownCount = $Group.outcomeUnknownCount
            verifiedCount = $Group.verifiedCount
            verifiedSuccessCount = $Group.verifiedSuccessCount
            verifiedFailureCount = $Group.verifiedFailureCount
            applicationRate = $(if ($Group.retrievalCount -eq 0) { $null } else { $Group.applicationCount / $Group.retrievalCount })
            outcomeSuccessRate = $(if ($ResolvedOutcomes -eq 0) { $null } else { $Group.outcomeSuccessCount / $ResolvedOutcomes })
            verifiedSuccessRate = $(if ($Group.verifiedCount -eq 0) { $null } else { $Group.verifiedSuccessCount / $Group.verifiedCount })
        }
    }
    return @($Results | Sort-Object -Stable -Property @{ Expression = { Get-SLScopeKey $_.scope } })
}

function Get-SLUsageRepositoryAggregate {
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]] $Projections)

    $Scopes = @(Get-SLUsageScopeAggregates $Projections)
    $Result = [ordered] @{
        aggregation = 'repository-counts-only'
        scopeCount = $Scopes.Count
    }
    foreach ($Name in @(
        'retrievalCount', 'applicationCount', 'outcomeCount',
        'outcomeSuccessCount', 'outcomeFailureCount',
        'outcomePartialCount', 'outcomeUnknownCount', 'verifiedCount',
        'verifiedSuccessCount', 'verifiedFailureCount'
    )) {
        $Value = ($Scopes | Measure-Object -Property $Name -Sum).Sum
        $Result[$Name] = $(if ($null -eq $Value) { 0 } else { [int] $Value })
    }
    $Result['successRate'] = $null
    $Result['successRateReason'] = 'rates-are-reported-per-scope'
    return [pscustomobject] $Result
}
