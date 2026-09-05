Set-StrictMode -Version Latest

function Get-SLPromotionScopeRef {
    param(
        [Parameter(Mandatory)][object] $Catalog,
        [Parameter(Mandatory)][string] $ScopeId
    )

    $Scope = @($Catalog.scopes | Where-Object { [string] $_.id -ceq $ScopeId })
    if ($Scope.Count -ne 1) {
        Throw-SLContractError -Code 'scope-not-found' -Message "SL scope does not exist in the catalog: $ScopeId"
    }
    $ById = @{}
    foreach ($Definition in @($Catalog.scopes)) { $ById[[string] $Definition.id] = $Definition }
    $Ancestors = [System.Collections.Generic.List[string]]::new()
    $Current = $Scope[0]
    while (Test-SLProperty $Current 'parentScopeId') {
        $Ancestors.Add([string] $Current.parentScopeId)
        $Current = $ById[[string] $Current.parentScopeId]
    }
    $Owners = Sort-SLOrdinal @($Scope[0].ownerAliases)
    $OwnerHash = (Get-SLSha256 -Value (ConvertTo-SLCanonicalJson $Owners)).Substring(0, 16).ToUpperInvariant()
    return [pscustomobject] @{
        id = $ScopeId
        kind = $(if ($Ancestors.Count -eq 0) { 'repository' } else { [string] $Scope[0].kind })
        root = $Ancestors.Count -eq 0
        precedence = $Ancestors.Count
        ancestorScopeIds = $Ancestors.ToArray()
        ownerSetId = "SL-OWNERS-$OwnerHash"
    }
}

function Get-SLPromotionType {
    param([Parameter(Mandatory)][string] $Path)

    if ($Path.StartsWith('.github/instructions/') -and $Path.EndsWith('.instructions.md')) {
        return 'instruction'
    }
    if ($Path.StartsWith('.github/skills/') -and $Path.EndsWith('/SKILL.md')) {
        return 'skill'
    }
    Throw-SLContractError -Code 'promotion-path' -Message 'Promoted path must be .github/instructions/SL-*.instructions.md or .github/skills/SL-*/SKILL.md.'
}

function Get-SLProbationPath {
    param([string] $ArtifactId, [string] $ArtifactType, [string] $TargetPath)

    return $(if ($ArtifactType -ceq 'instruction') {
        "$script:SLProbationRoot/$ArtifactId/$([IO.Path]::GetFileName($TargetPath))"
    } else {
        "$script:SLProbationRoot/$ArtifactId/SKILL.md"
    })
}

function Get-SLPromotionArtifactHash {
    param([Parameter(Mandatory)][string] $Content)

    return Get-SLArtifactUsageContentHash $Content
}

function Test-SLPromotionEvaluationCurrent {
    param([Parameter(Mandatory)][string] $Root, [Parameter(Mandatory)][object] $Artifact)

    try {
        if (
            -not (Test-SLProperty $Artifact 'promotionEvaluation') -or
            $Artifact.promotionEvaluation.status -cne 'passed' -or
            -not $Artifact.path
        ) {
            return $false
        }
        $Content = Read-SLSafeText -Root $Root -RelativePath ([string] $Artifact.path)
        $Hash = Get-SLPromotionArtifactHash $Content
        if (
            $Hash -cne $Artifact.promotionEvaluation.artifactContentHash -or
            "sha256:$Hash" -cne $Artifact.promotionEvaluation.artifactVersion
        ) {
            return $false
        }
        $Markdown = ConvertFrom-SLFrontmatter $Content
        $ContractPath = Get-SLProperty $Markdown.frontmatter 'validationContract'
        $ContractHash = if ($ContractPath) {
            Get-SLSha256 -Value (
                (Read-SLSafeText -Root $Root -RelativePath ([string] $ContractPath)).
                    Replace("`r`n", "`n").Replace("`r", "`n")
            )
        }
        else {
            $null
        }
        if ($ContractHash -cne (Get-SLProperty $Artifact.promotionEvaluation 'contractContentHash')) {
            return $false
        }
        if (Test-SLProperty $Artifact.promotionEvaluation 'governance') {
            $Config = Get-SLConfig $Root
            $PolicyHash = Get-SLSha256 -Value (ConvertTo-SLCanonicalJson $Config.promotion)
            if (
                $Config.promotion.policyVersion -cne $Artifact.promotionEvaluation.governance.policyVersion -or
                $PolicyHash -cne $Artifact.promotionEvaluation.governance.policyHash
            ) {
                return $false
            }
        }
        return $true
    }
    catch {
        return $false
    }
}

function Test-SLValidationScopeOverlap {
    param([Parameter(Mandatory)][object] $Left, [Parameter(Mandatory)][object] $Right)

    if ($Left.kind -ceq 'repository' -or $Right.kind -ceq 'repository') {
        return $true
    }
    foreach ($LeftPath in @($Left.paths)) {
        foreach ($RightPath in @($Right.paths)) {
            if ($LeftPath -ceq $RightPath -or $LeftPath -ceq '**' -or $RightPath -ceq '**') {
                return $true
            }
            $LeftPrefix = ([string] $LeftPath).Split('*', '?')[0].TrimEnd('/')
            $RightPrefix = ([string] $RightPath).Split('*', '?')[0].TrimEnd('/')
            if (
                $LeftPrefix.StartsWith($RightPrefix, [StringComparison]::Ordinal) -or
                $RightPrefix.StartsWith($LeftPrefix, [StringComparison]::Ordinal)
            ) {
                return $true
            }
        }
    }
    return $false
}

function Get-SLValidationContractConflicts {
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]] $Contracts)

    $Conflicts = [System.Collections.Generic.List[object]]::new()
    $Ordered = @($Contracts | Sort-Object -Stable -Property @{ Expression = { [string] $_.artifactId } })
    for ($LeftIndex = 0; $LeftIndex -lt $Ordered.Count; $LeftIndex += 1) {
        for ($RightIndex = $LeftIndex + 1; $RightIndex -lt $Ordered.Count; $RightIndex += 1) {
            $Left = $Ordered[$LeftIndex]
            $Right = $Ordered[$RightIndex]
            if (-not (Test-SLValidationScopeOverlap $Left.contract.scope $Right.contract.scope)) {
                continue
            }

            function Resolve-SLScopedPromotionConflicts {
                param(
                    [Parameter(Mandatory)][string] $Root,
                    [Parameter(Mandatory)][object[]] $Contracts,
                    [Parameter(Mandatory)][object[]] $Conflicts
                )

                $Config = Get-SLConfig $Root
                $Catalog = Get-SLScopeCatalog $Root
                $Resolutions = [System.Collections.Generic.List[object]]::new()
                foreach ($Conflict in $Conflicts) {
                    $Left = @($Contracts | Where-Object artifactId -ceq $Conflict.leftArtifactId)[0]
                    $Right = @($Contracts | Where-Object artifactId -ceq $Conflict.rightArtifactId)[0]
                    $LeftScope = if (Test-SLProperty (Get-SLProperty $Left.artifact 'promotionEvaluation') 'governance') {
                        $Left.artifact.promotionEvaluation.governance.targetScope
                    } else { Get-SLPromotionScopeRef $Catalog ([string] $Left.artifact.scope.id) }
                    $RightScope = if (Test-SLProperty (Get-SLProperty $Right.artifact 'promotionEvaluation') 'governance') {
                        $Right.artifact.promotionEvaluation.governance.targetScope
                    } else { Get-SLPromotionScopeRef $Catalog ([string] $Right.artifact.scope.id) }
                    $Narrower = $null
                    $Broader = $null
                    if ($LeftScope.precedence -gt $RightScope.precedence -and @($LeftScope.ancestorScopeIds) -contains $RightScope.id) {
                        $Narrower = $Left; $Broader = $Right
                    }
                    elseif ($RightScope.precedence -gt $LeftScope.precedence -and @($RightScope.ancestorScopeIds) -contains $LeftScope.id) {
                        $Narrower = $Right; $Broader = $Left
                    }
                    $Override = $null
                    if ($null -ne $Narrower -and $Config.promotion.conflicts.allowNarrowerExplicitOverrides) {
                        $Declaration = @((Get-SLProperty $Narrower.contract 'declarations' @()) | Where-Object key -ceq $Conflict.declarationKey)[0]
                        $Candidate = Get-SLProperty $Declaration 'override'
                        if (
                            $null -ne $Candidate -and
                            $Candidate.kind -ceq 'narrower-scope' -and
                            $Candidate.overriddenArtifactId -ceq $Broader.artifactId -and
                            $Candidate.overriddenScopeId -ceq $(if ($Broader -eq $Left) { $LeftScope.id } else { $RightScope.id }) -and
                            $Candidate.declarationKey -ceq $Conflict.declarationKey -and
                            ([string] $Candidate.reason).Trim() -and
                            (Test-SLOpaqueReference ([string] $Candidate.approvalRef)
                        )) {
                            $Override = $Candidate
                        }
                    }
                    if ($null -ne $Override) {
                        $Resolutions.Add([pscustomobject] @{
                            declarationKey = $Conflict.declarationKey
                            narrowerArtifactId = $Narrower.artifactId
                            broaderArtifactId = $Broader.artifactId
                            status = 'explicit-override'
                            message = "Narrower artifact $($Narrower.artifactId) explicitly overrides $($Broader.artifactId) for $($Conflict.declarationKey)."
                            override = $Override
                        })
                    }
                    else {
                        $Resolutions.Add([pscustomobject] @{
                            declarationKey = $Conflict.declarationKey
                            narrowerArtifactId = $(if ($null -ne $Narrower) { $Narrower.artifactId } else { $Left.artifactId })
                            broaderArtifactId = $(if ($null -ne $Broader) { $Broader.artifactId } else { $Right.artifactId })
                            status = 'blocked'
                            message = $(if ($LeftScope.precedence -eq $RightScope.precedence) {
                                "Artifacts $($Left.artifactId) and $($Right.artifactId) have same-precedence contradictory declarations for $($Conflict.declarationKey)."
                            } else {
                                "Contradictory declaration $($Conflict.declarationKey) lacks a valid explicit narrower-scope override."
                            })
                        })
                    }
                }
                return $Resolutions.ToArray()
            }
            foreach ($LeftDeclaration in @((Get-SLProperty $Left.contract 'declarations' @()))) {
                $RightDeclaration = @((Get-SLProperty $Right.contract 'declarations' @()) | Where-Object key -ceq $LeftDeclaration.key)
                if (
                    $RightDeclaration.Count -gt 0 -and
                    (ConvertTo-SLCanonicalJson $LeftDeclaration.value) -cne (ConvertTo-SLCanonicalJson $RightDeclaration[0].value)
                ) {
                    $Conflicts.Add([pscustomobject] @{
                        declarationKey = $LeftDeclaration.key
                        leftArtifactId = $Left.artifactId
                        rightArtifactId = $Right.artifactId
                        message = "Active artifacts $($Left.artifactId) and $($Right.artifactId) declare conflicting values for $($LeftDeclaration.key) in overlapping scopes."
                    })
                }
            }
        }
    }
    return $Conflicts.ToArray()
}

function Test-SLValidationContractShape {
    param([Parameter(Mandatory)][object] $Contract)

    if (
        $Contract.schemaVersion -ne 1 -or
        -not (Test-SLProperty $Contract 'artifact') -or
        -not (Test-SLProperty $Contract 'provenance') -or
        -not (Test-SLProperty $Contract 'scope') -or
        -not (Test-SLProperty $Contract 'scenarios') -or
        [string] $Contract.artifact.id -cnotmatch '^SL-[A-Z0-9][A-Z0-9-]*$' -or
        [string] $Contract.artifact.type -cnotin @('instruction', 'skill') -or
        @($Contract.provenance.sourceIds).Count -eq 0 -or
        @($Contract.scenarios).Count -eq 0
    ) {
        return $false
    }
    if ($Contract.scope.kind -ceq 'paths' -and @($Contract.scope.paths).Count -eq 0) {
        return $false
    }
    if ($Contract.scope.kind -cnotin @('repository', 'paths')) {
        return $false
    }
    return $true
}

function Test-SLPromotedFrontmatter {
    param(
        [object] $Frontmatter,
        [string] $ArtifactId,
        [string] $ArtifactType,
        [string] $ArtifactPath,
        [string] $ExpectedStatus
    )

    if (
        (Get-SLProperty $Frontmatter 'id') -cne $ArtifactId -or
        (Get-SLProperty $Frontmatter 'schemaVersion') -ne 1 -or
        (Get-SLProperty $Frontmatter 'managedBy') -cne 'SL-Repo' -or
        (Get-SLProperty $Frontmatter 'status') -cne $ExpectedStatus -or
        [bool] (Get-SLProperty $Frontmatter 'pinned' $false)
    ) {
        return $false
    }
    if ($ArtifactType -ceq 'instruction') {
        return (Get-SLProperty $Frontmatter 'applyTo') -is [string]
    }
    $ExpectedName = ([string] $ArtifactPath).Split('/')[-2]
    return (Get-SLProperty $Frontmatter 'name') -ceq $ExpectedName
}

function Invoke-SLValidationContract {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $ArtifactId,
        [Parameter(Mandatory)][string] $ArtifactType,
        [Parameter(Mandatory)][string] $ArtifactPath,
        [Parameter(Mandatory)][string] $ContentPath,
        [Parameter(Mandatory)][string[]] $SourceIds,
        [AllowNull()][string] $ContractPath,
        [AllowNull()][object] $Frontmatter,
        [Parameter(Mandatory)][string] $ExpectedStatus,
        [switch] $ExecuteChecks,
        [switch] $DryRun
    )

    $Checks = [System.Collections.Generic.List[object]]::new()
    function Add-ContractCheck {
        param([string] $Id, [string] $Kind, [bool] $Passed, [string] $PassedMessage, [string] $FailedMessage)
        $Checks.Add([pscustomobject] @{
            id = $Id
            kind = $Kind
            status = $(if ($Passed) { 'passed' } else { 'failed' })
            message = $(if ($Passed) { $PassedMessage } else { $FailedMessage })
        })
    }
    $Contract = $null
    if (
        -not $ContractPath -or
        -not $ContractPath.StartsWith('.github/SL-learning/SL-validation-contracts/') -or
        -not ([IO.Path]::GetFileName($ContractPath)).StartsWith('SL-') -or
        -not $ContractPath.EndsWith('.validation.json')
    ) {
        Add-ContractCheck 'contract-path' static $false '' 'validationContract must reference an SL-*.validation.json file under .github/SL-learning/SL-validation-contracts/.'
    }
    else {
        try {
            $ContractContent = Read-SLSafeText -Root $Root -RelativePath $ContractPath
            Add-ContractCheck 'contract-content-safety' static (-not (Test-SLSensitiveText $ContractContent)) 'Validation contract contains no obvious secrets or personal paths.' 'Potential secret, credential, or personal path detected.'
            $Contract = ConvertFrom-Json $ContractContent -Depth 100
            Add-ContractCheck 'contract-schema' static (Test-SLValidationContractShape $Contract) 'Validation contract conforms to schema version 1.' 'Validation contract does not conform to the supported schema.'
        }
        catch {
            Add-ContractCheck 'contract-access' static $false '' $_.Exception.Message
        }
    }
    try {
        $ArtifactContent = Read-SLSafeText -Root $Root -RelativePath $ContentPath
        Add-ContractCheck 'artifact-content-safety' static (-not (Test-SLSensitiveText $ArtifactContent)) 'Promoted artifact contains no obvious secrets or personal paths.' 'Potential secret, credential, or personal path detected.'
        if ($null -eq $Frontmatter) {
            $Frontmatter = (ConvertFrom-SLFrontmatter $ArtifactContent).frontmatter
        }
        Add-ContractCheck 'artifact-frontmatter' static (
            Test-SLPromotedFrontmatter $Frontmatter $ArtifactId $ArtifactType $ArtifactPath $ExpectedStatus
        ) 'Promoted artifact frontmatter matches registry ownership.' 'Promoted artifact frontmatter does not match registry ownership.'
    }
    catch {
        Add-ContractCheck 'artifact-access' static $false '' $_.Exception.Message
    }
    if ($null -ne $Contract) {
        $ArtifactMatches = (
            $Contract.artifact.id -ceq $ArtifactId -and
            $Contract.artifact.type -ceq $ArtifactType -and
            (ConvertTo-SLNormalizedPath ([string] $Contract.artifact.path)) -ceq $ArtifactPath
        )
        Add-ContractCheck 'contract-artifact' static $ArtifactMatches 'Contract artifact identity, type, and path match.' 'Contract artifact identity, type, or path does not match the promoted artifact.'
        $ExpectedSources = Sort-SLOrdinal $SourceIds
        $ActualSources = Sort-SLOrdinal @($Contract.provenance.sourceIds)
        $SourceMatches = (ConvertTo-SLCanonicalJson $ExpectedSources) -ceq (ConvertTo-SLCanonicalJson $ActualSources)
        Add-ContractCheck 'contract-sources' static $SourceMatches 'Contract provenance matches registry source IDs.' 'Contract provenance source IDs do not match the promotion source IDs.'
        $SourcePathsSafe = $true
        foreach ($SourcePath in @((Get-SLProperty $Contract.provenance 'sourcePaths' @()))) {
            try {
                $Resolved = Resolve-SLContainedPath -Root $Root -RelativePath ([string] $SourcePath)
                if (-not [IO.File]::Exists($Resolved)) { $SourcePathsSafe = $false }
            }
            catch { $SourcePathsSafe = $false }
        }
        Add-ContractCheck 'contract-source-paths' static $SourcePathsSafe 'Contract provenance paths are existing repository-contained files.' 'Contract provenance includes a missing or unsafe path.'
        $ScopeSafe = $true
        foreach ($Pattern in @((Get-SLProperty $Contract.scope 'paths' @()))) {
            try { [void] (ConvertTo-SLNormalizedGlob ([string] $Pattern)) } catch { $ScopeSafe = $false }
        }
        Add-ContractCheck 'contract-scope' static $ScopeSafe 'Contract scope is repository-contained.' 'Contract scope includes an unsafe path.'
        $ScenarioIds = @{}
        foreach ($Scenario in @($Contract.scenarios)) {
            $Duplicate = $ScenarioIds.ContainsKey([string] $Scenario.id)
            $ScenarioIds[[string] $Scenario.id] = $true
            $Positive = ConvertTo-SLCanonicalJson $Scenario.input
            $CounterDuplicate = @((Get-SLProperty $Scenario 'counterexamples' @()) | Where-Object {
                (ConvertTo-SLCanonicalJson $_.input) -ceq $Positive
            }).Count -gt 0
            Add-ContractCheck "scenario:$($Scenario.id)" scenario (-not $Duplicate -and -not $CounterDuplicate) "Scenario $($Scenario.id) has a deterministic input and expected behavior." "Scenario $($Scenario.id) is duplicated or repeats its positive input as a counterexample."
        }
        $Declarations = @{}
        foreach ($Declaration in @((Get-SLProperty $Contract 'declarations' @()))) {
            $Value = ConvertTo-SLCanonicalJson $Declaration.value
            $Conflict = $Declarations.ContainsKey([string] $Declaration.key) -and $Declarations[[string] $Declaration.key] -cne $Value
            Add-ContractCheck "declaration:$($Declaration.key)" static (-not $Conflict) "Declaration $($Declaration.key) is deterministic." "Declaration $($Declaration.key) has contradictory values."
            $Declarations[[string] $Declaration.key] = $Value
        }
        foreach ($Executable in @((Get-SLProperty $Contract 'executableChecks' @()))) {
            $Checks.Add([pscustomobject] @{
                id = "executable:$($Executable.id)"
                kind = 'executable'
                status = $(if ($ExecuteChecks -and -not $DryRun) { 'failed' } else { 'skipped' })
                message = $(if ($ExecuteChecks -and -not $DryRun) {
                    'Repository-local PowerShell runtime never invokes Node or npm; executable validation must be satisfied by static contracts or an external reviewed workflow.'
                } else {
                    'Executable check requires explicit execution outside the repository-local PowerShell runtime.'
                })
            })
        }
    }
    return [pscustomobject] @{
        schemaVersion = 1
        artifactId = $ArtifactId
        artifactType = $ArtifactType
        artifactPath = $ArtifactPath
        contractPath = $ContractPath
        status = $(if (@($Checks | Where-Object status -ceq 'failed').Count -gt 0) { 'failed' } else { 'passed' })
        executableChecksRequested = [bool] $ExecuteChecks
        checks = $Checks.ToArray()
        contract = $Contract
    }
}

function Get-SLActiveContracts {
    param([string] $Root, [object] $Registry, [string] $CandidateId)

    $Contracts = [System.Collections.Generic.List[object]]::new()
    foreach ($Artifact in @($Registry.artifacts)) {
        if (
            $Artifact.id -ceq $CandidateId -or
            $Artifact.classification -cne 'promoted' -or
            [string] $Artifact.status -cnotin @('active', 'promoted') -or
            -not $Artifact.path
        ) { continue }
        if ($Artifact.status -ceq 'active' -and -not (Test-SLPromotionEvaluationCurrent $Root $Artifact)) {
            Throw-SLContractError -Code 'promotion-stale' -Message "Active promotion $($Artifact.id) has a stale evaluation."
        }
        $Content = Read-SLSafeText -Root $Root -RelativePath ([string] $Artifact.path)
        $Frontmatter = (ConvertFrom-SLFrontmatter $Content).frontmatter
        $ContractPath = Get-SLProperty $Frontmatter 'validationContract'
        if (-not $ContractPath -and $Artifact.status -ceq 'promoted') { continue }
        $Evaluation = Invoke-SLValidationContract -Root $Root -ArtifactId $Artifact.id -ArtifactType $Artifact.artifactType -ArtifactPath $(if (Test-SLProperty $Artifact 'promotionTargetPath') { $Artifact.promotionTargetPath } else { $Artifact.path }) -ContentPath $Artifact.path -SourceIds @((Get-SLProperty $Artifact 'dependsOn' @())) -ContractPath $ContractPath -Frontmatter $Frontmatter -ExpectedStatus $Artifact.status
        if ($Evaluation.status -cne 'passed') {
            Throw-SLContractError -Code 'promotion-contract' -Message "Active promotion $($Artifact.id) validation contract failed."
        }
        $Contracts.Add([pscustomobject] @{ artifactId = $Artifact.id; contract = $Evaluation.contract; artifact = $Artifact })
    }
    return $Contracts.ToArray()
}

function Register-SLPromotion {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $SourceId,
        [Parameter(Mandatory)][string] $ArtifactPath,
        [AllowNull()][string] $TargetScopeId,
        [AllowNull()][string] $Now,
        [switch] $DryRun
    )

    return Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation {
        $Timestamp = Get-SLNormalizedTimestamp $Now
        $TargetPath = ConvertTo-SLNormalizedPath $ArtifactPath
        $ArtifactType = Get-SLPromotionType $TargetPath
        $Path = Resolve-SLContainedPath -Root $Root -RelativePath $TargetPath
        if (-not [IO.File]::Exists($Path)) {
            Throw-SLContractError -Code 'promotion-missing' -Message "Promoted artifact does not exist: $TargetPath"
        }
        if (
            ($ArtifactType -ceq 'instruction' -and -not ([IO.Path]::GetFileName($TargetPath)).StartsWith('SL-')) -or
            ($ArtifactType -ceq 'skill' -and -not $TargetPath.Split('/')[-2].StartsWith('SL-'))
        ) {
            Throw-SLContractError -Code 'promotion-prefix' -Message 'Promoted artifact path must use an SL- prefix.'
        }
        $Registry = Get-SLRegistry $Root
        $Source = Find-SLArtifact $Registry $SourceId
        if ($Source.classification -cne 'evidence') {
            Throw-SLContractError -Code 'promotion-source' -Message 'Only lesson evidence can be promoted.'
        }
        $SourceSnapshot = Read-SLOwnedMarkdown -Root $Root -Artifact $Source -ExpectedArtifactType lesson -ExpectedClassification evidence
        $Content = Read-SLSafeText -Root $Root -RelativePath $TargetPath
        $Markdown = ConvertFrom-SLFrontmatter $Content
        $PromotedId = [string] (Get-SLProperty $Markdown.frontmatter 'id' "SL-PROMOTED-$($SourceId.Substring(3))")
        if ($PromotedId -ceq $SourceId -or $PromotedId -cnotmatch '^SL-[A-Z0-9][A-Z0-9-]*$') {
            Throw-SLContractError -Code 'promotion-id' -Message 'Promoted artifact ID must be a distinct valid SL ID.'
        }
        $ProbationPath = Get-SLProbationPath $PromotedId $ArtifactType $TargetPath
        if ([IO.File]::Exists((Resolve-SLContainedPath -Root $Root -RelativePath $ProbationPath))) {
            Throw-SLContractError -Code 'promotion-clobber' -Message "Promotion probation path already exists: $ProbationPath"
        }
        $Existing = @($Registry.artifacts | Where-Object { $_.id -ceq $PromotedId -or $_.path -ceq $TargetPath -or (Get-SLProperty $_ 'promotionTargetPath') -ceq $TargetPath })
        if (@($Existing | Where-Object { $_.id -cne $PromotedId -or $_.classification -cne 'promoted' }).Count -gt 0) {
            Throw-SLContractError -Code 'promotion-owner' -Message "Promoted ID or path is already owned by another artifact."
        }
        Set-SLProperty $Markdown.frontmatter 'id' $PromotedId
        Set-SLProperty $Markdown.frontmatter 'schemaVersion' 1
        Set-SLProperty $Markdown.frontmatter 'managedBy' 'SL-Repo'
        Set-SLProperty $Markdown.frontmatter 'status' 'probation'
        Set-SLProperty $Markdown.frontmatter 'pinned' $false
        Set-SLProperty $Markdown.frontmatter 'sourceIds' @($SourceId)
        $ContractPath = Get-SLProperty $Markdown.frontmatter 'validationContract'
        if (-not ($ContractPath -is [string])) {
            Throw-SLContractError -Code 'promotion-contract' -Message 'Promoted artifact frontmatter must reference a validationContract.'
        }
        $Evaluation = Invoke-SLValidationContract -Root $Root -ArtifactId $PromotedId -ArtifactType $ArtifactType -ArtifactPath $TargetPath -ContentPath $TargetPath -SourceIds @($SourceId) -ContractPath $ContractPath -Frontmatter $Markdown.frontmatter -ExpectedStatus probation
        if ($Evaluation.status -cne 'passed') {
            $Failures = @($Evaluation.checks | Where-Object status -ceq 'failed' | ForEach-Object { "$($_.id): $($_.message)" })
            Throw-SLContractError -Code 'promotion-contract' -Message "Promotion validation contract failed: $($Failures -join '; ')"
        }
        $Scope = if ($TargetScopeId) {
            (Resolve-SLScopeDescriptor -Root $Root -ScopeId $TargetScopeId).scope
        } else {
            Normalize-SLScope $Source.scope
        }
        $Event = [pscustomobject] @{
            timestamp = $Timestamp
            artifactId = $PromotedId
            action = 'promotion-registered'
            toStatus = 'probation'
            toPath = $ProbationPath
            reason = "Registered from $SourceId for governed activation."
        }
        Assert-SLLifecycleEventsWritable -Root $Root -Events @($Event)
        $Changes = [System.Collections.Generic.List[object]]::new()
        Move-SLContainedFile -Root $Root -SourceRelativePath $TargetPath -TargetRelativePath $ProbationPath -Changes $Changes -DryRun:$DryRun
        Write-SLTextChange -Root $Root -RelativePath $ProbationPath -Content (
            ConvertTo-SLFrontmatterText -Frontmatter $Markdown.frontmatter -Body $Markdown.body
        ) -Changes $Changes -DryRun:$DryRun
        Set-SLProperty $SourceSnapshot.frontmatter 'status' 'promoted'
        Write-SLTextChange -Root $Root -RelativePath ([string] $Source.path) -Content (
            ConvertTo-SLFrontmatterText -Frontmatter $SourceSnapshot.frontmatter -Body $SourceSnapshot.body
        ) -Changes $Changes -DryRun:$DryRun
        Set-SLProperty $Source 'status' 'promoted'
        Set-SLProperty $Source 'lastVerifiedAt' $Timestamp
        Set-SLProperty $Source 'relatedTo' @(@($Source.relatedTo) + $PromotedId | Sort-Object -Unique)
        $Promoted = [pscustomobject] @{
            id = $PromotedId
            path = $ProbationPath
            promotionTargetPath = $TargetPath
            artifactType = $ArtifactType
            classification = 'promoted'
            managedBy = 'SL-Repo'
            status = 'probation'
            createdAt = $Timestamp
            lastVerifiedAt = $Timestamp
            pinned = $false
            relatedTo = @($SourceId)
            dependsOn = @($SourceId)
            scope = $Scope
        }
        $Registry.artifacts = @($Registry.artifacts | Where-Object id -cne $PromotedId) + @($Promoted)
        [void] (Save-SLRegistry -Root $Root -Registry $Registry -Changes $Changes -DryRun:$DryRun)
        Write-SLIndexes -Root $Root -Registry $Registry -Changes $Changes -Projections @(Project-SLUsageEvents (Get-SLUsageEvents $Root)) -DryRun:$DryRun
        Write-SLLifecycleEvents -Root $Root -Events @($Event) -DryRun:$DryRun
        return [pscustomobject] @{ artifactId = $PromotedId; changes = $Changes.ToArray() }
    }
}

function Get-SLPromotionGovernance {
    param(
        [string] $Root,
        [object] $Registry,
        [object] $Artifact,
        [object] $Contract,
        [string] $ApprovalRef,
        [AllowNull()][string] $TargetScopeId
    )

    $Config = Get-SLConfig $Root
    if ($Config.promotion.mode -cne 'monorepo') {
        return $null
    }
    $Catalog = Get-SLScopeCatalog $Root
    $PersistedScopeId = [string] $Artifact.scope.id
    $RequestedScopeId = $(if ($TargetScopeId) { $TargetScopeId } else { $PersistedScopeId })
    if ($RequestedScopeId -cne $PersistedScopeId) {
        Throw-SLContractError -Code 'promotion-scope' -Message "Promotion target scope $RequestedScopeId does not match persisted artifact scope $PersistedScopeId."
    }
    $TargetScope = Get-SLPromotionScopeRef $Catalog $RequestedScopeId
    $Sources = [System.Collections.Generic.List[object]]::new()
    $Evidence = [System.Collections.Generic.List[object]]::new()
    $Events = @(Get-SLUsageEvents $Root)
    foreach ($SourceId in @($Artifact.dependsOn)) {
        $Source = Find-SLArtifact $Registry ([string] $SourceId)
        if (-not $Source.path) { continue }
        $SourceContent = Read-SLSafeText -Root $Root -RelativePath ([string] $Source.path)
        $SourceHash = Get-SLPromotionArtifactHash $SourceContent
        $SourceScopeRef = Get-SLPromotionScopeRef $Catalog ([string] $Source.scope.id)
        $Sources.Add([pscustomobject] @{
            artifactId = $Source.id
            artifactVersion = "sha256:$SourceHash"
            scope = $SourceScopeRef
        })
        foreach ($Event in @($Events | Where-Object {
            $_.artifactId -ceq $Source.id -and
            $_.artifactVersion -ceq "sha256:$SourceHash" -and
            $_.stage -ceq 'verified' -and
            $_.outcome -cin @('success', 'failure') -and
            (Test-SLProperty $_ 'evidenceRef')
        })) {
            $Evidence.Add([pscustomobject] @{
                sourceArtifactId = $Source.id
                artifactVersion = $Event.artifactVersion
                applicationScope = Get-SLPromotionScopeRef $Catalog ([string] $Event.scope.id)
                outcome = $(if ($Event.outcome -ceq 'success') { 'verified-success' } else { 'verified-failure' })
                evidenceRef = $Event.evidenceRef
            })
        }
    }
    $Summaries = [System.Collections.Generic.List[object]]::new()
    $EvidenceGroups = @{}
    foreach ($Item in $Evidence) {
        $Key = "$($Item.sourceArtifactId)$([char]0)$($Item.artifactVersion)$([char]0)$($Item.applicationScope.id)"
        if (-not $EvidenceGroups.ContainsKey($Key)) {
            $EvidenceGroups[$Key] = [pscustomobject] @{
                sourceArtifactId = $Item.sourceArtifactId
                artifactVersion = $Item.artifactVersion
                scopeId = $Item.applicationScope.id
                successRefs = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
                failureRefs = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            }
        }
        if ($Item.outcome -ceq 'verified-success') {
            [void] $EvidenceGroups[$Key].successRefs.Add([string] $Item.evidenceRef)
        } else {
            [void] $EvidenceGroups[$Key].failureRefs.Add([string] $Item.evidenceRef)
        }
    }
    foreach ($Group in $EvidenceGroups.Values) {
        $Refs = Sort-SLOrdinal @($Group.successRefs + $Group.failureRefs)
        $Summaries.Add([pscustomobject] @{
            sourceArtifactId = $Group.sourceArtifactId
            artifactVersion = $Group.artifactVersion
            scopeId = $Group.scopeId
            verifiedSuccessCount = $Group.successRefs.Count
            verifiedFailureCount = $Group.failureRefs.Count
            evidenceRefs = $Refs
        })
    }
    $Shared = $TargetScope.root -or $TargetScope.kind -ceq 'shared'
    if ($Shared) {
        $Qualifying = @($Summaries | Group-Object scopeId | Where-Object {
            $_.Name -cne $TargetScope.id -and
            (($_.Group | Measure-Object verifiedSuccessCount -Sum).Sum -ge $Config.promotion.shared.minimumVerifiedSuccessesPerScope)
        }).Count
        $EvidencePassed = $Qualifying -ge $Config.promotion.shared.minimumDistinctNonRootScopes
        $EvidenceReason = $(if ($EvidencePassed) {
            "Verified successful applications span $Qualifying distinct non-root scopes."
        } else {
            "Shared promotion requires $($Config.promotion.shared.minimumDistinctNonRootScopes) distinct non-root scopes with at least $($Config.promotion.shared.minimumVerifiedSuccessesPerScope) verified successful application(s) each; found $Qualifying."
        })
    }
    else {
        $SourcesOwned = @($Sources | Where-Object { $_.scope.id -cne $TargetScope.id }).Count -eq 0
        $OwnSuccess = (@($Summaries | Where-Object scopeId -ceq $TargetScope.id | Measure-Object verifiedSuccessCount -Sum).Sum)
        if ($null -eq $OwnSuccess) { $OwnSuccess = 0 }
        $EvidencePassed = $SourcesOwned -and $OwnSuccess -ge $Config.promotion.local.minimumVerifiedSuccesses
        $EvidenceReason = $(if ($EvidencePassed) {
            "Local promotion has $OwnSuccess verified successful application(s) in its own scope."
        } else {
            "Local promotion requires source evidence owned by $($TargetScope.id) and at least $($Config.promotion.local.minimumVerifiedSuccesses) verified successful application(s) in that scope."
        })
    }
    $ApprovalPassed = (Test-SLOpaqueReference $ApprovalRef)
    $OwnerApprovals = @()
    if ($ApprovalPassed) {
        $OwnerApprovals = @([pscustomobject] @{
            kind = 'owner-set-approval'
            scopeId = $TargetScope.id
            ownerSetId = $TargetScope.ownerSetId
            evidenceRef = $ApprovalRef
        })
    }
    $RecordBase = [ordered] @{
        schemaVersion = 1
        status = $(if ($EvidencePassed -and $ApprovalPassed) { 'passed' } else { 'failed' })
        policyVersion = $Config.promotion.policyVersion
        policyHash = Get-SLSha256 (ConvertTo-SLCanonicalJson $Config.promotion)
        targetScope = $TargetScope
        sourceScopes = @($Sources)
        artifactScope = [pscustomobject] @{ artifactId = $Artifact.id; scope = $TargetScope }
        evidenceSummary = @($Summaries | Sort-Object -Stable -Property @(
            @{ Expression = { [string] $_.scopeId } },
            @{ Expression = { [string] $_.sourceArtifactId } }
        ))
        ownerApprovals = $OwnerApprovals
        conflictResolutions = @()
        reasons = @(
            $EvidenceReason,
            $(if ($ApprovalPassed) { "Target owner set $($TargetScope.ownerSetId) approved the promotion." } else { "Promotion requires approval from target owner set $($TargetScope.ownerSetId)." })
        )
    }
    $Input = Copy-SLValue ([pscustomobject] $RecordBase)
    $RecordBase['inputHash'] = Get-SLSha256 (ConvertTo-SLCanonicalJson $Input)
    return [pscustomobject] @{
        record = [pscustomobject] $RecordBase
        evidencePassed = $EvidencePassed
        approvalPassed = $ApprovalPassed
    }
}

function Evaluate-SLPromotion {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $ArtifactId,
        [Parameter(Mandatory)][string] $ApprovalRef,
        [AllowNull()][string] $TargetScopeId,
        [switch] $ExecuteChecks,
        [AllowNull()][string] $Now,
        [switch] $DryRun
    )

    return Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation {
        if (-not (Test-SLOpaqueReference $ApprovalRef)) {
            Throw-SLContractError -Code 'promotion-approval' -Message 'Approval reference must be opaque and contain no secrets or personal data.'
        }
        $Timestamp = Get-SLNormalizedTimestamp $Now
        $Registry = Get-SLRegistry $Root
        $Artifact = Find-SLArtifact $Registry $ArtifactId
        if (
            $Artifact.classification -cne 'promoted' -or
            $Artifact.status -cne 'probation' -or
            -not $Artifact.path -or
            -not (Test-SLProperty $Artifact 'promotionTargetPath')
        ) {
            Throw-SLContractError -Code 'promotion-state' -Message "Artifact $ArtifactId is not a probationary promoted instruction or skill."
        }
        $Snapshot = Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact -ExpectedArtifactType $Artifact.artifactType -ExpectedClassification promoted
        $ContractPath = Get-SLProperty $Snapshot.frontmatter 'validationContract'
        $ContractEvaluation = Invoke-SLValidationContract -Root $Root -ArtifactId $Artifact.id -ArtifactType $Artifact.artifactType -ArtifactPath $Artifact.promotionTargetPath -ContentPath $Artifact.path -SourceIds @($Artifact.dependsOn) -ContractPath $ContractPath -Frontmatter $Snapshot.frontmatter -ExpectedStatus probation -ExecuteChecks:$ExecuteChecks -DryRun:$DryRun
        $ContractPassed = @($ContractEvaluation.checks | Where-Object { $_.kind -ceq 'static' -and $_.id -cnotin @('contract-sources', 'contract-source-paths') -and $_.status -cne 'passed' }).Count -eq 0
        $SourcesValid = $true
        foreach ($SourceId in @($Artifact.dependsOn)) {
            try {
                $Source = Find-SLArtifact $Registry ([string] $SourceId)
                if ($Source.classification -cne 'evidence' -or [string] $Source.status -cnotin $script:SLActiveStatuses -or -not $Source.path) { $SourcesValid = $false }
            } catch { $SourcesValid = $false }
        }
        $ProvenancePassed = $SourcesValid -and @($ContractEvaluation.checks | Where-Object { $_.id -cin @('contract-sources', 'contract-source-paths') -and $_.status -cne 'passed' }).Count -eq 0
        $Scenarios = @($ContractEvaluation.checks | Where-Object kind -ceq 'scenario')
        $ScenariosPassed = $Scenarios.Count -gt 0 -and @($Scenarios | Where-Object status -cne 'passed').Count -eq 0
        $ExecutableConfigured = @((Get-SLProperty $ContractEvaluation.contract 'executableChecks' @())).Count -gt 0
        $ExecutablePassed = -not $ExecutableConfigured
        $ActiveContracts = @(Get-SLActiveContracts -Root $Root -Registry $Registry -CandidateId $ArtifactId)
        $CandidateContract = [pscustomobject] @{ artifactId = $ArtifactId; contract = $ContractEvaluation.contract; artifact = $Artifact }
        $AllContracts = @($ActiveContracts) + @($CandidateContract)
        $Conflicts = @(Get-SLValidationContractConflicts $AllContracts)
        $ConflictResolutions = @()
        $ConflictPassed = $Conflicts.Count -eq 0
        $Config = Get-SLConfig $Root
        $Governance = $null
        if ($Config.promotion.mode -ceq 'monorepo') {
            $Governance = Get-SLPromotionGovernance -Root $Root -Registry $Registry -Artifact $Artifact -Contract $ContractEvaluation.contract -ApprovalRef $ApprovalRef -TargetScopeId $TargetScopeId
            $ConflictResolutions = @(Resolve-SLScopedPromotionConflicts -Root $Root -Contracts $AllContracts -Conflicts $Conflicts)
            $ConflictPassed = @($ConflictResolutions | Where-Object status -ceq 'blocked').Count -eq 0
            Set-SLProperty $Governance.record 'conflictResolutions' $ConflictResolutions
            Set-SLProperty $Governance.record 'status' $(if ($Governance.evidencePassed -and $Governance.approvalPassed -and $ConflictPassed) { 'passed' } else { 'failed' })
        }
        $Gates = [System.Collections.Generic.List[object]]::new()
        function Add-Gate {
            param([string] $Id, [bool] $Passed, [string] $PassedMessage, [string] $FailedMessage)
            $Gates.Add([pscustomobject] @{ id = $Id; status = $(if ($Passed) { 'passed' } else { 'failed' }); message = $(if ($Passed) { $PassedMessage } else { $FailedMessage }) })
        }
        Add-Gate contract $ContractPassed 'Artifact structure and validation contract are valid.' 'Artifact structure or validation contract is invalid.'
        Add-Gate provenance $ProvenancePassed 'Registry evidence and contract provenance links are valid.' 'Registry evidence or contract provenance links are invalid.'
        Add-Gate 'static-scenarios' $ScenariosPassed 'All declared static scenarios passed.' 'One or more declared static scenarios failed.'
        Add-Gate 'active-conflicts' $ConflictPassed 'No declared conflict with active guidance exists.' 'A declared conflict exists or active guidance could not be validated.'
        Add-Gate 'executable-checks' $ExecutablePassed 'No executable checks are configured.' 'Repository-local PowerShell cannot execute Node/npm validation checks.'
        if ($null -eq $Governance) {
            Add-Gate 'repository-approval' $true 'Explicit repository review approval was supplied.' 'Explicit repository review approval is missing or invalid.'
        }
        else {
            Add-Gate 'scope-evidence' $Governance.evidencePassed 'Promotion evidence satisfies target-scope distribution policy.' 'Promotion evidence does not satisfy target-scope distribution policy.'
            Add-Gate 'owner-approval' $Governance.approvalPassed 'The target scope owner set approved the promotion.' 'Approval from the target scope owner set is missing or invalid.'
            Add-Gate 'scoped-conflicts' $ConflictPassed 'Scoped declarations are compatible or explicitly overridden.' 'A scoped declaration conflict is blocked.'
        }
        $ArtifactHash = Get-SLPromotionArtifactHash $Snapshot.content
        $ContractHash = $(if ($ContractPath) {
            Get-SLSha256 ((Read-SLSafeText -Root $Root -RelativePath $ContractPath).Replace("`r`n", "`n").Replace("`r", "`n"))
        } else { $null })
        $Evaluation = [ordered] @{
            schemaVersion = 1
            status = $(if (@($Gates | Where-Object status -ceq 'failed').Count -eq 0) { 'passed' } else { 'failed' })
            artifactVersion = "sha256:$ArtifactHash"
            artifactContentHash = $ArtifactHash
            contractContentHash = $ContractHash
            evaluatedAt = $Timestamp
            gates = $Gates.ToArray()
        }
        if ($null -eq $Governance) {
            $Evaluation['approvalEvidence'] = [pscustomobject] @{ kind = 'repository-review'; evidenceRef = $ApprovalRef }
        }
        else {
            $Evaluation['governance'] = $Governance.record
        }
        Set-SLProperty $Artifact 'promotionEvaluation' ([pscustomobject] $Evaluation)
        $Event = [pscustomobject] @{
            timestamp = $Timestamp
            artifactId = $ArtifactId
            action = 'promotion-evaluated'
            fromStatus = 'probation'
            toStatus = 'probation'
            fromPath = $Artifact.path
            toPath = $Artifact.path
            reason = $(if ($Evaluation.status -ceq 'passed') { 'Promotion activation gates passed.' } else { 'Promotion activation gates failed.' })
        }
        Assert-SLLifecycleEventsWritable -Root $Root -Events @($Event)
        $Changes = [System.Collections.Generic.List[object]]::new()
        [void] (Save-SLRegistry -Root $Root -Registry $Registry -Changes $Changes -DryRun:$DryRun)
        Write-SLIndexes -Root $Root -Registry $Registry -Changes $Changes -Projections @(Project-SLUsageEvents (Get-SLUsageEvents $Root)) -DryRun:$DryRun
        Write-SLLifecycleEvents -Root $Root -Events @($Event) -DryRun:$DryRun
        return [pscustomobject] @{ evaluation = [pscustomobject] $Evaluation; changes = $Changes.ToArray() }
    }
}

function Activate-SLPromotion {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $ArtifactId,
        [AllowNull()][string] $OwnerApprovalRef,
        [AllowNull()][string] $TargetScopeId,
        [AllowNull()][string] $Now,
        [switch] $DryRun
    )

    return Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation {
        $Timestamp = Get-SLNormalizedTimestamp $Now
        $Registry = Get-SLRegistry $Root
        $Artifact = Find-SLArtifact $Registry $ArtifactId
        if (
            $Artifact.classification -cne 'promoted' -or
            $Artifact.status -cne 'probation' -or
            -not $Artifact.path -or
            -not (Test-SLProperty $Artifact 'promotionTargetPath')
        ) {
            Throw-SLContractError -Code 'promotion-state' -Message "Artifact $ArtifactId is not in promotion probation."
        }
        if (-not (Test-SLProperty $Artifact 'promotionEvaluation') -or $Artifact.promotionEvaluation.status -cne 'passed') {
            Throw-SLContractError -Code 'promotion-evaluation' -Message "Artifact $ArtifactId does not have a passing promotion evaluation."
        }
        if (-not (Test-SLPromotionEvaluationCurrent $Root $Artifact)) {
            Throw-SLContractError -Code 'promotion-stale' -Message "Artifact $ArtifactId changed after evaluation and remains in probation."
        }
        $Config = Get-SLConfig $Root
        if ($Config.promotion.mode -ceq 'monorepo') {
            $Recorded = $Artifact.promotionEvaluation.governance
            $Approval = $(if ($OwnerApprovalRef) { $OwnerApprovalRef } else { @($Recorded.ownerApprovals)[0].evidenceRef })
            $ContractContent = Read-SLJson -Root $Root -RelativePath (
                (ConvertFrom-SLFrontmatter (Read-SLSafeText -Root $Root -RelativePath ([string] $Artifact.path))).frontmatter.validationContract
            )
            $Current = Get-SLPromotionGovernance -Root $Root -Registry $Registry -Artifact $Artifact -Contract $ContractContent -ApprovalRef $Approval -TargetScopeId $(if ($TargetScopeId) { $TargetScopeId } else { $Recorded.targetScope.id })
            if (
                $Current.record.status -cne 'passed' -or
                $Current.record.policyHash -cne $Recorded.policyHash -or
                (ConvertTo-SLCanonicalJson $Current.record.evidenceSummary) -cne (ConvertTo-SLCanonicalJson $Recorded.evidenceSummary)
            ) {
                Throw-SLContractError -Code 'promotion-governance-stale' -Message "Artifact $ArtifactId governance inputs changed and it remains in probation."
            }
        }
        if ([IO.File]::Exists((Resolve-SLContainedPath -Root $Root -RelativePath ([string] $Artifact.promotionTargetPath)))) {
            Throw-SLContractError -Code 'promotion-clobber' -Message "Activation target already exists: $($Artifact.promotionTargetPath)"
        }
        $Snapshot = Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact -ExpectedArtifactType $Artifact.artifactType -ExpectedClassification promoted
        Set-SLProperty $Snapshot.frontmatter 'status' 'active'
        $Event = [pscustomobject] @{
            timestamp = $Timestamp
            artifactId = $ArtifactId
            action = 'activated'
            fromStatus = 'probation'
            toStatus = 'active'
            fromPath = $Artifact.path
            toPath = $Artifact.promotionTargetPath
            reason = 'All governed promotion gates passed.'
        }
        Assert-SLLifecycleEventsWritable -Root $Root -Events @($Event)
        $Changes = [System.Collections.Generic.List[object]]::new()
        Write-SLTextChange -Root $Root -RelativePath ([string] $Artifact.path) -Content (
            ConvertTo-SLFrontmatterText -Frontmatter $Snapshot.frontmatter -Body $Snapshot.body
        ) -Changes $Changes -DryRun:$DryRun
        $OldPath = [string] $Artifact.path
        Move-SLContainedFile -Root $Root -SourceRelativePath $OldPath -TargetRelativePath ([string] $Artifact.promotionTargetPath) -Changes $Changes -DryRun:$DryRun
        Set-SLProperty $Artifact 'path' ([string] $Artifact.promotionTargetPath)
        Set-SLProperty $Artifact 'status' 'active'
        Set-SLProperty $Artifact 'activatedAt' $Timestamp
        Set-SLProperty $Artifact 'lastVerifiedAt' $Timestamp
        [void] (Save-SLRegistry -Root $Root -Registry $Registry -Changes $Changes -DryRun:$DryRun)
        Write-SLIndexes -Root $Root -Registry $Registry -Changes $Changes -Projections @(Project-SLUsageEvents (Get-SLUsageEvents $Root)) -DryRun:$DryRun
        Write-SLLifecycleEvents -Root $Root -Events @($Event) -DryRun:$DryRun
        return [pscustomobject] @{ artifactId = $ArtifactId; changes = $Changes.ToArray() }
    }
}

function Move-SLPromotionToProbation {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][object] $Artifact,
        [Parameter(Mandatory)][System.Collections.Generic.List[object]] $Changes,
        [switch] $DryRun
    )

    if (-not $Artifact.path) { return }
    $TargetPath = [string] (Get-SLProperty $Artifact 'promotionTargetPath' (Get-SLProperty $Artifact 'originalPath' $Artifact.path))
    $ProbationPath = Get-SLProbationPath $Artifact.id $Artifact.artifactType $TargetPath
    if ([IO.File]::Exists((Resolve-SLContainedPath -Root $Root -RelativePath $ProbationPath))) {
        Throw-SLContractError -Code 'promotion-clobber' -Message "Promotion probation path already exists: $ProbationPath"
    }
    $Snapshot = Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact -ExpectedArtifactType $Artifact.artifactType -ExpectedClassification promoted
    Set-SLProperty $Snapshot.frontmatter 'status' 'probation'
    Write-SLTextChange -Root $Root -RelativePath ([string] $Artifact.path) -Content (
        ConvertTo-SLFrontmatterText -Frontmatter $Snapshot.frontmatter -Body $Snapshot.body
    ) -Changes $Changes -DryRun:$DryRun
    Move-SLContainedFile -Root $Root -SourceRelativePath ([string] $Artifact.path) -TargetRelativePath $ProbationPath -Changes $Changes -DryRun:$DryRun
    Set-SLProperty $Artifact 'path' $ProbationPath
    Set-SLProperty $Artifact 'promotionTargetPath' $TargetPath
    Remove-SLProperty $Artifact 'originalPath'
}
