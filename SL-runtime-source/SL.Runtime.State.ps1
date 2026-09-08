Set-StrictMode -Version Latest

$script:SLLearningRoot = '.github/sl-learning'
$script:SLConfigPath = '.github/sl-learning/sl-config.yml'
$script:SLScopeCatalogCandidates = @(
    '.github/sl-learning/sl-scope-catalog.yml',
    '.github/sl-learning/sl-scope-catalog.yaml',
    '.github/sl-learning/sl-scope-catalog.json'
)
$script:SLStateCatalogPath = '.github/sl-learning/sl-state-catalog.json'
$script:SLScopeRoot = '.github/sl-learning/sl-scopes'
$script:SLLifecycleRoot = '.github/sl-learning/sl-lifecycle-events'
$script:SLLessonsRoot = '.github/sl-learning/sl-lessons'
$script:SLProbationRoot = '.github/sl-learning/sl-probation'
$script:SLQuarantineRoot = '.github/sl-learning/sl-quarantine'
$script:SLDefaultScope = [pscustomobject] @{
    id = 'SL-SCOPE-ROOT'
    path = '.'
}
$script:SLActiveStatuses = @(
    'active',
    'raw',
    'distilled',
    'promotion-candidate',
    'promoted'
)
$script:SLReferenceProtectingStatuses = @(
    'active',
    'raw',
    'distilled',
    'promotion-candidate',
    'promoted',
    'probation'
)

function Sort-SLOrdinal {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [string[]] $Values
    )

    $Copy = [string[]] @($Values)
    [Array]::Sort($Copy, [StringComparer]::Ordinal)
    return ,$Copy
}

function ConvertTo-SLRepositoryPath {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Path
    )

    if ($Path.Contains([char] 0)) {
        Throw-SLContractError -Code 'path-nul' -Message 'Repository paths cannot contain NUL.'
    }
    $RootFull = [IO.Path]::GetFullPath($Root)
    $Candidate = $Path
    if ([IO.Path]::IsPathFullyQualified($Candidate)) {
        $TargetFull = [IO.Path]::GetFullPath($Candidate)
        $Comparison = if ($IsWindows) {
            [StringComparison]::OrdinalIgnoreCase
        }
        else {
            [StringComparison]::Ordinal
        }
        $Prefix = $RootFull.TrimEnd(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar
        ) + [IO.Path]::DirectorySeparatorChar
        if (
            -not $TargetFull.Equals($RootFull, $Comparison) -and
            -not $TargetFull.StartsWith($Prefix, $Comparison)
        ) {
            Throw-SLContractError -Code 'path-escape' -Message "Path escapes repository root: $Path"
        }
        $Candidate = [IO.Path]::GetRelativePath($RootFull, $TargetFull)
    }
    elseif ($Candidate -match '^[A-Za-z]:[^\\/]') {
        Throw-SLContractError -Code 'path-drive-relative' -Message "Drive-relative paths are not allowed: $Path"
    }
    $Normalized = ConvertTo-SLNormalizedPath -Path $Candidate
    return $(if ($Normalized -ceq '.') { '' } else { $Normalized })
}

function Get-SLDefaultConfig {
    return [pscustomobject] @{
        schemaVersion = 1
        scope = 'repo'
        retention = [pscustomobject] @{
            staleAfterDays = 90
            quarantineAfterDays = 180
            deleteAfterQuarantineDays = 30
            wrongDeleteAfterDays = 7
            promotedStaleAfterDays = 365
            promotedQuarantineAfterDays = 30
        }
        promotion = [pscustomobject] @{
            mode = 'single-repository'
            policyVersion = '1'
            local = [pscustomobject] @{
                minimumVerifiedSuccesses = 1
            }
            shared = [pscustomobject] @{
                minimumDistinctNonRootScopes = 2
                minimumVerifiedSuccessesPerScope = 1
            }
            approvals = [pscustomobject] @{
                requireTargetOwnerApproval = $true
            }
            conflicts = [pscustomobject] @{
                allowNarrowerExplicitOverrides = $true
                blockUndeclaredConflicts = $true
            }
        }
    }
}

function Merge-SLObject {
    param(
        [Parameter(Mandatory)]
        [object] $Base,

        [AllowNull()]
        [object] $Overlay
    )

    $Result = Copy-SLValue $Base
    if ($null -eq $Overlay) {
        return $Result
    }
    foreach ($Property in $Overlay.PSObject.Properties) {
        $Current = Get-SLProperty -Value $Result -Name $Property.Name
        if (
            $null -ne $Current -and
            (Test-SLMap $Current) -and
            (Test-SLMap $Property.Value)
        ) {
            Set-SLProperty -Value $Result -Name $Property.Name -PropertyValue (
                Merge-SLObject -Base $Current -Overlay $Property.Value
            )
        }
        else {
            Set-SLProperty -Value $Result -Name $Property.Name -PropertyValue $Property.Value
        }
    }
    return $Result
}

function Get-SLConfig {
    param([Parameter(Mandatory)][string] $Root)

    $Default = Get-SLDefaultConfig
    $Path = Resolve-SLContainedPath -Root $Root -RelativePath $script:SLConfigPath
    $Config = if ([IO.File]::Exists($Path)) {
        Merge-SLObject -Base $Default -Overlay (
            ConvertFrom-SLYaml -Content (Read-SLSafeText -Root $Root -RelativePath $script:SLConfigPath)
        )
    }
    else {
        $Default
    }
    if ($Config.schemaVersion -ne 1 -or $Config.scope -cne 'repo') {
        Throw-SLContractError -Code 'config-contract' -Message 'SL config requires schemaVersion 1 and scope repo.'
    }
    foreach ($Name in @(
        'staleAfterDays',
        'quarantineAfterDays',
        'deleteAfterQuarantineDays',
        'wrongDeleteAfterDays',
        'promotedStaleAfterDays',
        'promotedQuarantineAfterDays'
    )) {
        $Value = Get-SLProperty $Config.retention $Name
        if ($Value -isnot [long] -or $Value -le 0) {
            Throw-SLContractError -Code 'config-retention' -Message "Retention setting $Name must be a positive integer."
        }
    }
    if ($Config.retention.quarantineAfterDays -lt $Config.retention.staleAfterDays) {
        Throw-SLContractError -Code 'config-retention' -Message 'retention.quarantineAfterDays must be greater than or equal to staleAfterDays.'
    }
    if ($Config.promotion.mode -cnotin @('single-repository', 'monorepo')) {
        Throw-SLContractError -Code 'config-promotion' -Message 'promotion.mode must be single-repository or monorepo.'
    }
    foreach ($Value in @(
        $Config.promotion.local.minimumVerifiedSuccesses,
        $Config.promotion.shared.minimumDistinctNonRootScopes,
        $Config.promotion.shared.minimumVerifiedSuccessesPerScope
    )) {
        if ($Value -isnot [long] -or $Value -lt 1) {
            Throw-SLContractError -Code 'config-promotion' -Message 'Promotion evidence thresholds must be positive integers.'
        }
    }
    return $Config
}

function Get-SLDefaultScopeCatalog {
    return [pscustomobject] @{
        schemaVersion = 1
        scopes = @(
            [pscustomobject] @{
                id = 'SL-SCOPE-ROOT'
                displayName = 'Repository'
                kind = 'repository'
                includePaths = @('**')
                excludePaths = @()
                dependencyScopeIds = @()
                ownerAliases = @()
            }
        )
    }
}

function Get-SLScopeCatalog {
    param([Parameter(Mandatory)][string] $Root)

    $Existing = [System.Collections.Generic.List[string]]::new()
    foreach ($Candidate in $script:SLScopeCatalogCandidates) {
        if ([IO.File]::Exists((Resolve-SLContainedPath -Root $Root -RelativePath $Candidate))) {
            $Existing.Add($Candidate)
        }
    }
    if ($Existing.Count -gt 1) {
        Throw-SLContractError -Code 'multiple-scope-catalogs' -Message "Only one SL scope catalog is allowed: $($Existing -join ', ')"
    }
    $Catalog = if ($Existing.Count -eq 0) {
        Get-SLDefaultScopeCatalog
    }
    elseif ($Existing[0].EndsWith('.json')) {
        Read-SLJson -Root $Root -RelativePath $Existing[0]
    }
    else {
        ConvertFrom-SLYaml -Content (Read-SLSafeText -Root $Root -RelativePath $Existing[0])
    }
    $Issues = @(Test-SLScopeCatalog -Catalog $Catalog)
    if ($Issues.Count -gt 0) {
        Throw-SLContractError -Code 'scope-catalog-invalid' -Message (
            "Invalid SL scope catalog: " +
            (($Issues | ForEach-Object { "$($_.code): $($_.message)" }) -join '; ')
        )
    }
    return $Catalog
}

function Get-SLScopeDefinitionPath {
    param([Parameter(Mandatory)][object] $Scope)

    if (-not (Test-SLProperty $Scope 'parentScopeId')) {
        return '.'
    }
    $Prefixes = [System.Collections.Generic.List[object]]::new()
    foreach ($Pattern in @($Scope.includePaths)) {
        $Parts = [System.Collections.Generic.List[string]]::new()
        foreach ($Segment in $Pattern.Split('/')) {
            if ($Segment -match '[*?\[\]{}()!+@]') {
                break
            }
            $Parts.Add($Segment)
        }
        if ($Parts.Count -gt 0) {
            $Prefixes.Add($Parts.ToArray())
        }
    }
    if ($Prefixes.Count -eq 0) {
        return '.'
    }
    $Common = [System.Collections.Generic.List[string]]::new()
    foreach ($Segment in @($Prefixes[0])) {
        $Common.Add($Segment)
    }
    foreach ($Prefix in @($Prefixes | Select-Object -Skip 1)) {
        while ($Common.Count -gt 0) {
            $Matches = $true
            for ($Index = 0; $Index -lt $Common.Count; $Index += 1) {
                if ($Index -ge $Prefix.Count -or $Prefix[$Index] -cne $Common[$Index]) {
                    $Matches = $false
                    break
                }
            }
            if ($Matches) {
                break
            }
            $Common.RemoveAt($Common.Count - 1)
        }
    }
    return $(if ($Common.Count -eq 0) { '.' } else { $Common -join '/' })
}

function Get-SLScopeDescriptor {
    param([Parameter(Mandatory)][object] $Scope)

    return [pscustomobject] @{
        id = [string] $Scope.id
        path = Get-SLScopeDefinitionPath $Scope
    }
}

function Normalize-SLScope {
    param(
        [AllowNull()]
        [object] $Scope
    )

    if ($null -eq $Scope) {
        return Copy-SLValue $script:SLDefaultScope
    }
    $Id = ([string] $Scope.id).Trim()
    $Path = ([string] $Scope.path).Trim().Replace('\', '/')
    if ($Id -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') {
        Throw-SLContractError -Code 'scope-id' -Message "Invalid state scope id: $Id"
    }
    $Normalized = ConvertTo-SLNormalizedPath -Path $Path
    return [pscustomobject] @{ id = $Id; path = $Normalized }
}

function Get-SLScopeKey {
    param([Parameter(Mandatory)][object] $Scope)

    $Normalized = Normalize-SLScope $Scope
    return "$($Normalized.id)$([char]0)$($Normalized.path)"
}

function Test-SLDefiniteExclusionCoversInclude {
    param(
        [Parameter(Mandatory)][string] $IncludePattern,
        [Parameter(Mandatory)][string] $ExcludePattern
    )

    if ($ExcludePattern -ceq '**' -or $IncludePattern -ceq $ExcludePattern) {
        return $true
    }
    if ($ExcludePattern.EndsWith('/**', [StringComparison]::Ordinal)) {
        $ExcludedRoot = $ExcludePattern.Substring(0, $ExcludePattern.Length - 3)
        return $IncludePattern.StartsWith("$ExcludedRoot/", [StringComparison]::Ordinal)
    }
    if ($IncludePattern -notmatch '[*?\[\]{}()!+@]') {
        return Test-SLGlob -Pattern $ExcludePattern -Path $IncludePattern
    }
    return $false
}

function Test-SLScopeCatalog {
    param([Parameter(Mandatory)][object] $Catalog)

    $Issues = [System.Collections.Generic.List[object]]::new()
    if ($Catalog.schemaVersion -ne 1 -or $Catalog.scopes -isnot [array]) {
        $Issues.Add([pscustomobject] @{ code = 'scope-catalog-schema'; message = 'Scope catalog requires schemaVersion 1 and scopes array.' })
        return $Issues.ToArray()
    }
    $ById = @{}
    foreach ($Scope in @($Catalog.scopes)) {
        if ([string] $Scope.id -cnotmatch '^SL-SCOPE-[A-Z0-9]+(?:-[A-Z0-9]+)*$') {
            $Issues.Add([pscustomobject] @{ code = 'invalid-scope-id'; message = "Invalid scope ID: $($Scope.id)" })
        }
        if ($ById.ContainsKey([string] $Scope.id)) {
            $Issues.Add([pscustomobject] @{ code = 'duplicate-scope-id'; message = "Duplicate scope ID: $($Scope.id)" })
        }
        else {
            $ById[[string] $Scope.id] = $Scope
        }
        if ([string] $Scope.kind -cnotin @('repository', 'shared', 'solution', 'service', 'library', 'package')) {
            $Issues.Add([pscustomobject] @{ code = 'invalid-scope-kind'; message = "Invalid scope kind for $($Scope.id)." })
        }
        if (@($Scope.includePaths).Count -eq 0) {
            $Issues.Add([pscustomobject] @{ code = 'unmatchable-scope'; message = "Scope $($Scope.id) has no include paths." })
        }
        foreach ($Pattern in @($Scope.includePaths) + @($Scope.excludePaths)) {
            try {
                [void] (ConvertTo-SLNormalizedGlob -Pattern ([string] $Pattern))
            }
            catch {
                $Issues.Add([pscustomobject] @{ code = 'unsafe-scope-path'; message = $_.Exception.Message })
            }
        }
        foreach ($Alias in @($Scope.ownerAliases)) {
            if ([string] $Alias -cnotmatch '^@[A-Za-z0-9](?:[A-Za-z0-9_.-]*)(?:/[A-Za-z0-9](?:[A-Za-z0-9_.-]*))?$') {
                $Issues.Add([pscustomobject] @{ code = 'invalid-owner-alias'; message = "Invalid owner alias: $Alias" })
            }
        }
        if (@($Scope.includePaths).Count -gt 0) {
            $Usable = @($Scope.includePaths | Where-Object {
                $Include = [string] $_
                @($Scope.excludePaths | Where-Object {
                    Test-SLDefiniteExclusionCoversInclude -IncludePattern $Include -ExcludePattern ([string] $_)
                }).Count -eq 0
            }).Count -gt 0
            if (-not $Usable) {
                $Issues.Add([pscustomobject] @{ code = 'unmatchable-scope'; message = "Scope $($Scope.id) has no include pattern outside its exclusions." })
            }
        }
    }
    $Roots = @($Catalog.scopes | Where-Object { -not (Test-SLProperty $_ 'parentScopeId') })
    if ($Roots.Count -ne 1) {
        $Issues.Add([pscustomobject] @{ code = 'scope-root-count'; message = "Scope catalog must define exactly one parentless root; found $($Roots.Count)." })
    }
    elseif (
        [string] $Roots[0].kind -cnotin @('repository', 'shared') -or
        @($Roots[0].includePaths) -cnotcontains '**' -or
        @($Roots[0].excludePaths).Count -gt 0
    ) {
        $Issues.Add([pscustomobject] @{ code = 'invalid-root-scope'; message = 'Root scope must be universal and have repository/shared kind.' })
    }
    foreach ($Scope in @($Catalog.scopes)) {
        if ((Test-SLProperty $Scope 'parentScopeId') -and -not $ById.ContainsKey([string] $Scope.parentScopeId)) {
            $Issues.Add([pscustomobject] @{ code = 'missing-parent-scope'; message = "Missing parent scope $($Scope.parentScopeId) for $($Scope.id)." })
        }
        $SeenDependencies = @{}
        foreach ($Dependency in @($Scope.dependencyScopeIds)) {
            if ($SeenDependencies.ContainsKey([string] $Dependency)) {
                $Issues.Add([pscustomobject] @{ code = 'duplicate-scope-dependency'; message = "Duplicate dependency $Dependency for $($Scope.id)." })
            }
            $SeenDependencies[[string] $Dependency] = $true
            if (-not $ById.ContainsKey([string] $Dependency)) {
                $Issues.Add([pscustomobject] @{ code = 'missing-dependency-scope'; message = "Missing dependency scope $Dependency for $($Scope.id)." })
            }
        }
    }
    foreach ($Scope in @($Catalog.scopes)) {
        $Seen = @{}
        $Current = $Scope
        while ($null -ne $Current) {
            if ($Seen.ContainsKey([string] $Current.id)) {
                $Issues.Add([pscustomobject] @{ code = 'scope-cycle'; message = "Scope relationship cycle detected at $($Current.id)." })
                break
            }
            $Seen[[string] $Current.id] = $true
            if (-not (Test-SLProperty $Current 'parentScopeId')) {
                break
            }
            $Current = $ById[[string] $Current.parentScopeId]
        }
    }
    return $Issues.ToArray()
}

function Get-SLPatternSpecificity {
    param([Parameter(Mandatory)][string] $Pattern)

    $Segments = $Pattern.Split('/')
    $LiteralSegments = @($Segments | Where-Object { $_ -notmatch '[*?\[\]{}()!+@]' }).Count
    $LiteralCharacters = $Pattern.Length - ([Regex]::Matches($Pattern, '[*?\[\]{}()!+@]').Count)
    $WildcardCharacters = $Pattern.Length - $LiteralCharacters
    return @($LiteralSegments, $LiteralCharacters, $Segments.Count, -$WildcardCharacters)
}

function Compare-SLSpecificity {
    param([int[]] $Left, [int[]] $Right)

    for ($Index = 0; $Index -lt [Math]::Max($Left.Count, $Right.Count); $Index += 1) {
        $Difference = $(if ($Index -lt $Left.Count) { $Left[$Index] } else { 0 }) -
            $(if ($Index -lt $Right.Count) { $Right[$Index] } else { 0 })
        if ($Difference -ne 0) {
            return $Difference
        }
    }
    return 0
}

function Resolve-SLScope {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [string] $Path,

        [AllowNull()]
        [object] $Catalog
    )

    if ($null -eq $Catalog) {
        $Catalog = Get-SLScopeCatalog $Root
    }
    $NormalizedPath = ConvertTo-SLRepositoryPath -Root $Root -Path $Path
    $ById = @{}
    foreach ($Scope in @($Catalog.scopes)) {
        $ById[[string] $Scope.id] = $Scope
    }
    $RootScope = @($Catalog.scopes | Where-Object { -not (Test-SLProperty $_ 'parentScopeId') })[0]
    $Matches = [System.Collections.Generic.List[object]]::new()
    foreach ($Scope in @($Catalog.scopes)) {
        $Excluded = @($Scope.excludePaths | Where-Object {
            $NormalizedPath -and (Test-SLGlob -Pattern ([string] $_) -Path $NormalizedPath)
        }).Count -gt 0
        if ($Excluded) {
            continue
        }
        $MatchedPatterns = @($Scope.includePaths | Where-Object {
            ($NormalizedPath -and (Test-SLGlob -Pattern ([string] $_) -Path $NormalizedPath)) -or
            ([string] $Scope.id -ceq [string] $RootScope.id -and -not $NormalizedPath -and [string] $_ -ceq '**')
        })
        if ($MatchedPatterns.Count -eq 0) {
            continue
        }
        $Specificity = $null
        foreach ($Pattern in $MatchedPatterns) {
            $Candidate = Get-SLPatternSpecificity ([string] $Pattern)
            if ($null -eq $Specificity -or (Compare-SLSpecificity $Candidate $Specificity) -gt 0) {
                $Specificity = $Candidate
            }
        }
        $Depth = 0
        $Current = $Scope
        while (Test-SLProperty $Current 'parentScopeId') {
            $Depth += 1
            $Current = $ById[[string] $Current.parentScopeId]
        }
        $Matches.Add([pscustomobject] @{
            scope = $Scope
            specificity = $Specificity
            hierarchyDepth = $Depth
            priority = [int] (Get-SLProperty $Scope 'priority' 0)
        })
    }
    if ($Matches.Count -eq 0) {
        Throw-SLContractError -Code 'scope-no-match' -Message "No SL scope matches repository path: $NormalizedPath"
    }
    $OrderedMatches = @($Matches | Sort-Object -Stable -Property @(
        @{ Expression = { $_.specificity[0] }; Descending = $true },
        @{ Expression = { $_.specificity[1] }; Descending = $true },
        @{ Expression = { $_.specificity[2] }; Descending = $true },
        @{ Expression = { $_.specificity[3] }; Descending = $true },
        @{ Expression = { $_.hierarchyDepth }; Descending = $true },
        @{ Expression = { $_.priority }; Descending = $true },
        @{ Expression = { [string] $_.scope.id }; Descending = $false }
    ))
    $Primary = $OrderedMatches[0]
    $Equal = @($OrderedMatches | Where-Object {
        (Compare-SLSpecificity $_.specificity $Primary.specificity) -eq 0 -and
        $_.hierarchyDepth -eq $Primary.hierarchyDepth -and
        $_.priority -eq $Primary.priority
    })
    if ($Equal.Count -gt 1) {
        $Ids = Sort-SLOrdinal @($Equal | ForEach-Object { [string] $_.scope.id })
        Throw-SLContractError -Code 'scope-ambiguity' -Message "Ambiguous SL scope resolution for $(if ($NormalizedPath) { $NormalizedPath } else { '.' }): $($Ids -join ', ')"
    }
    $DependencyOrder = [System.Collections.Generic.List[string]]::new()
    $Seen = @{}
    $Seen[[string] $Primary.scope.id] = $true
    function Visit-SLDependency {
        param([string] $ScopeId)
        $Scope = $ById[$ScopeId]
        foreach ($Dependency in (Sort-SLOrdinal @($Scope.dependencyScopeIds))) {
            if ($Seen.ContainsKey($Dependency)) {
                continue
            }
            $Seen[$Dependency] = $true
            $DependencyOrder.Add($Dependency)
            Visit-SLDependency $Dependency
        }
    }
    Visit-SLDependency ([string] $Primary.scope.id)
    $Ancestors = @{}
    foreach ($ScopeId in @([string] $Primary.scope.id) + @($DependencyOrder)) {
        $Current = $ById[$ScopeId]
        while (Test-SLProperty $Current 'parentScopeId') {
            $ParentId = [string] $Current.parentScopeId
            $Parent = $ById[$ParentId]
            $Depth = 0
            $Walk = $Parent
            while (Test-SLProperty $Walk 'parentScopeId') {
                $Depth += 1
                $Walk = $ById[[string] $Walk.parentScopeId]
            }
            $Ancestors[$ParentId] = $Depth
            $Current = $Parent
        }
    }
    $AncestorIds = @($Ancestors.Keys | Sort-Object -Stable -Property @(
        @{ Expression = { $Ancestors[$_] }; Descending = $true },
        @{ Expression = { $_ }; Descending = $false }
    ))
    $AncestorSet = @{}
    foreach ($Id in $AncestorIds) {
        $AncestorSet[$Id] = $true
    }
    $OrderedIds = [System.Collections.Generic.List[string]]::new()
    foreach ($Id in @([string] $Primary.scope.id) + @($DependencyOrder | Where-Object { -not $AncestorSet.ContainsKey($_) }) + $AncestorIds) {
        if (-not $OrderedIds.Contains($Id)) {
            $OrderedIds.Add($Id)
        }
    }
    return [pscustomobject] @{
        inputPath = $Path
        normalizedPath = $NormalizedPath
        primaryScopeId = [string] $Primary.scope.id
        matchedScopeIds = @($OrderedMatches | ForEach-Object { [string] $_.scope.id })
        orderedScopeIds = $OrderedIds.ToArray()
    }
}

function Resolve-SLScopeDescriptor {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [AllowNull()]
        [string] $ScopeId,

        [AllowNull()]
        [string] $TargetPath
    )

    $Catalog = Get-SLScopeCatalog $Root
    if ($ScopeId) {
        $Scope = @($Catalog.scopes | Where-Object { [string] $_.id -ceq $ScopeId })
        if ($Scope.Count -ne 1) {
            Throw-SLContractError -Code 'scope-not-found' -Message "SL scope does not exist in the catalog: $ScopeId"
        }
        return [pscustomobject] @{ scope = Get-SLScopeDescriptor $Scope[0] }
    }
    $Resolution = Resolve-SLScope -Root $Root -Path $(if ($TargetPath) { $TargetPath } else { $Root }) -Catalog $Catalog
    $Definition = @($Catalog.scopes | Where-Object { [string] $_.id -ceq $Resolution.primaryScopeId })[0]
    return [pscustomobject] @{
        scope = Get-SLScopeDescriptor $Definition
        resolution = $Resolution
    }
}

function Get-SLScopeShardName {
    param([Parameter(Mandatory)][object] $Scope)

    $Normalized = Normalize-SLScope $Scope
    $SlugValue = if ($Normalized.path -ceq '.') {
        $Normalized.id
    }
    else {
        "$($Normalized.id)-$($Normalized.path)"
    }
    $Slug = ConvertTo-SLSlug -Value $SlugValue -MaximumLength 40
    if (-not $Slug) {
        $Slug = 'scope'
    }
    $Hash = (Get-SLSha256 -Value (Get-SLScopeKey $Normalized)).Substring(0, 12)
    return "sl-$Slug-$Hash"
}

function Get-SLArtifactShardName {
    param([Parameter(Mandatory)][string] $ArtifactId)

    $Slug = ConvertTo-SLSlug -Value $ArtifactId -MaximumLength 48
    if (-not $Slug) {
        $Slug = 'artifact'
    }
    return "sl-$Slug-$((Get-SLSha256 $ArtifactId).Substring(0, 12))"
}

function Get-SLStateCatalogEntry {
    param([Parameter(Mandatory)][object] $Scope)

    $Normalized = Normalize-SLScope $Scope
    $Shard = Get-SLScopeShardName $Normalized
    $Root = "$script:SLScopeRoot/$Shard"
    return [pscustomobject] @{
        scope = $Normalized
        shard = $Shard
        registryPath = "$Root/sl-registry.json"
        indexPath = "$Root/sl-index.json"
        projectionPath = "$Root/sl-usage-projection.json"
        usageEventsPath = "$Root/sl-usage-events"
        resourceReceiptsPath = "$Root/sl-resource-receipts"
        resourceProjectionPath = "$Root/sl-resource-projection.json"
    }
}

function Get-SLStateCatalog {
    param([Parameter(Mandatory)][string] $Root)

    $Path = Resolve-SLContainedPath -Root $Root -RelativePath $script:SLStateCatalogPath
    if (-not [IO.File]::Exists($Path)) {
        return [pscustomobject] @{ schemaVersion = 1; scopes = @() }
    }
    return Read-SLJson -Root $Root -RelativePath $script:SLStateCatalogPath
}

function New-SLStateCatalog {
    param([Parameter(Mandatory)][object[]] $Scopes)

    $ByKey = @{}
    foreach ($Scope in $Scopes) {
        $Normalized = Normalize-SLScope $Scope
        $ByKey[(Get-SLScopeKey $Normalized)] = $Normalized
    }
    [object[]] $Entries = @($ByKey.Values | ForEach-Object { Get-SLStateCatalogEntry $_ })
    $Entries = @($Entries | Sort-Object -Stable -Property @{ Expression = { Get-SLScopeKey $_.scope } })
    $Seen = @{}
    foreach ($Entry in $Entries) {
        $Key = Get-SLScopeKey $Entry.scope
        if ($Seen.ContainsKey($Entry.shard) -and $Seen[$Entry.shard] -cne $Key) {
            Throw-SLContractError -Code 'scope-shard-collision' -Message "Normalized scope shard collision: $($Entry.shard)."
        }
        $Seen[$Entry.shard] = $Key
    }
    return [pscustomobject] @{ schemaVersion = 1; scopes = $Entries }
}

function Get-SLArtifactIdentity {
    param([Parameter(Mandatory)][object] $Artifact)

    return [pscustomobject] @{
        id = $Artifact.id
        artifactType = $Artifact.artifactType
        classification = $Artifact.classification
        managedBy = $Artifact.managedBy
        createdAt = $Artifact.createdAt
        scope = Normalize-SLScope (Get-SLProperty $Artifact 'scope' $script:SLDefaultScope)
        ownedPath = $(if (Test-SLProperty $Artifact 'promotionTargetPath') {
            $Artifact.promotionTargetPath
        } elseif (Test-SLProperty $Artifact 'originalPath') {
            $Artifact.originalPath
        } else {
            $Artifact.path
        })
        dependsOn = Sort-SLOrdinal @((Get-SLProperty $Artifact 'dependsOn' @()))
    }
}

function Get-SLRegistry {
    param([Parameter(Mandatory)][string] $Root)

    $Artifacts = @{}
    $Owners = @{}
    $Catalog = Get-SLStateCatalog $Root
    foreach ($RegistryRelativePath in (Sort-SLOrdinal @(
        $Catalog.scopes | ForEach-Object { [string] $_.registryPath }
    ))) {
        $RegistryPath = Resolve-SLContainedPath -Root $Root -RelativePath $RegistryRelativePath
        if (-not [IO.File]::Exists($RegistryPath)) {
            continue
        }
        $Shard = Read-SLJson -Root $Root -RelativePath $RegistryRelativePath
        $Within = @{}
        foreach ($Artifact in @($Shard.artifacts)) {
            if ($Within.ContainsKey([string] $Artifact.id)) {
                Throw-SLContractError -Code 'registry-duplicate' -Message "Duplicate artifact ID $($Artifact.id) within registry shard $RegistryRelativePath."
            }
            $Within[[string] $Artifact.id] = $true
            if ($Owners.ContainsKey([string] $Artifact.id)) {
                Throw-SLContractError -Code 'registry-duplicate' -Message "Duplicate artifact ID $($Artifact.id) across registry shards $($Owners[[string] $Artifact.id]) and $RegistryRelativePath."
            }
            $Owners[[string] $Artifact.id] = $RegistryRelativePath
            Set-SLProperty $Artifact 'scope' (Normalize-SLScope (Get-SLProperty $Artifact 'scope' $Shard.scope))
            $Artifacts[[string] $Artifact.id] = $Artifact
        }
    }
    $Values = @($Artifacts.Values)
    $Values = @($Values | Sort-Object -Stable -Property @{ Expression = { [string] $_.id } })
    return [pscustomobject] @{ schemaVersion = 1; artifacts = $Values }
}

function Find-SLArtifact {
    param([Parameter(Mandatory)][object] $Registry, [Parameter(Mandatory)][string] $Id)

    $Artifact = @($Registry.artifacts | Where-Object { [string] $_.id -ceq $Id })
    if ($Artifact.Count -ne 1) {
        Throw-SLContractError -Code 'artifact-not-found' -Message "SL artifact not found: $Id"
    }
    return $Artifact[0]
}

function Save-SLRegistry {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [object] $Registry,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]] $Changes,

        [switch] $DryRun
    )

    $Scopes = @{}
    $HandCatalog = Get-SLScopeCatalog $Root
    foreach ($Definition in @($HandCatalog.scopes)) {
        $Descriptor = Get-SLScopeDescriptor $Definition
        $Scopes[(Get-SLScopeKey $Descriptor)] = $Descriptor
    }
    foreach ($Artifact in @($Registry.artifacts)) {
        $Scope = Normalize-SLScope (Get-SLProperty $Artifact 'scope' $script:SLDefaultScope)
        Set-SLProperty $Artifact 'scope' $Scope
        $Scopes[(Get-SLScopeKey $Scope)] = $Scope
    }
    $Catalog = New-SLStateCatalog @($Scopes.Values)
    Write-SLJson -Root $Root -RelativePath $script:SLStateCatalogPath -Value $Catalog -Changes $Changes -DryRun:$DryRun
    foreach ($Entry in @($Catalog.scopes)) {
        $Key = Get-SLScopeKey $Entry.scope
        $Artifacts = @($Registry.artifacts | Where-Object {
            (Get-SLScopeKey (Get-SLProperty $_ 'scope' $script:SLDefaultScope)) -ceq $Key
        } | Sort-Object -Stable -Property @{ Expression = { [string] $_.id } })
        [object[]] $Persisted = @(foreach ($Artifact in $Artifacts) {
            $Copy = Copy-SLValue $Artifact
            Remove-SLProperty $Copy 'usageProjection'
            $Copy
        })
        $Shard = [pscustomobject] @{
            schemaVersion = 1
            scope = $Entry.scope
            artifacts = [object[]] $Persisted
        }
        Write-SLJson -Root $Root -RelativePath ([string] $Entry.registryPath) -Value $Shard -Changes $Changes -DryRun:$DryRun
    }
    if ($null -ne (Get-Command Sync-SLResourceProjection -ErrorAction SilentlyContinue)) {
        Sync-SLResourceProjection -Root $Root -DryRun:$DryRun -Changes $Changes
    }
    return $Catalog
}

function New-SLLifecycleEvent {
    param([Parameter(Mandatory)][object] $Event)

    $Normalized = [ordered] @{
        schemaVersion = 1
        timestamp = [string] $Event.timestamp
        artifactId = [string] $Event.artifactId
        action = [string] $Event.action
    }
    foreach ($Name in @('reason', 'fromStatus', 'toStatus', 'fromPath', 'toPath')) {
        if (Test-SLProperty $Event $Name) {
            $Normalized[$Name] = Get-SLProperty $Event $Name
        }
    }
    $Hash = Get-SLSha256 -Value (ConvertTo-Json $Normalized -Depth 20 -Compress)
    $Normalized['eventId'] = "SL-EVENT-$($Hash.Substring(0, 32).ToUpperInvariant())"
    $Normalized['idempotencyKey'] = "sha256:$Hash"
    return [pscustomobject] $Normalized
}

function Get-SLLifecycleEventPath {
    param([Parameter(Mandatory)][object] $Event)

    return "$script:SLLifecycleRoot/$(([string] $Event.timestamp).Substring(0, 7))/sl-event-$(([string] $Event.eventId).Substring(9)).json"
}

function Write-SLLifecycleEvents {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]] $Events,

        [switch] $DryRun
    )

    foreach ($Source in $Events) {
        $Event = New-SLLifecycleEvent $Source
        $RelativePath = Get-SLLifecycleEventPath $Event
        $Path = Resolve-SLContainedPath -Root $Root -RelativePath $RelativePath
        if ([IO.File]::Exists($Path)) {
            $Existing = Read-SLJson -Root $Root -RelativePath $RelativePath
            if ((ConvertTo-SLCanonicalJson $Existing) -cne (ConvertTo-SLCanonicalJson $Event)) {
                Throw-SLContractError -Code 'lifecycle-event-collision' -Message "Immutable SL lifecycle event collision: $RelativePath"
            }
            continue
        }
        if (-not $DryRun) {
            Write-SLImmutableText -Root $Root -RelativePath $RelativePath -Content (
                "$(ConvertTo-Json $Event -Depth 50)`n"
            )
        }
    }
}

function Assert-SLLifecycleEventsWritable {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]] $Events
    )

    foreach ($Source in $Events) {
        $Event = New-SLLifecycleEvent $Source
        $RelativePath = Get-SLLifecycleEventPath $Event
        $Path = Resolve-SLContainedPath -Root $Root -RelativePath $RelativePath
        if (-not [IO.File]::Exists($Path)) {
            continue
        }
        try {
            $Existing = Read-SLJson -Root $Root -RelativePath $RelativePath
            if ((ConvertTo-SLCanonicalJson $Existing) -ceq (ConvertTo-SLCanonicalJson $Event)) {
                continue
            }
        }
        catch {
        }
        Throw-SLContractError -Code 'lifecycle-event-collision' -Message "Immutable SL lifecycle event collision: $RelativePath"
    }
}

function Write-SLIndexes {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [object] $Registry,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]] $Changes,

        [AllowNull()]
        [object[]] $Projections,

        [switch] $DryRun
    )

    $Catalog = Get-SLStateCatalog $Root
    foreach ($Entry in @($Catalog.scopes)) {
        $ScopeKey = Get-SLScopeKey $Entry.scope
        $Artifacts = [System.Collections.Generic.List[object]]::new()
        foreach ($Artifact in @($Registry.artifacts)) {
            if (
                (Get-SLScopeKey (Get-SLProperty $Artifact 'scope' $script:SLDefaultScope)) -cne $ScopeKey -or
                -not $Artifact.path -or
                $Artifact.classification -ceq 'system' -or
                [string] $Artifact.status -cnotin $script:SLActiveStatuses
            ) {
                continue
            }
            $Path = Resolve-SLContainedPath -Root $Root -RelativePath ([string] $Artifact.path)
            if (-not [IO.File]::Exists($Path)) {
                continue
            }
            if ($Artifact.classification -ceq 'promoted' -and $Artifact.status -ceq 'active') {
                if (-not (Test-SLPromotionEvaluationCurrent -Root $Root -Artifact $Artifact)) {
                    continue
                }
            }
            $EntryArtifact = [ordered] @{
                id = $Artifact.id
                path = $Artifact.path
                artifactType = $Artifact.artifactType
                status = $Artifact.status
            }
            if (Test-SLProperty $Artifact 'trigger') {
                $EntryArtifact['trigger'] = Sort-SLOrdinal @($Artifact.trigger)
            }
            $EntryArtifact['relatedTo'] = Sort-SLOrdinal @($Artifact.relatedTo)
            if (Test-SLProperty $Artifact 'dependsOn') {
                $EntryArtifact['dependsOn'] = Sort-SLOrdinal @($Artifact.dependsOn)
            }
            $Artifacts.Add([pscustomobject] $EntryArtifact)
        }
        [object[]] $IndexArtifacts = @($Artifacts | Sort-Object -Stable -Property @{ Expression = { [string] $_.id } })
        $Index = [pscustomobject] @{
            schemaVersion = 2
            scope = $Entry.scope
            artifacts = $IndexArtifacts
        }
        Write-SLJson -Root $Root -RelativePath ([string] $Entry.indexPath) -Value $Index -Changes $Changes -DryRun:$DryRun
        [object[]] $ScopeProjections = @(
            if ($null -ne $Projections) {
                $Projections | Where-Object { (Get-SLScopeKey $_.scope) -ceq $ScopeKey } |
                Sort-Object -Stable -Property @(
                    @{ Expression = { [string] $_.artifactId } },
                    @{ Expression = { [string] $_.artifactVersion } }
                )
            }
        )
        $CurrentVersions = [ordered] @{}
        foreach ($Artifact in @($Registry.artifacts | Sort-Object -Stable -Property @{ Expression = { [string] $_.id } })) {
            if (
                (Get-SLScopeKey (Get-SLProperty $Artifact 'scope' $script:SLDefaultScope)) -ceq $ScopeKey -and
                (Test-SLProperty $Artifact 'usageProjection')
            ) {
                $CurrentVersions[[string] $Artifact.id] = [string] $Artifact.usageProjection.artifactVersion
            }
        }
        $Projection = [pscustomobject] @{
            schemaVersion = 1
            scope = $Entry.scope
            currentArtifactVersions = [pscustomobject] $CurrentVersions
            projections = [object[]] $ScopeProjections
        }
        $ProjectionPath = Resolve-SLContainedPath -Root $Root -RelativePath ([string] $Entry.projectionPath)
        if (
            $ScopeProjections.Count -eq 0 -and
            $CurrentVersions.Count -eq 0 -and
            -not [IO.File]::Exists($ProjectionPath)
        ) {
            continue
        }
        Write-SLJson -Root $Root -RelativePath ([string] $Entry.projectionPath) -Value $Projection -Changes $Changes -DryRun:$DryRun
    }
}
