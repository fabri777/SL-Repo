Set-StrictMode -Version Latest

$script:SLRuntimeVersion = '0.2.0'
$script:SLExitCodes = @{
    Success = 0
    Usage = 2
    PowerShellVersion = 3
    RepositoryRoot = 4
    Manifest = 5
    Integrity = 6
    MixedVersion = 7
    Validation = 8
    IO = 9
    Internal = 10
}

. (Join-Path $PSScriptRoot 'SL.Runtime.Core.ps1')
. (Join-Path $PSScriptRoot 'SL.Runtime.Syntax.ps1')
. (Join-Path $PSScriptRoot 'SL.Runtime.State.ps1')
. (Join-Path $PSScriptRoot 'SL.Runtime.Artifacts.ps1')
. (Join-Path $PSScriptRoot 'SL.Runtime.Promotion.ps1')
. (Join-Path $PSScriptRoot 'SL.Runtime.Lifecycle.ps1')
. (Join-Path $PSScriptRoot 'SL.Runtime.Conformance.ps1')
. (Join-Path $PSScriptRoot 'SL.Runtime.Doctor.ps1')
. (Join-Path $PSScriptRoot 'SL.Runtime.Validation.ps1')

function Get-SLRuntimeHelp {
    return [pscustomobject] @{
        name = 'SL'
        runtimeVersion = $script:SLRuntimeVersion
        usage = 'SL.ps1 [--json] [--dry-run] [--repo-root <path>] <command> [arguments] [options]'
        commands = @(
            [pscustomobject] @{ name = 'root'; description = 'Discover the repository root.' }
            [pscustomobject] @{ name = 'scope list|resolve|validate'; description = 'List, resolve, or validate hierarchical scopes.' }
            [pscustomobject] @{ name = 'retrieve'; description = 'Retrieve active guidance in deterministic precedence order.' }
            [pscustomobject] @{ name = 'capture'; description = 'Capture and register lesson evidence.' }
            [pscustomobject] @{ name = 'vote'; description = 'Record a verified useful/not-useful outcome.' }
            [pscustomobject] @{ name = 'use start|finish'; description = 'Record an application lifecycle.' }
            [pscustomobject] @{ name = 'project'; description = 'Rebuild state catalogs, registries, indexes, and usage projections.' }
            [pscustomobject] @{ name = 'stats'; description = 'Read immutable usage projections.' }
            [pscustomobject] @{ name = 'promotion register|evaluate|approve|activate'; description = 'Govern promotion probation and activation.' }
            [pscustomobject] @{ name = 'validate'; description = 'Validate schemas, ownership, events, shards, projections, and runtime drift.' }
            [pscustomobject] @{ name = 'forget|undo|sweep'; description = 'Quarantine, restore, and apply retention policy.' }
            [pscustomobject] @{ name = 'doctor'; description = 'Diagnose repository and runtime health.' }
            [pscustomobject] @{ name = 'conformance'; description = 'Run shared TypeScript/PowerShell contract vectors.' }
            [pscustomobject] @{ name = 'version'; description = 'Show runtime and contract versions.' }
        )
    }
}

function Write-SLRuntimeOutput {
    param(
        [Parameter(Mandatory)][AllowNull()][object] $Value,
        [switch] $Json
    )

    if ($Json) {
        [Console]::Out.WriteLine((ConvertTo-SLCanonicalJson -Value $Value))
        return
    }
    if ($Value -is [string]) {
        [Console]::Out.WriteLine($Value)
        return
    }
    if (Test-SLProperty $Value 'usage') {
        [Console]::Out.WriteLine($Value.usage)
        foreach ($Command in @($Value.commands)) {
            [Console]::Out.WriteLine("  $($Command.name) - $($Command.description)")
        }
        return
    }
    if (Test-SLProperty $Value 'changes') {
        foreach ($Change in @($Value.changes)) {
            [Console]::Out.WriteLine("$(([string] $Change.action).ToUpperInvariant().PadRight(6)) $($Change.path) - $($Change.detail)")
        }
        if (@($Value.changes).Count -eq 0) {
            [Console]::Out.WriteLine('No changes.')
        }
        return
    }
    if (Test-SLProperty $Value 'issues') {
        foreach ($Issue in @($Value.issues)) {
            [Console]::Out.WriteLine("$(([string] $Issue.severity).ToUpperInvariant()) $($Issue.code)$(if (Test-SLProperty $Issue 'path') { " $($Issue.path)" }) - $($Issue.message)")
        }
        if (@($Value.issues).Count -eq 0) {
            [Console]::Out.WriteLine('SL validation passed.')
        }
        return
    }
    [Console]::Out.WriteLine((ConvertTo-SLCanonicalJson -Value $Value))
}

function Write-SLRuntimeError {
    param([string] $Code, [string] $Message, [switch] $Json)

    if ($Json) {
        [Console]::Error.WriteLine((ConvertTo-SLCanonicalJson ([pscustomobject] @{
            error = [pscustomobject] @{ code = $Code; message = $Message }
        })))
    }
    else {
        [Console]::Error.WriteLine($Message)
    }
}

function ConvertFrom-SLArguments {
    param([Parameter(Mandatory)][string[]] $Arguments)

    $Flags = @{}
    $Positionals = [System.Collections.Generic.List[string]]::new()
    $ValueOptions = @(
        '--repo-root', '--file', '--path', '--current-directory', '--changed-path',
        '--title', '--kind', '--state-scope', '--state-scope-id', '--scope',
        '--lesson-scope', '--target-path', '--trigger', '--result',
        '--task-run-id', '--application-id', '--idempotency-key',
        '--verifier-type', '--evidence-ref', '--outcome', '--aggregate',
        '--approval-ref', '--owner-approval-ref', '--target-scope', '--reason',
        '--now'
    )
    $SwitchOptions = @(
        '--json', '--dry-run', '--help', '--useful', '--not-useful',
        '--verified', '--execute-checks', '--undo'
    )
    for ($Index = 0; $Index -lt $Arguments.Count; $Index += 1) {
        $Argument = $Arguments[$Index]
        if ($Argument -cin $SwitchOptions) {
            $Flags[$Argument] = $true
            continue
        }
        if ($Argument -cin $ValueOptions) {
            if ($Index + 1 -ge $Arguments.Count) {
                Throw-SLContractError -Code 'usage' -Message "$Argument requires a value."
            }
            $Index += 1
            if ($Argument -cin @('--trigger', '--changed-path')) {
                if (-not $Flags.ContainsKey($Argument)) { $Flags[$Argument] = [System.Collections.Generic.List[string]]::new() }
                $Flags[$Argument].Add($Arguments[$Index])
            }
            else {
                $Flags[$Argument] = $Arguments[$Index]
            }
            continue
        }
        if ($Argument.StartsWith('-')) {
            Throw-SLContractError -Code 'usage' -Message "Unknown option: $Argument"
        }
        $Positionals.Add($Argument)
    }
    return [pscustomobject] @{ flags = $Flags; positionals = $Positionals.ToArray() }
}

function Get-SLFlag {
    param([hashtable] $Flags, [string] $Name, [AllowNull()][object] $Default = $null)
    return $(if ($Flags.ContainsKey($Name)) { $Flags[$Name] } else { $Default })
}

function Get-SLCommandRoot {
    param([hashtable] $Flags, [AllowNull()][string] $Path)

    $Start = [string] (Get-SLFlag $Flags '--repo-root' $(if ($Path) { $Path } else { (Get-Location).Path }))
    return Get-SLRepositoryRoot -StartPath $Start
}

function Get-SLApplicationScopeOption {
    param([string] $Root, [hashtable] $Flags)

    $ScopeId = [string] (Get-SLFlag $Flags '--scope' '')
    $TargetPath = [string] (Get-SLFlag $Flags '--target-path' '')
    if (-not $ScopeId -and -not $TargetPath) { return $null }
    return (Resolve-SLScopeDescriptor -Root $Root -ScopeId $ScopeId -TargetPath $TargetPath).scope
}

function Invoke-SLRuntimeCommand {
    param(
        [string] $Command,
        [string[]] $Positionals,
        [hashtable] $Flags,
        [string] $RuntimeHome
    )

    $Json = [bool] (Get-SLFlag $Flags '--json' $false)
    $DryRun = [bool] (Get-SLFlag $Flags '--dry-run' $false)
    if ($Command -cin @('help', 'version')) {
        $Value = if ($Command -ceq 'help') {
            Get-SLRuntimeHelp
        } else {
            [pscustomobject] @{
                runtimeVersion = $script:SLRuntimeVersion
                schemaVersion = 1
                configContractVersion = 1
                conformanceVersion = 1
                minimumPowerShellVersion = '7.0.0'
                dryRun = $DryRun
            }
        }
        Write-SLRuntimeOutput $Value -Json:$Json
        return $script:SLExitCodes.Success
    }
    $PathPosition = switch ($Command) {
        'scope' {
            if ($Positionals.Count -gt 0 -and $Positionals[0] -cin @('list', 'resolve', 'validate')) {
                if ($Positionals.Count -gt 1) { $Positionals[1] } else { $null }
            }
            elseif ($Positionals.Count -gt 0) { $Positionals[0] } else { $null }
            break
        }
        { $_ -cin @('vote', 'use-start', 'use-finish', 'evaluate', 'promotion-evaluate', 'promotion-approve', 'promotion-activate', 'forget', 'undo') } {
            if ($Positionals.Count -gt 1) { $Positionals[1] } else { $null }
            break
        }
        'promotion-register' {
            if ($Positionals.Count -gt 2) { $Positionals[2] } else { $null }
            break
        }
        { $_ -cin @('stats', 'usage') } {
            if ($Positionals.Count -gt 0 -and $Positionals[0].StartsWith('SL-')) {
                if ($Positionals.Count -gt 1) { $Positionals[1] } else { $null }
            }
            elseif ($Positionals.Count -gt 0) { $Positionals[0] } else { $null }
            break
        }
        default {
            if ($Positionals.Count -gt 0) { $Positionals[0] } else { $null }
        }
    }
    $Root = Get-SLCommandRoot -Flags $Flags -Path $PathPosition
    if ($Command -cnotin @('root', 'doctor', 'validate', 'validate-runtime', 'conformance')) {
        $Integrity = Test-SLRuntimeInstallation -RuntimeHome $RuntimeHome -ExpectedRuntimeVersion $script:SLRuntimeVersion
        if (-not $Integrity.healthy) {
            Write-SLRuntimeOutput ([pscustomobject] @{
                command = $Command
                repositoryRoot = $Root
                dryRun = $DryRun
                healthy = $false
                checks = $Integrity.checks
            }) -Json:$Json
            if (@($Integrity.checks | Where-Object code -ceq 'runtime-manifest-missing').Count) { return $script:SLExitCodes.Manifest }
            if (@($Integrity.checks | Where-Object code -ceq 'runtime-mixed-version').Count) { return $script:SLExitCodes.MixedVersion }
            return $script:SLExitCodes.Integrity
        }
    }
    switch -CaseSensitive ($Command) {
        'root' {
            Write-SLRuntimeOutput ([pscustomobject] @{ repositoryRoot = $Root }) -Json:$Json
        }
        'scope' {
            $Action = if ($Positionals.Count -gt 0 -and $Positionals[0] -cin @('list', 'resolve', 'validate')) { $Positionals[0] } else { 'resolve' }
            $Catalog = Get-SLScopeCatalog $Root
            if ($Action -ceq 'list') {
                $Scopes = @($Catalog.scopes | ForEach-Object {
                    $Copy = Copy-SLValue $_
                    Set-SLProperty $Copy 'state' (Get-SLScopeDescriptor $_)
                    $Copy
                })
                Write-SLRuntimeOutput $Scopes -Json:$Json
            }
            elseif ($Action -ceq 'validate') {
                Write-SLRuntimeOutput ([pscustomobject] @{ valid = $true; scopeCount = @($Catalog.scopes).Count }) -Json:$Json
            }
            else {
                $Changed = @(Get-SLFlag $Flags '--changed-path' @())
                $File = [string] (Get-SLFlag $Flags '--file' '')
                $Directory = [string] (Get-SLFlag $Flags '--current-directory' '')
                $SelectedCount = @([bool] $File, [bool] $Directory, ($Changed.Count -gt 0) | Where-Object { $_ }).Count
                if ($SelectedCount -gt 1) {
                    Throw-SLContractError -Code 'usage' -Message 'Choose exactly one of --file, --current-directory, or --changed-path.'
                }
                if ($Changed.Count -gt 0) {
                    $Paths = @($Changed | ForEach-Object { Resolve-SLScope -Root $Root -Path $_ -Catalog $Catalog })
                    $PrimaryIds = @($Paths.primaryScopeId | Select-Object -Unique)
                    $OrderedIds = [System.Collections.Generic.List[string]]::new()
                    foreach ($PathResult in $Paths) {
                        foreach ($Id in $PathResult.orderedScopeIds) {
                            if (-not $OrderedIds.Contains([string] $Id)) { $OrderedIds.Add([string] $Id) }
                        }
                    }
                    $Result = [pscustomobject] @{ paths = $Paths; primaryScopeIds = $PrimaryIds; orderedScopeIds = $OrderedIds.ToArray() }
                }
                else {
                    $Result = Resolve-SLScope -Root $Root -Path $(if ($File) { $File } elseif ($Directory) { $Directory } else { (Get-Location).Path }) -Catalog $Catalog
                }
                Write-SLRuntimeOutput $Result -Json:$Json
            }
        }
        'capture' {
            $Title = [string] (Get-SLFlag $Flags '--title' '')
            $Triggers = @(Get-SLFlag $Flags '--trigger' @())
            if (-not $Title) { Throw-SLContractError -Code 'usage' -Message 'capture requires --title.' }
            $ScopeOption = [string] (Get-SLFlag $Flags '--scope' '')
            $ScopeId = $(if ($ScopeOption.StartsWith('SL-SCOPE-')) { $ScopeOption } else { $null })
            $LessonScope = [string] (Get-SLFlag $Flags '--lesson-scope' $(if ($ScopeOption) { $ScopeOption } else { 'repository' }))
            $Result = New-SLCaptureLesson -Root $Root -Title $Title -Kind ([string] (Get-SLFlag $Flags '--kind' 'win')) -LessonScope $LessonScope -Triggers $Triggers -ScopeId $ScopeId -TargetPath ([string] (Get-SLFlag $Flags '--target-path' '')) -StateScopePath ([string] (Get-SLFlag $Flags '--state-scope' '')) -StateScopeId ([string] (Get-SLFlag $Flags '--state-scope-id' '')) -Now ([string] (Get-SLFlag $Flags '--now' '')) -DryRun:$DryRun
            Write-SLRuntimeOutput $Result -Json:$Json
        }
        'retrieve' {
            $Target = [string] (Get-SLFlag $Flags '--path' '')
            if (-not $Target) { Throw-SLContractError -Code 'usage' -Message 'retrieve requires --path.' }
            Write-SLRuntimeOutput (Get-SLRetrievedArtifacts -Root $Root -TargetPath $Target -Trigger ([string] (Get-SLFlag $Flags '--trigger' ''))) -Json:$Json
        }
        'vote' {
            if ($Positionals.Count -lt 1) { Throw-SLContractError -Code 'usage' -Message 'vote requires an artifact ID.' }
            if ((Get-SLFlag $Flags '--useful' $false) -and (Get-SLFlag $Flags '--not-useful' $false)) {
                Throw-SLContractError -Code 'usage' -Message 'Choose either --useful or --not-useful, not both.'
            }
            $ResultName = if (Get-SLFlag $Flags '--not-useful' $false) { 'not-useful' } elseif (Get-SLFlag $Flags '--useful' $false) { 'useful' } else { [string] (Get-SLFlag $Flags '--result' 'useful') }
            $Result = Vote-SLLesson -Root $Root -ArtifactId $Positionals[0] -Result $ResultName -ApplicationId ([string] (Get-SLFlag $Flags '--application-id' '')) -TaskRunId ([string] (Get-SLFlag $Flags '--task-run-id' '')) -IdempotencyKey ([string] (Get-SLFlag $Flags '--idempotency-key' '')) -VerifierType ([string] (Get-SLFlag $Flags '--verifier-type' 'lesson-vote')) -EvidenceRef ([string] (Get-SLFlag $Flags '--evidence-ref' '')) -Scope (Get-SLApplicationScopeOption $Root $Flags) -Now ([string] (Get-SLFlag $Flags '--now' '')) -DryRun:$DryRun
            Write-SLRuntimeOutput $Result -Json:$Json
        }
        'use-start' {
            if ($Positionals.Count -lt 1) { Throw-SLContractError -Code 'usage' -Message 'use start requires an artifact ID.' }
            $Result = Start-SLUsage -Root $Root -ArtifactId $Positionals[0] -ApplicationId ([string] (Get-SLFlag $Flags '--application-id' '')) -TaskRunId ([string] (Get-SLFlag $Flags '--task-run-id' '')) -IdempotencyKey ([string] (Get-SLFlag $Flags '--idempotency-key' '')) -Scope (Get-SLApplicationScopeOption $Root $Flags) -Now ([string] (Get-SLFlag $Flags '--now' '')) -DryRun:$DryRun
            Write-SLRuntimeOutput $Result -Json:$Json
        }
        'use-finish' {
            if ($Positionals.Count -lt 1) { Throw-SLContractError -Code 'usage' -Message 'use finish requires a receipt or application ID.' }
            $Outcome = [string] (Get-SLFlag $Flags '--outcome' '')
            if (-not $Outcome) { Throw-SLContractError -Code 'usage' -Message 'use finish requires --outcome.' }
            $Result = Finish-SLUsage -Root $Root -Reference $Positionals[0] -Outcome $Outcome -Verified:([bool] (Get-SLFlag $Flags '--verified' $false)) -VerifierType ([string] (Get-SLFlag $Flags '--verifier-type' '')) -EvidenceRef ([string] (Get-SLFlag $Flags '--evidence-ref' '')) -IdempotencyKey ([string] (Get-SLFlag $Flags '--idempotency-key' '')) -Now ([string] (Get-SLFlag $Flags '--now' '')) -DryRun:$DryRun
            Write-SLRuntimeOutput $Result -Json:$Json
        }
        { $_ -cin @('project', 'index') } {
            $Changes = [System.Collections.Generic.List[object]]::new()
            [void] (Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation { Sync-SLProjection -Root $Root -DryRun:$DryRun -Changes $Changes })
            Write-SLRuntimeOutput ([pscustomobject] @{ changes = $Changes.ToArray() }) -Json:$Json
        }
        { $_ -cin @('stats', 'usage') } {
            $ArtifactId = if ($Positionals.Count -gt 0 -and $Positionals[0].StartsWith('SL-')) { $Positionals[0] } else { $null }
            $Projections = @(Get-SLUsageProjection -Root $Root -ArtifactId $ArtifactId)
            $ScopeId = [string] (Get-SLFlag $Flags '--scope' '')
            if ($ScopeId) { $Projections = @($Projections | Where-Object { $_.scope.id -ceq $ScopeId }) }
            $Aggregate = [string] (Get-SLFlag $Flags '--aggregate' 'artifact')
            [object] $Output = $null
            if ($Aggregate -ceq 'artifact') {
                $Output = [object[]] $Projections
            }
            elseif ($Aggregate -ceq 'scope') {
                $Output = [object[]] @(Get-SLUsageScopeAggregates $Projections)
            }
            elseif ($Aggregate -ceq 'repository') {
                $Output = Get-SLUsageRepositoryAggregate $Projections
            }
            else {
                Throw-SLContractError -Code 'usage' -Message '--aggregate must be artifact, scope, or repository.'
            }
            Write-SLRuntimeOutput $Output -Json:$Json
        }
        'evaluate' {
            if ($Positionals.Count -lt 1) { Throw-SLContractError -Code 'usage' -Message 'evaluate requires an artifact ID or path.' }
            $Registry = Get-SLRegistry $Root
            $Reference = $Positionals[0]
            $NormalizedReference = try { ConvertTo-SLNormalizedPath $Reference } catch { $Reference }
            $Artifact = @($Registry.artifacts | Where-Object {
                $_.id -ceq $Reference -or $_.path -ceq $NormalizedReference -or (Get-SLProperty $_ 'promotionTargetPath') -ceq $NormalizedReference
            })
            if ($Artifact.Count -ne 1) { Throw-SLContractError -Code 'artifact-not-found' -Message "SL artifact not found by ID or path: $Reference" }
            $Snapshot = Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact[0]
            $ContractPath = Get-SLProperty $Snapshot.frontmatter 'validationContract'
            $Result = Invoke-SLValidationContract -Root $Root -ArtifactId $Artifact[0].id -ArtifactType $Artifact[0].artifactType -ArtifactPath $(if (Test-SLProperty $Artifact[0] 'promotionTargetPath') { $Artifact[0].promotionTargetPath } else { $Artifact[0].path }) -ContentPath $Artifact[0].path -SourceIds @((Get-SLProperty $Artifact[0] 'dependsOn' @())) -ContractPath $ContractPath -Frontmatter $Snapshot.frontmatter -ExpectedStatus $Artifact[0].status -ExecuteChecks:([bool] (Get-SLFlag $Flags '--execute-checks' $false)) -DryRun:$DryRun
            Write-SLRuntimeOutput $Result -Json:$Json
            if ($Result.status -ceq 'failed') { return $script:SLExitCodes.Validation }
        }
        'promotion-register' {
            if ($Positionals.Count -lt 2) { Throw-SLContractError -Code 'usage' -Message 'promotion register requires source ID and artifact path.' }
            Write-SLRuntimeOutput (Register-SLPromotion -Root $Root -SourceId $Positionals[0] -ArtifactPath $Positionals[1] -TargetScopeId ([string] (Get-SLFlag $Flags '--target-scope' '')) -Now ([string] (Get-SLFlag $Flags '--now' '')) -DryRun:$DryRun) -Json:$Json
        }
        { $_ -cin @('promotion-evaluate', 'promotion-approve') } {
            if ($Positionals.Count -lt 1) { Throw-SLContractError -Code 'usage' -Message 'promotion evaluate requires an artifact ID.' }
            $Approval = [string] (Get-SLFlag $Flags '--approval-ref' '')
            if (-not $Approval) { Throw-SLContractError -Code 'usage' -Message 'promotion evaluate requires --approval-ref.' }
            $Result = Evaluate-SLPromotion -Root $Root -ArtifactId $Positionals[0] -ApprovalRef $Approval -TargetScopeId ([string] (Get-SLFlag $Flags '--target-scope' '')) -ExecuteChecks:([bool] (Get-SLFlag $Flags '--execute-checks' $false)) -Now ([string] (Get-SLFlag $Flags '--now' '')) -DryRun:$DryRun
            Write-SLRuntimeOutput $Result -Json:$Json
            if ($Result.evaluation.status -ceq 'failed') { return $script:SLExitCodes.Validation }
        }
        'promotion-activate' {
            if ($Positionals.Count -lt 1) { Throw-SLContractError -Code 'usage' -Message 'promotion activate requires an artifact ID.' }
            Write-SLRuntimeOutput (Activate-SLPromotion -Root $Root -ArtifactId $Positionals[0] -OwnerApprovalRef ([string] (Get-SLFlag $Flags '--owner-approval-ref' '')) -TargetScopeId ([string] (Get-SLFlag $Flags '--target-scope' '')) -Now ([string] (Get-SLFlag $Flags '--now' '')) -DryRun:$DryRun) -Json:$Json
        }
        'forget' {
            if ($Positionals.Count -lt 1) { Throw-SLContractError -Code 'usage' -Message 'forget requires an artifact ID.' }
            $Result = if (Get-SLFlag $Flags '--undo' $false) {
                Restore-SLArtifact -Root $Root -ArtifactId $Positionals[0] -Now ([string] (Get-SLFlag $Flags '--now' '')) -DryRun:$DryRun
            } else {
                Forget-SLArtifact -Root $Root -ArtifactId $Positionals[0] -Reason ([string] (Get-SLFlag $Flags '--reason' 'irrelevant')) -Now ([string] (Get-SLFlag $Flags '--now' '')) -DryRun:$DryRun
            }
            Write-SLRuntimeOutput $Result -Json:$Json
        }
        'undo' {
            if ($Positionals.Count -lt 1) { Throw-SLContractError -Code 'usage' -Message 'undo requires an artifact ID.' }
            Write-SLRuntimeOutput (Restore-SLArtifact -Root $Root -ArtifactId $Positionals[0] -Now ([string] (Get-SLFlag $Flags '--now' '')) -DryRun:$DryRun) -Json:$Json
        }
        'sweep' {
            Write-SLRuntimeOutput (Invoke-SLSweep -Root $Root -Now ([string] (Get-SLFlag $Flags '--now' '')) -DryRun:$DryRun) -Json:$Json
        }
        'validate' {
            $Issues = @(Test-SLRepository -Root $Root -IncludeRuntime)
            Write-SLRuntimeOutput ([pscustomobject] @{ valid = @($Issues | Where-Object severity -ceq 'error').Count -eq 0; issues = $Issues }) -Json:$Json
            if (@($Issues | Where-Object severity -ceq 'error').Count -gt 0) { return $script:SLExitCodes.Validation }
        }
        'doctor' {
            $Result = Invoke-SLDoctor $Root
            Set-SLProperty $Result 'command' 'doctor'
            Set-SLProperty $Result 'repositoryRoot' $Root
            Set-SLProperty $Result 'dryRun' $DryRun
            Write-SLRuntimeOutput $Result -Json:$Json
            if (-not $Result.healthy) {
                if (@($Result.checks | Where-Object code -ceq 'runtime-manifest-missing').Count) { return $script:SLExitCodes.Manifest }
                if (@($Result.checks | Where-Object code -ceq 'runtime-mixed-version').Count) { return $script:SLExitCodes.MixedVersion }
                if (@($Result.checks | Where-Object status -ceq 'error').Count) { return $script:SLExitCodes.Integrity }
                return $script:SLExitCodes.Validation
            }
        }
        'validate-runtime' {
            $Result = Test-SLRuntimeInstallation -RuntimeHome $RuntimeHome -ExpectedRuntimeVersion $script:SLRuntimeVersion
            Write-SLRuntimeOutput ([pscustomobject] @{ command = $Command; repositoryRoot = $Root; dryRun = $DryRun; healthy = $Result.healthy; checks = $Result.checks }) -Json:$Json
            if (-not $Result.healthy) {
                if (@($Result.checks | Where-Object code -ceq 'runtime-manifest-missing').Count) { return $script:SLExitCodes.Manifest }
                if (@($Result.checks | Where-Object code -ceq 'runtime-mixed-version').Count) { return $script:SLExitCodes.MixedVersion }
                return $script:SLExitCodes.Integrity
            }
        }
        'conformance' {
            $Integrity = Test-SLRuntimeInstallation -RuntimeHome $RuntimeHome -ExpectedRuntimeVersion $script:SLRuntimeVersion
            if (-not $Integrity.healthy) {
                Write-SLRuntimeOutput ([pscustomobject] @{ command = $Command; repositoryRoot = $Root; dryRun = $DryRun; healthy = $false; checks = $Integrity.checks }) -Json:$Json
                return $script:SLExitCodes.Integrity
            }
            $Result = Invoke-SLRuntimeConformance $RuntimeHome
            Write-SLRuntimeOutput ([pscustomobject] @{ command = $Command; repositoryRoot = $Root; dryRun = $DryRun; result = $Result }) -Json:$Json
            if ($Result.failed -gt 0) { return $script:SLExitCodes.Validation }
        }
        default {
            Throw-SLContractError -Code 'usage' -Message "Unknown command: $Command"
        }
    }
    return $script:SLExitCodes.Success
}

function Invoke-SLRuntime {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]] $Arguments,
        [Parameter(Mandatory)][string] $RuntimeHome
    )

    $Json = @($Arguments | Where-Object { $_ -ceq '--json' }).Count -gt 0
    try {
        $Parsed = ConvertFrom-SLArguments $Arguments
        $Positionals = [System.Collections.Generic.List[string]]::new()
        foreach ($Value in @($Parsed.positionals)) { $Positionals.Add($Value) }
        $Command = if ($Positionals.Count -gt 0) {
            $FirstCommand = [string] $Positionals[0]
            $Positionals.RemoveAt(0)
            $FirstCommand
        }
        else {
            'help'
        }
        if ($Command -ceq 'use') {
            if ($Positionals.Count -eq 0) { Throw-SLContractError -Code 'usage' -Message 'use requires start or finish.' }
            $Subcommand = [string] $Positionals[0]
            $Positionals.RemoveAt(0)
            $Command = "use-$Subcommand"
        }
        elseif ($Command -ceq 'promotion') {
            if ($Positionals.Count -eq 0) { Throw-SLContractError -Code 'usage' -Message 'promotion requires register, evaluate, approve, or activate.' }
            $Subcommand = [string] $Positionals[0]
            $Positionals.RemoveAt(0)
            $Command = "promotion-$Subcommand"
        }
        elseif ($Command -ceq 'promote') { $Command = 'promotion-register' }
        return Invoke-SLRuntimeCommand -Command $Command -Positionals $Positionals.ToArray() -Flags $Parsed.flags -RuntimeHome $RuntimeHome
    }
    catch {
        $Code = [string] $_.Exception.Data['SLCode']
        if (-not $Code) { $Code = 'runtime-internal' }
        Write-SLRuntimeError -Code $Code -Message $_.Exception.Message -Json:$Json
        if ($Code -ceq 'usage') { return $script:SLExitCodes.Usage }
        if ($Code -like 'repository-*') { return $script:SLExitCodes.RepositoryRoot }
        if ($Code -like 'manifest-*') { return $script:SLExitCodes.Manifest }
        if ($Code -like 'path-*' -or $Code -like 'file-*') { return $script:SLExitCodes.IO }
        if ($Code -like 'validation-*' -or $Code -like 'scope-*' -or $Code -like 'promotion-*' -or $Code -like 'usage-*' -or $Code -like 'forget-*' -or $Code -like 'restore-*') { return $script:SLExitCodes.Validation }
        return $script:SLExitCodes.Internal
    }
}

Export-ModuleMember -Function 'Invoke-SLRuntime'
