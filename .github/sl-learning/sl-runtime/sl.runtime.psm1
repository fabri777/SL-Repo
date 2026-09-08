Set-StrictMode -Version Latest

$script:SLRuntimeVersion = '0.6.0'
$script:SLRuntimePayloadFiles = [string[]] @(
    'sl.ps1',
    'sl.runtime.psm1',
    'sl.sh'
)
$script:SLConformanceVectorsJson = @'
{"schemaVersion":1,"conformanceVersion":1,"vectors":[{"id":"canonical-json-orders-object-keys","operation":"canonical-json","input":{"z":1,"a":{"y":true,"x":["é",null]}},"expected":"{\"a\":{\"x\":[\"é\",null],\"y\":true},\"z\":1}"},{"id":"sha256-utf8-text","operation":"sha256","input":"SL runtime\n","expected":"2d8208f859ef6f31845f6910db3cd0fe09ed65b74820e0e1e94bc145e13eb498"},{"id":"normalize-windows-separators-and-dot-segments","operation":"normalize-path","input":"src\\.\\feature\\..\\core\\file.ps1","expected":"src/core/file.ps1"},{"id":"normalize-repository-path","operation":"normalize-path","input":".\\.github\\\\sl-learning\\","expected":".github/sl-learning"},{"id":"reject-parent-escape","operation":"normalize-path","input":"..\\secret","error":"path-escape"},{"id":"reject-windows-absolute-path","operation":"normalize-path","input":"C:\\repo\\file.txt","error":"path-absolute"},{"id":"yaml-simple-scalars","operation":"parse-yaml","input":"name: runtime\nenabled: true\ncount: 7\nnothing: null\n","expected":{"name":"runtime","enabled":true,"count":7,"nothing":null}},{"id":"yaml-block-and-inline-lists","operation":"parse-yaml","input":"trigger:\n  - one\n  - \"two words\"\nrelatedTo: [alpha, beta]\nempty: []\n","expected":{"trigger":["one","two words"],"relatedTo":["alpha","beta"],"empty":[]}},{"id":"yaml-inline-list-quoted-commas-and-single-quote","operation":"parse-yaml","input":"values: ['it''s', \"two,parts\"]\n","expected":{"values":["it's","two,parts"]}},{"id":"yaml-nested-mapping","operation":"parse-yaml","input":"retention:\n  staleAfterDays: 90\nflags:\n  enabled: false\n","expected":{"retention":{"staleAfterDays":90},"flags":{"enabled":false}}},{"id":"yaml-sequence-of-mappings","operation":"parse-yaml","input":"scopes:\n  - id: SL-SCOPE-ROOT\n    includePaths:\n      - \"**\"\n    excludePaths: []\n","expected":{"scopes":[{"id":"SL-SCOPE-ROOT","includePaths":["**"],"excludePaths":[]}]}},{"id":"yaml-rejects-anchors","operation":"parse-yaml","input":"value: &shared item\n","error":"yaml-syntax"},{"id":"frontmatter-normalizes-newlines","operation":"parse-frontmatter","input":"---\r\nid: SL-EXAMPLE\r\ntrigger: [one, two]\r\npinned: false\r\n---\r\n\r\n# Body\r\n","expected":{"frontmatter":{"id":"SL-EXAMPLE","trigger":["one","two"],"pinned":false},"body":"\n# Body\n"}},{"id":"typed-validation-accepts-supported-contract","operation":"validate-value","input":{"value":{"id":"SL-EXAMPLE","hits":2,"trigger":["one"]},"contract":{"type":"object","additionalProperties":false,"required":["id","hits","trigger"],"properties":{"id":{"type":"string","pattern":"^SL-[A-Z-]+$"},"hits":{"type":"integer","minimum":0},"trigger":{"type":"array","minItems":1,"items":{"type":"string","minLength":1}}}}},"expected":true},{"id":"typed-validation-rejects-additional-property","operation":"validate-value","input":{"value":{"id":"SL-EXAMPLE","unexpected":true},"contract":{"type":"object","additionalProperties":false,"required":["id"],"properties":{"id":{"type":"string"}}}},"error":"validation-additional-property"},{"id":"glob-star-does-not-cross-separator","operation":"glob-match","input":{"pattern":"src/*.ts","path":"src/core/file.ts"},"expected":false},{"id":"glob-globstar-matches-root-file","operation":"glob-match","input":{"pattern":"**/*.ts","path":"file.ts"},"expected":true},{"id":"glob-globstar-matches-descendant","operation":"glob-match","input":{"pattern":"src/**","path":"src/core/file.ts"},"expected":true},{"id":"glob-trailing-globstar-matches-directory","operation":"glob-match","input":{"pattern":"src/**","path":"src"},"expected":true},{"id":"glob-question-matches-one-character","operation":"glob-match","input":{"pattern":"src/file?.ps1","path":"src/file1.ps1"},"expected":true},{"id":"glob-rejects-braces","operation":"glob-match","input":{"pattern":"src/*.{ts,tsx}","path":"src/file.ts"},"error":"glob-syntax"},{"id":"capture-slug-normalizes-unicode","operation":"slugify","input":"Crème brûlée / retries","expected":"creme-brulee-retries"},{"id":"state-shard-is-deterministic","operation":"scope-shard","input":{"id":"SL-SCOPE-ROOT","path":"."},"expected":"sl-sl-scope-root-47ab59b49ac7"},{"id":"usage-event-id-is-idempotent","operation":"usage-event-id","input":"vote:α","expected":"SL-USE-781272EDCBF75D918511DC4768864784"},{"id":"lifecycle-event-id-is-content-addressed","operation":"lifecycle-event-id","input":{"schemaVersion":1,"timestamp":"2026-09-05T12:00:00.000Z","artifactId":"SL-EXAMPLE","action":"captured","toStatus":"raw","toPath":".github/sl-learning/sl-lessons/example.md"},"expected":"SL-EVENT-8C2D3EC6FCA3D375A26241D1408336BB"},{"id":"retention-deadline-uses-utc-days","operation":"retention-deadline","input":{"timestamp":"2026-09-05T12:00:00.000Z","days":30},"expected":"2026-10-05T12:00:00.000Z"},{"id":"promotion-owner-set-is-order-independent","operation":"promotion-owner-set","input":{"ownerAliases":["@example/root","@example/platform"]},"expected":"SL-OWNERS-4911559F9F528B22"},{"id":"safe-reference-accepts-opaque-run","operation":"safe-reference","input":"run:build-123","expected":true},{"id":"safe-reference-rejects-email","operation":"safe-reference","input":"owner@example.com","expected":false},{"id":"safe-reference-rejects-ip-address","operation":"safe-reference","input":"host:10.0.0.1","expected":false},{"id":"resource-receipt-id-is-idempotent","operation":"resource-receipt-id","input":"resource-e2e","expected":"SL-RESOURCE-E8375CA1A3BCE94D8157565379ADA914"},{"id":"resource-total-tokens-includes-cache-and-reasoning","operation":"resource-total-tokens","input":{"input":100,"output":20,"cacheRead":30,"cacheWrite":4,"reasoning":6},"expected":160},{"id":"resource-cost-add-preserves-decimal-accounting","operation":"resource-cost-add","input":{"left":"0.0125","right":"0.0875"},"expected":"0.1"}]}
'@
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

# ////////////////////////////////////////////////////////////////////////////////
# Generated from SL.Runtime.Core.ps1
# ////////////////////////////////////////////////////////////////////////////////

Set-StrictMode -Version Latest

$script:SLActiveMutationLockPath = $null
$script:SLActiveMutationTransaction = $null

function Throw-SLContractError {
    param(
        [Parameter(Mandatory)]
        [string] $Code,

        [Parameter(Mandatory)]
        [string] $Message
    )

    $Exception = [System.InvalidOperationException]::new($Message)
    $Exception.Data['SLCode'] = $Code
    throw $Exception
}

function ConvertTo-SLJsonString {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Value
    )

    $Builder = [System.Text.StringBuilder]::new()
    [void] $Builder.Append('"')
    foreach ($Character in $Value.ToCharArray()) {
        $CodePoint = [int] $Character
        if ($CodePoint -eq 8) {
            [void] $Builder.Append('\b')
        }
        elseif ($CodePoint -eq 9) {
            [void] $Builder.Append('\t')
        }
        elseif ($CodePoint -eq 10) {
            [void] $Builder.Append('\n')
        }
        elseif ($CodePoint -eq 12) {
            [void] $Builder.Append('\f')
        }
        elseif ($CodePoint -eq 13) {
            [void] $Builder.Append('\r')
        }
        elseif ($CodePoint -eq 34) {
            [void] $Builder.Append('\"')
        }
        elseif ($CodePoint -eq 92) {
            [void] $Builder.Append('\\')
        }
        elseif ($CodePoint -lt 32) {
            [void] $Builder.Append(('\u{0:x4}' -f $CodePoint))
        }
        else {
            [void] $Builder.Append($Character)
        }
    }
    [void] $Builder.Append('"')
    return $Builder.ToString()
}

function ConvertTo-SLCanonicalJson {
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [object] $Value
    )

    if ($null -eq $Value) {
        return 'null'
    }
    if ($Value -is [string]) {
        return ConvertTo-SLJsonString -Value $Value
    }
    if ($Value -is [bool]) {
        return $(if ($Value) { 'true' } else { 'false' })
    }
    if (
        $Value -is [byte] -or
        $Value -is [sbyte] -or
        $Value -is [int16] -or
        $Value -is [uint16] -or
        $Value -is [int32] -or
        $Value -is [uint32] -or
        $Value -is [int64]
    ) {
        if ([decimal] $Value -lt -9007199254740991 -or [decimal] $Value -gt 9007199254740991) {
            Throw-SLContractError -Code 'canonical-json-number' -Message 'Canonical JSON supports safe integers only.'
        }
        return ([System.Convert]::ToString($Value, [Globalization.CultureInfo]::InvariantCulture))
    }
    if ($Value -is [uint64]) {
        if ($Value -gt 9007199254740991) {
            Throw-SLContractError -Code 'canonical-json-number' -Message 'Canonical JSON supports safe integers only.'
        }
        return ([System.Convert]::ToString($Value, [Globalization.CultureInfo]::InvariantCulture))
    }
    if (
        $Value -is [double] -or
        $Value -is [single] -or
        $Value -is [decimal]
    ) {
        $DecimalValue = [decimal] $Value
        if (
            $DecimalValue -ne [decimal]::Truncate($DecimalValue) -or
            $DecimalValue -lt -9007199254740991 -or
            $DecimalValue -gt 9007199254740991
        ) {
            Throw-SLContractError -Code 'canonical-json-number' -Message 'Canonical JSON supports safe integers only.'
        }
        return $DecimalValue.ToString('0', [Globalization.CultureInfo]::InvariantCulture)
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $Names = [string[]] @($Value.Keys | ForEach-Object { [string] $_ })
        [Array]::Sort($Names, [StringComparer]::Ordinal)
        $Parts = foreach ($Name in $Names) {
            "$(ConvertTo-SLJsonString -Value $Name):$(ConvertTo-SLCanonicalJson -Value $Value[$Name])"
        }
        return "{$($Parts -join ',')}"
    }
    if (
        $Value -is [System.Collections.IEnumerable] -and
        $Value -isnot [string]
    ) {
        $Parts = foreach ($Item in $Value) {
            ConvertTo-SLCanonicalJson -Value $Item
        }
        return "[$($Parts -join ',')]"
    }
    if ($Value -is [pscustomobject]) {
        $Names = [string[]] @($Value.PSObject.Properties | ForEach-Object { $_.Name })
        [Array]::Sort($Names, [StringComparer]::Ordinal)
        $Parts = foreach ($Name in $Names) {
            "$(ConvertTo-SLJsonString -Value $Name):$(ConvertTo-SLCanonicalJson -Value $Value.$Name)"
        }
        return "{$($Parts -join ',')}"
    }
    Throw-SLContractError -Code 'canonical-json-type' -Message "Canonical JSON does not support $($Value.GetType().FullName)."
}

function ConvertTo-SLReportJson {
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [object] $Value
    )

    if ($null -eq $Value) {
        return 'null'
    }
    if ($Value -is [string]) {
        return ConvertTo-SLJsonString -Value $Value
    }
    if ($Value -is [bool]) {
        return $(if ($Value) { 'true' } else { 'false' })
    }
    if (
        $Value -is [byte] -or
        $Value -is [sbyte] -or
        $Value -is [int16] -or
        $Value -is [uint16] -or
        $Value -is [int32] -or
        $Value -is [uint32] -or
        $Value -is [int64] -or
        $Value -is [uint64]
    ) {
        if ([decimal] $Value -lt -9007199254740991 -or [decimal] $Value -gt 9007199254740991) {
            Throw-SLContractError -Code 'report-json-number' -Message 'Report JSON supports safe integers and finite fractional numbers only.'
        }
        return ([System.Convert]::ToString($Value, [Globalization.CultureInfo]::InvariantCulture))
    }
    if ($Value -is [double] -or $Value -is [single]) {
        $Number = [double] $Value
        if ([double]::IsNaN($Number) -or [double]::IsInfinity($Number)) {
            Throw-SLContractError -Code 'report-json-number' -Message 'Report JSON supports safe integers and finite fractional numbers only.'
        }
        if ($Number -eq 0) {
            return '0'
        }
        return $Number.ToString('R', [Globalization.CultureInfo]::InvariantCulture)
    }
    if ($Value -is [decimal]) {
        return ([decimal] $Value).ToString('G29', [Globalization.CultureInfo]::InvariantCulture)
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $Names = [string[]] @($Value.Keys | ForEach-Object { [string] $_ })
        [Array]::Sort($Names, [StringComparer]::Ordinal)
        $Parts = foreach ($Name in $Names) {
            "$(ConvertTo-SLJsonString -Value $Name):$(ConvertTo-SLReportJson -Value $Value[$Name])"
        }
        return "{$($Parts -join ',')}"
    }
    if (
        $Value -is [System.Collections.IEnumerable] -and
        $Value -isnot [string]
    ) {
        $Parts = foreach ($Item in $Value) {
            ConvertTo-SLReportJson -Value $Item
        }
        return "[$($Parts -join ',')]"
    }
    if ($Value -is [pscustomobject]) {
        $Names = [string[]] @($Value.PSObject.Properties | ForEach-Object { $_.Name })
        [Array]::Sort($Names, [StringComparer]::Ordinal)
        $Parts = foreach ($Name in $Names) {
            "$(ConvertTo-SLJsonString -Value $Name):$(ConvertTo-SLReportJson -Value $Value.$Name)"
        }
        return "{$($Parts -join ',')}"
    }
    Throw-SLContractError -Code 'report-json-type' -Message "Report JSON does not support $($Value.GetType().FullName)."
}

function Get-SLSha256 {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Value
    )

    $Bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()
}

function Get-SLFileSha256 {
    param(
        [Parameter(Mandatory)]
        [string] $Path
    )

    $Content = [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false, $true))
    $Normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    return Get-SLSha256 -Value $Normalized
}

function ConvertTo-SLNormalizedPath {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Path
    )

    if ($Path.Contains([char] 0)) {
        Throw-SLContractError -Code 'path-nul' -Message 'Paths cannot contain NUL.'
    }
    $Normalized = $Path.Trim().Replace('\', '/')
    while ($Normalized.Contains('//')) {
        $Normalized = $Normalized.Replace('//', '/')
    }
    if ($Normalized -match '^[A-Za-z]:' -or $Normalized.StartsWith('/')) {
        Throw-SLContractError -Code 'path-absolute' -Message "Path must be repository-relative: $Path"
    }
    while ($Normalized.StartsWith('./')) {
        $Normalized = $Normalized.Substring(2)
    }
    $Normalized = $Normalized.TrimEnd('/')
    $Segments = [System.Collections.Generic.List[string]]::new()
    foreach ($Segment in $Normalized.Split('/')) {
        if ([string]::IsNullOrEmpty($Segment) -or $Segment -ceq '.') {
            continue
        }
        if ($Segment -ceq '..') {
            if ($Segments.Count -eq 0) {
                Throw-SLContractError -Code 'path-escape' -Message "Path escapes repository root: $Path"
            }
            $Segments.RemoveAt($Segments.Count - 1)
            continue
        }
        $Segments.Add($Segment)
    }
    if ($Segments.Count -eq 0) {
        return '.'
    }
    return $Segments -join '/'
}

function Get-SLRepositoryRoot {
    param(
        [Parameter(Mandatory)]
        [string] $StartPath
    )

    $Current = [IO.Path]::GetFullPath($StartPath)
    if ([IO.File]::Exists($Current)) {
        $Current = [IO.Path]::GetDirectoryName($Current)
    }
    while ($null -ne $Current) {
        if (
            [IO.Directory]::Exists([IO.Path]::Combine($Current, '.git')) -or
            [IO.File]::Exists([IO.Path]::Combine($Current, '.git'))
        ) {
            return $Current
        }
        $Parent = [IO.Directory]::GetParent($Current)
        if ($null -eq $Parent) {
            break
        }
        $Current = $Parent.FullName
    }
    Throw-SLContractError -Code 'repository-root' -Message "Unable to find a Git repository from $StartPath."
}

function Resolve-SLContainedPath {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [string] $RelativePath
    )

    $Normalized = ConvertTo-SLNormalizedPath -Path $RelativePath
    if ($Normalized -ceq '.') {
        return [IO.Path]::GetFullPath($Root)
    }
    $RootFull = [IO.Path]::GetFullPath($Root)
    $Target = [IO.Path]::GetFullPath(
        [IO.Path]::Combine($RootFull, $Normalized.Replace('/', [IO.Path]::DirectorySeparatorChar))
    )
    $Comparison = if ($IsWindows) {
        [StringComparison]::OrdinalIgnoreCase
    }
    else {
        [StringComparison]::Ordinal
    }
    $RootPrefix = $RootFull.TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ) + [IO.Path]::DirectorySeparatorChar
    if (
        -not $Target.Equals($RootFull, $Comparison) -and
        -not $Target.StartsWith($RootPrefix, $Comparison)
    ) {
        Throw-SLContractError -Code 'path-escape' -Message "Path escapes repository root: $RelativePath"
    }

    $Ancestor = $Target
    while (-not [IO.File]::Exists($Ancestor) -and -not [IO.Directory]::Exists($Ancestor)) {
        $Parent = [IO.Directory]::GetParent($Ancestor)
        if ($null -eq $Parent) {
            Throw-SLContractError -Code 'path-ancestor' -Message "Unable to resolve an existing ancestor for $RelativePath."
        }
        $Ancestor = $Parent.FullName
    }
    $RealRoot = (Resolve-Path -LiteralPath $RootFull -ErrorAction Stop).Path
    $RealAncestor = (Resolve-Path -LiteralPath $Ancestor -ErrorAction Stop).Path
    $RealRootPrefix = $RealRoot.TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ) + [IO.Path]::DirectorySeparatorChar
    if (
        -not $RealAncestor.Equals($RealRoot, $Comparison) -and
        -not $RealAncestor.StartsWith($RealRootPrefix, $Comparison)
    ) {
        Throw-SLContractError -Code 'path-symlink' -Message "Path resolves outside repository root: $RelativePath"
    }
    return $Target
}

function Read-SLSafeText {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [string] $RelativePath
    )

    $Path = Resolve-SLContainedPath -Root $Root -RelativePath $RelativePath
    if (-not [IO.File]::Exists($Path)) {
        Throw-SLContractError -Code 'file-missing' -Message "File does not exist: $RelativePath"
    }
    try {
        return [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false, $true))
    }
    catch {
        Throw-SLContractError -Code 'file-read' -Message "Unable to read UTF-8 file $RelativePath`: $($_.Exception.Message)"
    }
}

function Write-SLSafeText {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [string] $RelativePath,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Content,

        [switch] $DryRun
    )

    Update-SLMutationLease
    $Path = Resolve-SLContainedPath -Root $Root -RelativePath $RelativePath
    $Normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    if ($DryRun) {
        return [pscustomobject] @{ action = 'planned'; path = (ConvertTo-SLNormalizedPath $RelativePath) }
    }
    Add-SLMutationSnapshot -Root $Root -RelativePath $RelativePath
    $Directory = [IO.Path]::GetDirectoryName($Path)
    [IO.Directory]::CreateDirectory($Directory) | Out-Null
    $TemporaryPath = "$Path.SL-tmp-$([Guid]::NewGuid().ToString('N'))"
    try {
        [IO.File]::WriteAllText($TemporaryPath, $Normalized, [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($TemporaryPath, $Path, $true)
        Complete-SLMutationStep
    }
    finally {
        if ([IO.File]::Exists($TemporaryPath)) {
            [IO.File]::Delete($TemporaryPath)
        }
    }
    return [pscustomobject] @{ action = 'written'; path = (ConvertTo-SLNormalizedPath $RelativePath) }
}

function Write-SLImmutableText {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [string] $RelativePath,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Content
    )

    Update-SLMutationLease
    $NormalizedPath = ConvertTo-SLNormalizedPath $RelativePath
    $Path = Resolve-SLContainedPath -Root $Root -RelativePath $NormalizedPath
    if ([IO.File]::Exists($Path) -or [IO.Directory]::Exists($Path)) {
        Throw-SLContractError -Code 'file-clobber' -Message "Cannot overwrite existing immutable file: $NormalizedPath"
    }
    Add-SLMutationSnapshot -Root $Root -RelativePath $NormalizedPath
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
    $TemporaryPath = "$Path.SL-tmp-$([Guid]::NewGuid().ToString('N'))"
    try {
        [IO.File]::WriteAllText(
            $TemporaryPath,
            $Content.Replace("`r`n", "`n").Replace("`r", "`n"),
            [Text.UTF8Encoding]::new($false)
        )
        [IO.File]::Move($TemporaryPath, $Path, $false)
        Complete-SLMutationStep
    }
    finally {
        if ([IO.File]::Exists($TemporaryPath)) {
            [IO.File]::Delete($TemporaryPath)
        }
    }
}

function Test-SLProperty {
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [object] $Value,

        [Parameter(Mandatory)]
        [string] $Name
    )

    if ($null -eq $Value) {
        return $false
    }
    if ($Value -is [System.Collections.IDictionary]) {
        return $Value.Contains($Name)
    }
    return $null -ne $Value.PSObject.Properties[$Name]
}

function Test-SLMap {
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [object] $Value
    )

    return (
        $null -ne $Value -and
        (
            $Value -is [System.Collections.IDictionary] -or
            $Value.GetType().FullName -ceq 'System.Management.Automation.PSCustomObject'
        )
    )
}

function Get-SLProperty {
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [object] $Value,

        [Parameter(Mandatory)]
        [string] $Name,

        [AllowNull()]
        [object] $Default = $null
    )

    if ($null -eq $Value) {
        return ,$Default
    }
    if ($Value -is [System.Collections.IDictionary]) {
        [object] $Result = $(if ($Value.Contains($Name)) { $Value[$Name] } else { $Default })
        return ,$Result
    }
    $Property = $Value.PSObject.Properties[$Name]
    [object] $Result = $(if ($null -ne $Property) { $Property.Value } else { $Default })
    return ,$Result
}

function Set-SLProperty {
    param(
        [Parameter(Mandatory)]
        [object] $Value,

        [Parameter(Mandatory)]
        [string] $Name,

        [Parameter(Mandatory)]
        [AllowNull()]
        [object] $PropertyValue
    )

    if ($Value -is [System.Collections.IDictionary]) {
        $Value[$Name] = $PropertyValue
        return
    }
    if ($null -ne $Value.PSObject.Properties[$Name]) {
        $Value.$Name = $PropertyValue
    }
    else {
        $Value | Add-Member -NotePropertyName $Name -NotePropertyValue $PropertyValue
    }
}

function Remove-SLProperty {
    param(
        [Parameter(Mandatory)]
        [object] $Value,

        [Parameter(Mandatory)]
        [string] $Name
    )

    if ($Value -is [System.Collections.IDictionary]) {
        [void] $Value.Remove($Name)
        return
    }
    if ($null -ne $Value.PSObject.Properties[$Name]) {
        $Value.PSObject.Properties.Remove($Name)
    }
}

function Copy-SLValue {
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [object] $Value
    )

    if ($null -eq $Value) {
        return $null
    }
    return ConvertFrom-Json -InputObject (ConvertTo-Json -InputObject $Value -Depth 100 -Compress) -Depth 100
}

function Read-SLJson {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [string] $RelativePath
    )

    $Content = Read-SLSafeText -Root $Root -RelativePath $RelativePath
    try {
        if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) {
            return ConvertFrom-Json -InputObject $Content -Depth 100 -DateKind String
        }
        return ConvertFrom-Json -InputObject $Content -Depth 100
    }
    catch {
        Throw-SLContractError -Code 'json-parse' -Message "Invalid JSON in $RelativePath`: $($_.Exception.Message)"
    }
}

function Write-SLJson {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [string] $RelativePath,

        [Parameter(Mandatory)]
        [AllowNull()]
        [object] $Value,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]] $Changes,

        [switch] $DryRun
    )

    $NormalizedPath = ConvertTo-SLNormalizedPath -Path $RelativePath
    $Path = Resolve-SLContainedPath -Root $Root -RelativePath $NormalizedPath
    $Content = "$(ConvertTo-Json -InputObject $Value -Depth 100)`n".Replace("`r`n", "`n")
    if ([IO.File]::Exists($Path)) {
        $Existing = [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false, $true))
        if ($Existing.Replace("`r`n", "`n").Replace("`r", "`n") -ceq $Content) {
            $Changes.Add([pscustomobject] @{
                action = 'skip'
                path = $NormalizedPath
                detail = 'already current'
            })
            return
        }
    }
    $Changes.Add([pscustomobject] @{
        action = $(if ([IO.File]::Exists($Path)) { 'update' } else { 'create' })
        path = $NormalizedPath
        detail = $(if ($DryRun) { 'planned' } else { 'written' })
    })
    if (-not $DryRun) {
        [void] (Write-SLSafeText -Root $Root -RelativePath $NormalizedPath -Content $Content)
    }
}

function Write-SLTextChange {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [string] $RelativePath,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Content,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]] $Changes,

        [switch] $DryRun
    )

    $NormalizedPath = ConvertTo-SLNormalizedPath -Path $RelativePath
    $Path = Resolve-SLContainedPath -Root $Root -RelativePath $NormalizedPath
    $NormalizedContent = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    if ([IO.File]::Exists($Path)) {
        $Existing = [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false, $true))
        if ($Existing.Replace("`r`n", "`n").Replace("`r", "`n") -ceq $NormalizedContent) {
            $Changes.Add([pscustomobject] @{
                action = 'skip'
                path = $NormalizedPath
                detail = 'already current'
            })
            return
        }
    }
    $Changes.Add([pscustomobject] @{
        action = $(if ([IO.File]::Exists($Path)) { 'update' } else { 'create' })
        path = $NormalizedPath
        detail = $(if ($DryRun) { 'planned' } else { 'written' })
    })
    if (-not $DryRun) {
        [void] (Write-SLSafeText -Root $Root -RelativePath $NormalizedPath -Content $NormalizedContent)
    }
}

function Move-SLContainedFile {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [string] $SourceRelativePath,

        [Parameter(Mandatory)]
        [string] $TargetRelativePath,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]] $Changes,

        [switch] $DryRun
    )

    Update-SLMutationLease
    $SourceRelativePath = ConvertTo-SLNormalizedPath $SourceRelativePath
    $TargetRelativePath = ConvertTo-SLNormalizedPath $TargetRelativePath
    $Source = Resolve-SLContainedPath -Root $Root -RelativePath $SourceRelativePath
    $Target = Resolve-SLContainedPath -Root $Root -RelativePath $TargetRelativePath
    if (-not [IO.File]::Exists($Source)) {
        Throw-SLContractError -Code 'file-missing' -Message "Cannot move missing artifact: $SourceRelativePath"
    }
    if ([IO.File]::Exists($Target) -or [IO.Directory]::Exists($Target)) {
        Throw-SLContractError -Code 'file-clobber' -Message "Cannot overwrite existing artifact: $TargetRelativePath"
    }
    $Changes.Add([pscustomobject] @{
        action = 'move'
        path = $SourceRelativePath
        detail = "$SourceRelativePath -> $TargetRelativePath"
    })
    if (-not $DryRun) {
        Add-SLMutationSnapshot -Root $Root -RelativePath $SourceRelativePath
        Add-SLMutationSnapshot -Root $Root -RelativePath $TargetRelativePath
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Target)) | Out-Null
        [IO.File]::Move($Source, $Target)
        Complete-SLMutationStep
    }
}

function Remove-SLContainedFile {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [string] $RelativePath,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]] $Changes,

        [switch] $DryRun
    )

    Update-SLMutationLease
    $RelativePath = ConvertTo-SLNormalizedPath $RelativePath
    $Path = Resolve-SLContainedPath -Root $Root -RelativePath $RelativePath
    if (-not [IO.File]::Exists($Path)) {
        Throw-SLContractError -Code 'file-missing' -Message "Cannot delete missing artifact: $RelativePath"
    }
    $Changes.Add([pscustomobject] @{
        action = 'delete'
        path = $RelativePath
        detail = 'retention elapsed'
    })
    if (-not $DryRun) {
        Add-SLMutationSnapshot -Root $Root -RelativePath $RelativePath
        [IO.File]::Delete($Path)
        Complete-SLMutationStep
    }
}

function Get-SLNormalizedTimestamp {
    param(
        [AllowNull()]
        [string] $Value
    )

    if (-not $Value) {
        return [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
    }
    [DateTimeOffset] $Parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse(
        $Value,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal,
        [ref] $Parsed
    )) {
        Throw-SLContractError -Code 'timestamp' -Message "Invalid timestamp: $Value"
    }
    return $Parsed.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
}

function ConvertTo-SLSlug {
    param(
        [Parameter(Mandatory)]
        [string] $Value,

        [int] $MaximumLength = 50
    )

    $Normalized = $Value.Normalize([Text.NormalizationForm]::FormKD)
    $Builder = [Text.StringBuilder]::new()
    foreach ($Character in $Normalized.ToCharArray()) {
        $Category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($Character)
        if ($Category -eq [Globalization.UnicodeCategory]::NonSpacingMark) {
            continue
        }
        if ([char]::IsLetterOrDigit($Character) -or $Character -eq '_' -or $Character -eq '-' -or [char]::IsWhiteSpace($Character)) {
            [void] $Builder.Append($Character)
        }
    }
    $Slug = $Builder.ToString().Trim().ToLowerInvariant()
    $Slug = [Regex]::Replace($Slug, '[\s_]+', '-')
    $Slug = [Regex]::Replace($Slug, '-+', '-').Trim('-')
    if ($Slug.Length -gt $MaximumLength) {
        $Slug = $Slug.Substring(0, $MaximumLength).TrimEnd('-')
    }
    return $Slug
}

function Test-SLSensitiveText {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Value
    )

    $UserProfilePattern =
        '(?:[A-Za-z]:\\' + 'Users\\[^\\\r\n]+|/Users' +
        '/[^/\r\n]+|/home' + '/[^/\r\n]+)'
    return (
        $Value -match '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----' -or
        $Value -match '\bgh[oprsu]_[A-Za-z0-9_]{20,}\b' -or
        $Value -match '\b(?:password|api[_-]?key|token)\s*[:=]\s*["'']?[^\s"'']{12,}' -or
        $Value -match '\b(?:AccountKey|SharedAccessKey|Password)=[^;\s]{8,}' -or
        $Value -match $UserProfilePattern
    )
}

function Test-SLOpaqueReference {
    param(
        [Parameter(Mandatory)]
        [string] $Value
    )

    if (
        $Value -cnotmatch '^(?:[A-Za-z][A-Za-z0-9+.-]*:[^\s@\\]{1,240}|[A-Za-z0-9][A-Za-z0-9._/#:-]{0,255})$' -or
        $Value -match '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' -or
        $Value -match '(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?:$|[^0-9])|(?:^|[^A-F0-9])(?:[A-F0-9]{0,4}:){2,7}[A-F0-9]{0,4}(?:$|[^A-F0-9])' -or
        (Test-SLSensitiveText $Value)
    ) {
        return $false
    }
    return $true
}

function Add-SLMutationSnapshot {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [string] $RelativePath
    )

    if ($null -eq $script:SLActiveMutationTransaction) {
        return
    }
    $NormalizedPath = ConvertTo-SLNormalizedPath $RelativePath
    if ($script:SLActiveMutationTransaction.snapshots.ContainsKey($NormalizedPath)) {
        return
    }
    $Path = Resolve-SLContainedPath -Root $Root -RelativePath $NormalizedPath
    $Exists = [IO.File]::Exists($Path)
    $script:SLActiveMutationTransaction.snapshots[$NormalizedPath] = [pscustomobject] @{
        path = $NormalizedPath
        exists = $Exists
        bytes = $(if ($Exists) { [IO.File]::ReadAllBytes($Path) } else { $null })
    }
    $script:SLActiveMutationTransaction.order.Add($NormalizedPath)
}

function Complete-SLMutationStep {
    if ($null -eq $script:SLActiveMutationTransaction) {
        return
    }
    $script:SLActiveMutationTransaction.mutationCount += 1
    $FailureAfterText = [Environment]::GetEnvironmentVariable('SL_TEST_INJECT_IO_FAILURE_AFTER')
    [int] $FailureAfter = 0
    if (
        $FailureAfterText -and
        [int]::TryParse($FailureAfterText, [ref] $FailureAfter) -and
        $FailureAfter -gt 0 -and
        $script:SLActiveMutationTransaction.mutationCount -eq $FailureAfter
    ) {
        Throw-SLContractError -Code 'file-write-injected' -Message "Injected I/O failure after mutation $FailureAfter."
    }
}

function Restore-SLMutationTransaction {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [object] $Transaction
    )

    for ($Index = $Transaction.order.Count - 1; $Index -ge 0; $Index -= 1) {
        $RelativePath = [string] $Transaction.order[$Index]
        $Snapshot = $Transaction.snapshots[$RelativePath]
        $Path = Resolve-SLContainedPath -Root $Root -RelativePath $RelativePath
        if (-not $Snapshot.exists) {
            if ([IO.File]::Exists($Path)) {
                [IO.File]::Delete($Path)
            }
            continue
        }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
        $TemporaryPath = "$Path.SL-rollback-$([Guid]::NewGuid().ToString('N'))"
        try {
            [IO.File]::WriteAllBytes($TemporaryPath, [byte[]] $Snapshot.bytes)
            [IO.File]::Move($TemporaryPath, $Path, $true)
        }
        finally {
            if ([IO.File]::Exists($TemporaryPath)) {
                [IO.File]::Delete($TemporaryPath)
            }
        }
    }
}

function Invoke-SLWithMutationTransaction {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [scriptblock] $Operation,

        [switch] $DryRun
    )

    if ($DryRun -or $null -ne $script:SLActiveMutationTransaction) {
        return & $Operation
    }
    $Transaction = [pscustomobject] @{
        snapshots = @{}
        order = [System.Collections.Generic.List[string]]::new()
        mutationCount = 0
    }
    $script:SLActiveMutationTransaction = $Transaction
    try {
        return & $Operation
    }
    catch {
        $OriginalError = $_
        $script:SLActiveMutationTransaction = $null
        try {
            Restore-SLMutationTransaction -Root $Root -Transaction $Transaction
        }
        catch {
            Throw-SLContractError -Code 'file-rollback' -Message "SL mutation rollback failed after '$($OriginalError.Exception.Message)': $($_.Exception.Message)"
        }
        throw $OriginalError
    }
    finally {
        $script:SLActiveMutationTransaction = $null
    }
}

function Invoke-SLWithMutationLock {
    param(
        [Parameter(Mandatory)]
        [string] $Root,

        [Parameter(Mandatory)]
        [scriptblock] $Operation,

        [switch] $DryRun,

        [int] $StaleMilliseconds = 120000,

        [int] $TimeoutMilliseconds = 120000
    )

    if ($DryRun) {
        return & $Operation
    }
    $RelativeLock = '.github/sl-learning/.sl-repository-mutation.lock'
    $LockPath = Resolve-SLContainedPath -Root $Root -RelativePath $RelativeLock
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($LockPath)) | Out-Null
    $LeaseId = [Guid]::NewGuid().ToString()
    $Deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    $Acquired = $false
    while ([DateTime]::UtcNow -lt $Deadline) {
        try {
            New-Item -ItemType Directory -Path $LockPath -ErrorAction Stop | Out-Null
            $OwnerPath = [IO.Path]::Combine($LockPath, 'SL-owner.json')
            $Owner = [ordered] @{
                schemaVersion = 1
                token = $LeaseId
                pid = $PID
                hostname = [Environment]::MachineName
                acquiredAt = Get-SLNormalizedTimestamp
            }
            [IO.File]::WriteAllText(
                $OwnerPath,
                "$(ConvertTo-Json $Owner -Depth 10)`n",
                [Text.UTF8Encoding]::new($false)
            )
            $Acquired = $true
            break
        }
        catch {
            if ([IO.Directory]::Exists($LockPath)) {
                $Info = [IO.DirectoryInfo]::new($LockPath)
                $Expired = ([DateTime]::UtcNow - $Info.LastWriteTimeUtc).TotalMilliseconds -ge $StaleMilliseconds
                $OwnerPath = [IO.Path]::Combine($LockPath, 'SL-owner.json')
                $Live = $false
                try {
                    $Owner = ConvertFrom-Json ([IO.File]::ReadAllText($OwnerPath)) -Depth 10
                    if ($Owner.hostname -ceq [Environment]::MachineName) {
                        try {
                            $Process = [Diagnostics.Process]::GetProcessById([int] $Owner.pid)
                            $Live = -not $Process.HasExited
                        }
                        catch {
                            $Live = $false
                        }
                    }
                }
                catch {
                    $Live = $false
                }
                if ($Expired -and -not $Live) {
                    $StalePath = "$LockPath.SL-stale-$([Guid]::NewGuid().ToString('N'))"
                    try {
                        [IO.Directory]::Move($LockPath, $StalePath)
                        [IO.Directory]::Delete($StalePath, $true)
                        continue
                    }
                    catch {
                    }
                }
            }
            Start-Sleep -Milliseconds 25
        }
    }
    if (-not $Acquired) {
        Throw-SLContractError -Code 'mutation-lock-timeout' -Message "Timed out waiting for SL repository mutation lock: $RelativeLock"
    }
    $PreviousActiveLockPath = $script:SLActiveMutationLockPath
    $script:SLActiveMutationLockPath = $LockPath
    try {
        return Invoke-SLWithMutationTransaction -Root $Root -Operation $Operation
    }
    finally {
        $script:SLActiveMutationLockPath = $PreviousActiveLockPath
        $OwnerPath = [IO.Path]::Combine($LockPath, 'SL-owner.json')
        try {
            $Owner = ConvertFrom-Json ([IO.File]::ReadAllText($OwnerPath)) -Depth 10
            if ($Owner.token -ceq $LeaseId) {
                [IO.Directory]::Delete($LockPath, $true)
            }
        }
        catch {
        }
    }
}

function Update-SLMutationLease {
    if ($script:SLActiveMutationLockPath -and [IO.Directory]::Exists($script:SLActiveMutationLockPath)) {
        try {
            [IO.Directory]::SetLastWriteTimeUtc($script:SLActiveMutationLockPath, [DateTime]::UtcNow)
        }
        catch {
        }
    }
}

# ////////////////////////////////////////////////////////////////////////////////
# Generated from SL.Runtime.Syntax.ps1
# ////////////////////////////////////////////////////////////////////////////////

Set-StrictMode -Version Latest

function ConvertFrom-SLDoubleQuotedValue {
    param([string] $Value, [int] $LineNumber)

    if ($Value -cnotmatch '^"(?:[^"\\\r\n]|\\["\\nrt])*"$') {
        Throw-SLContractError -Code 'yaml-string' -Message "Unsupported double-quoted string at line $LineNumber."
    }
    return ConvertFrom-Json -InputObject $Value
}

function ConvertFrom-SLSingleQuotedValue {
    param([string] $Value, [int] $LineNumber)

    if ($Value -cnotmatch "^'(?:[^'\r\n]|'')*'$") {
        Throw-SLContractError -Code 'yaml-string' -Message "Unsupported single-quoted string at line $LineNumber."
    }
    return $Value.Substring(1, $Value.Length - 2).Replace("''", "'")
}

function Split-SLInlineList {
    param([string] $Value, [int] $LineNumber)

    $Result = [System.Collections.Generic.List[string]]::new()
    $Builder = [Text.StringBuilder]::new()
    [char] $Quote = [char] 0
    $Escaped = $false
    for ($Index = 0; $Index -lt $Value.Length; $Index += 1) {
        $Character = $Value[$Index]
        if ($Quote -ceq '"') {
            [void] $Builder.Append($Character)
            if ($Escaped) {
                $Escaped = $false
            }
            elseif ($Character -ceq '\') {
                $Escaped = $true
            }
            elseif ($Character -ceq $Quote) {
                $Quote = [char] 0
            }
            continue
        }
        if ($Quote -ceq "'") {
            [void] $Builder.Append($Character)
            if ($Character -ceq $Quote) {
                if ($Index + 1 -lt $Value.Length -and $Value[$Index + 1] -ceq "'") {
                    [void] $Builder.Append($Value[$Index + 1])
                    $Index += 1
                }
                else {
                    $Quote = [char] 0
                }
            }
            continue
        }
        if ($Character -ceq "'" -or $Character -ceq '"') {
            $Quote = $Character
            [void] $Builder.Append($Character)
        }
        elseif ($Character -ceq ',') {
            $Item = $Builder.ToString().Trim()
            if (-not $Item) {
                Throw-SLContractError -Code 'yaml-list' -Message "Empty inline-list item at line $LineNumber."
            }
            $Result.Add($Item)
            [void] $Builder.Clear()
        }
        else {
            [void] $Builder.Append($Character)
        }
    }
    if ($Quote -ne [char] 0) {
        Throw-SLContractError -Code 'yaml-string' -Message "Unterminated quoted string at line $LineNumber."
    }
    $Final = $Builder.ToString().Trim()
    if ($Final) {
        $Result.Add($Final)
    }
    elseif ($Value.Trim()) {
        Throw-SLContractError -Code 'yaml-list' -Message "Empty inline-list item at line $LineNumber."
    }
    return $Result.ToArray()
}

function ConvertFrom-SLYamlScalar {
    param([string] $Value, [int] $LineNumber)

    $Trimmed = $Value.Trim()
    if (-not $Trimmed) {
        Throw-SLContractError -Code 'yaml-value' -Message "Missing YAML value at line $LineNumber."
    }
    if ($Trimmed -ceq '[]') {
        return ,@()
    }
    if ($Trimmed -ceq '{}') {
        return @{}
    }
    if ($Trimmed.StartsWith('[') -or $Trimmed.EndsWith(']')) {
        if (-not ($Trimmed.StartsWith('[') -and $Trimmed.EndsWith(']'))) {
            Throw-SLContractError -Code 'yaml-list' -Message "Malformed inline list at line $LineNumber."
        }
        $Inner = $Trimmed.Substring(1, $Trimmed.Length - 2).Trim()
        if (-not $Inner) {
            return ,@()
        }
        $Items = @(
            Split-SLInlineList -Value $Inner -LineNumber $LineNumber |
                ForEach-Object { ConvertFrom-SLYamlScalar -Value $_ -LineNumber $LineNumber }
        )
        return ,$Items
    }
    if ($Trimmed.StartsWith('"')) {
        return ConvertFrom-SLDoubleQuotedValue -Value $Trimmed -LineNumber $LineNumber
    }
    if ($Trimmed.StartsWith("'")) {
        return ConvertFrom-SLSingleQuotedValue -Value $Trimmed -LineNumber $LineNumber
    }
    if ($Trimmed -ceq 'true') {
        return $true
    }
    if ($Trimmed -ceq 'false') {
        return $false
    }
    if ($Trimmed -ceq 'null') {
        return $null
    }
    if ($Trimmed -cmatch '^-?(?:0|[1-9][0-9]*)$') {
        [long] $Parsed = 0
        if (-not [long]::TryParse(
            $Trimmed,
            [Globalization.NumberStyles]::AllowLeadingSign,
            [Globalization.CultureInfo]::InvariantCulture,
            [ref] $Parsed
        ) -or $Parsed -lt -9007199254740991 -or $Parsed -gt 9007199254740991) {
            Throw-SLContractError -Code 'yaml-integer' -Message "YAML integer is outside the safe range at line $LineNumber."
        }
        return $Parsed
    }
    if (
        $Trimmed -cmatch '^[&*!>|%@`]' -or
        $Trimmed -match '^(?:yes|no|on|off|~)$' -or
        $Trimmed -match ':\s' -or
        $Trimmed -match '\s#'
    ) {
        Throw-SLContractError -Code 'yaml-syntax' -Message "Unsupported YAML syntax at line $LineNumber."
    }
    return $Trimmed
}

function ConvertFrom-SLYamlKey {
    param([string] $Content, [int] $LineNumber)

    if ($Content -cnotmatch '^([A-Za-z][A-Za-z0-9_-]*):(.*)$') {
        Throw-SLContractError -Code 'yaml-key' -Message "Invalid YAML mapping key at line $LineNumber."
    }
    $Suffix = $Matches[2]
    if ($Suffix -and -not $Suffix.StartsWith(' ')) {
        Throw-SLContractError -Code 'yaml-spacing' -Message "A YAML mapping colon must be followed by a space at line $LineNumber."
    }
    return [pscustomobject] @{
        Key = $Matches[1]
        ValueText = $Suffix.TrimStart()
    }
}

function ConvertFrom-SLYamlMapping {
    param([object[]] $Lines, [int] $StartIndex, [int] $Indent)

    $Value = @{}
    $Index = $StartIndex
    while ($Index -lt $Lines.Count) {
        $Line = $Lines[$Index]
        if ($Line.Indent -lt $Indent) {
            break
        }
        if ($Line.Indent -gt $Indent) {
            Throw-SLContractError -Code 'yaml-indent' -Message "Unexpected indentation at line $($Line.LineNumber)."
        }
        if ($Line.Content.StartsWith('-')) {
            break
        }
        $Entry = ConvertFrom-SLYamlKey -Content $Line.Content -LineNumber $Line.LineNumber
        if ($Value.ContainsKey($Entry.Key)) {
            Throw-SLContractError -Code 'yaml-duplicate-key' -Message "Duplicate YAML key '$($Entry.Key)' at line $($Line.LineNumber)."
        }
        $Index += 1
        if ($Entry.ValueText) {
            $Value[$Entry.Key] = ConvertFrom-SLYamlScalar -Value $Entry.ValueText -LineNumber $Line.LineNumber
            continue
        }
        if ($Index -ge $Lines.Count -or $Lines[$Index].Indent -le $Indent) {
            Throw-SLContractError -Code 'yaml-value' -Message "Missing nested YAML value for '$($Entry.Key)' at line $($Line.LineNumber)."
        }
        if ($Lines[$Index].Indent -ne ($Indent + 2)) {
            Throw-SLContractError -Code 'yaml-indent' -Message "Nested YAML must use two-space indentation at line $($Lines[$Index].LineNumber)."
        }
        $Nested = ConvertFrom-SLYamlBlock -Lines $Lines -StartIndex $Index -Indent ($Indent + 2)
        $Value[$Entry.Key] = $Nested.Value
        $Index = $Nested.NextIndex
    }
    return [pscustomobject] @{ Value = $Value; NextIndex = $Index }
}

function ConvertFrom-SLYamlSequence {
    param([object[]] $Lines, [int] $StartIndex, [int] $Indent)

    $Value = [System.Collections.Generic.List[object]]::new()
    $Index = $StartIndex
    while ($Index -lt $Lines.Count) {
        $Line = $Lines[$Index]
        if ($Line.Indent -lt $Indent) {
            break
        }
        if ($Line.Indent -ne $Indent -or -not $Line.Content.StartsWith('-')) {
            break
        }
        if ($Line.Content -cne '-' -and -not $Line.Content.StartsWith('- ')) {
            Throw-SLContractError -Code 'yaml-sequence' -Message "A YAML sequence marker must be followed by a space at line $($Line.LineNumber)."
        }
        $ItemText = $Line.Content.Substring(1).TrimStart()
        $Index += 1
        if (-not $ItemText) {
            if ($Index -ge $Lines.Count -or $Lines[$Index].Indent -ne ($Indent + 2)) {
                Throw-SLContractError -Code 'yaml-indent' -Message "Nested YAML sequence values must use two-space indentation at line $($Line.LineNumber)."
            }
            $Nested = ConvertFrom-SLYamlBlock -Lines $Lines -StartIndex $Index -Indent ($Indent + 2)
            $Value.Add($Nested.Value)
            $Index = $Nested.NextIndex
            continue
        }
        if ($ItemText -cmatch '^[A-Za-z][A-Za-z0-9_-]*:') {
            $First = ConvertFrom-SLYamlKey -Content $ItemText -LineNumber $Line.LineNumber
            $ObjectValue = @{}
            if ($First.ValueText) {
                $ObjectValue[$First.Key] = ConvertFrom-SLYamlScalar -Value $First.ValueText -LineNumber $Line.LineNumber
            }
            else {
                if ($Index -ge $Lines.Count -or $Lines[$Index].Indent -ne ($Indent + 2)) {
                    Throw-SLContractError -Code 'yaml-indent' -Message "Nested YAML values must use two-space indentation at line $($Line.LineNumber)."
                }
                $Nested = ConvertFrom-SLYamlBlock -Lines $Lines -StartIndex $Index -Indent ($Indent + 2)
                $ObjectValue[$First.Key] = $Nested.Value
                $Index = $Nested.NextIndex
            }
            if (
                $Index -lt $Lines.Count -and
                $Lines[$Index].Indent -eq ($Indent + 2) -and
                -not $Lines[$Index].Content.StartsWith('-')
            ) {
                $Continuation = ConvertFrom-SLYamlMapping -Lines $Lines -StartIndex $Index -Indent ($Indent + 2)
                foreach ($Key in $Continuation.Value.Keys) {
                    if ($ObjectValue.ContainsKey($Key)) {
                        Throw-SLContractError -Code 'yaml-duplicate-key' -Message "Duplicate YAML key '$Key' at line $($Lines[$Index].LineNumber)."
                    }
                    $ObjectValue[$Key] = $Continuation.Value[$Key]
                }
                $Index = $Continuation.NextIndex
            }
            $Value.Add($ObjectValue)
            continue
        }
        $Value.Add((ConvertFrom-SLYamlScalar -Value $ItemText -LineNumber $Line.LineNumber))
    }
    return [pscustomobject] @{ Value = $Value.ToArray(); NextIndex = $Index }
}

function ConvertFrom-SLYamlBlock {
    param([object[]] $Lines, [int] $StartIndex, [int] $Indent)

    if ($StartIndex -ge $Lines.Count -or $Lines[$StartIndex].Indent -ne $Indent) {
        $LineNumber = if ($StartIndex -lt $Lines.Count) { $Lines[$StartIndex].LineNumber } else { 1 }
        Throw-SLContractError -Code 'yaml-indent' -Message "Invalid YAML indentation at line $LineNumber."
    }
    if ($Lines[$StartIndex].Content.StartsWith('-')) {
        return ConvertFrom-SLYamlSequence -Lines $Lines -StartIndex $StartIndex -Indent $Indent
    }
    return ConvertFrom-SLYamlMapping -Lines $Lines -StartIndex $StartIndex -Indent $Indent
}

function ConvertFrom-SLYaml {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Content
    )

    $Normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    if ($Normalized.Contains("`t")) {
        Throw-SLContractError -Code 'yaml-tab' -Message 'YAML tabs are not supported.'
    }
    $Lines = @()
    $SourceLines = $Normalized.Split("`n")
    for ($Index = 0; $Index -lt $SourceLines.Count; $Index += 1) {
        $Source = $SourceLines[$Index]
        $Trimmed = $Source.TrimStart()
        if (-not $Trimmed -or $Trimmed.StartsWith('#')) {
            continue
        }
        $Indent = $Source.Length - $Trimmed.Length
        if (($Indent % 2) -ne 0) {
            Throw-SLContractError -Code 'yaml-indent' -Message "YAML indentation must use multiples of two spaces at line $($Index + 1)."
        }
        if ($Trimmed -ceq '---' -or $Trimmed -ceq '...') {
            Throw-SLContractError -Code 'yaml-document' -Message "YAML document markers are not supported at line $($Index + 1)."
        }
        $Lines += [pscustomobject] @{
            Indent = $Indent
            Content = $Trimmed
            LineNumber = $Index + 1
        }
    }
    if ($Lines.Count -eq 0) {
        Throw-SLContractError -Code 'yaml-empty' -Message 'YAML content cannot be empty.'
    }
    if ($Lines[0].Indent -ne 0) {
        Throw-SLContractError -Code 'yaml-indent' -Message 'The YAML document must start at indentation zero.'
    }
    $Parsed = ConvertFrom-SLYamlBlock -Lines $Lines -StartIndex 0 -Indent 0
    if ($Parsed.NextIndex -ne $Lines.Count) {
        Throw-SLContractError -Code 'yaml-structure' -Message "Unexpected YAML content at line $($Lines[$Parsed.NextIndex].LineNumber)."
    }
    if ($Parsed.Value -isnot [System.Collections.IDictionary]) {
        Throw-SLContractError -Code 'yaml-root' -Message 'The YAML document root must be a mapping.'
    }
    return $Parsed.Value
}

function ConvertFrom-SLFrontmatter {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Content
    )

    $Normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    $Lines = $Normalized.Split("`n")
    if ($Lines.Count -eq 0 -or $Lines[0] -cne '---') {
        Throw-SLContractError -Code 'frontmatter-open' -Message 'Markdown must start with a YAML frontmatter delimiter.'
    }
    $ClosingIndex = -1
    for ($Index = 1; $Index -lt $Lines.Count; $Index += 1) {
        if ($Lines[$Index] -ceq '---') {
            $ClosingIndex = $Index
            break
        }
    }
    if ($ClosingIndex -lt 0) {
        Throw-SLContractError -Code 'frontmatter-close' -Message 'Markdown frontmatter is missing its closing delimiter.'
    }
    $Yaml = $Lines[1..($ClosingIndex - 1)] -join "`n"
    $Body = if ($ClosingIndex + 1 -lt $Lines.Count) {
        $Lines[($ClosingIndex + 1)..($Lines.Count - 1)] -join "`n"
    }
    else {
        ''
    }
    return [pscustomobject] @{
        frontmatter = ConvertFrom-SLYaml -Content $Yaml
        body = $Body
    }
}

function Assert-SLTypedValue {
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [object] $Value,

        [Parameter(Mandatory)]
        [pscustomobject] $Contract,

        [string] $Path = '$'
    )

    $SupportedKeywords = @(
        'additionalProperties',
        'const',
        'enum',
        'items',
        'minItems',
        'minLength',
        'minimum',
        'pattern',
        'properties',
        'required',
        'type'
    )
    foreach ($Keyword in $Contract.PSObject.Properties.Name) {
        if ($Keyword -cnotin $SupportedKeywords) {
            Throw-SLContractError -Code 'validation-keyword' -Message "Unsupported validation keyword '$Keyword' at $Path."
        }
    }
    if ($Contract.type -isnot [string]) {
        Throw-SLContractError -Code 'validation-contract' -Message "Validation contract type is required at $Path."
    }
    $ValidType = switch -CaseSensitive ($Contract.type) {
        'object' {
            Test-SLMap $Value
            break
        }
        'array' {
            $Value -is [array]
            break
        }
        'string' {
            $Value -is [string]
            break
        }
        'integer' {
            $IsInteger = $Value -is [byte] -or
            $Value -is [sbyte] -or
            $Value -is [int16] -or
            $Value -is [uint16] -or
            $Value -is [int32] -or
            $Value -is [uint32] -or
            $Value -is [int64]
            $IsInteger -and
            [decimal] $Value -ge -9007199254740991 -and
            [decimal] $Value -le 9007199254740991
            break
        }
        'boolean' {
            $Value -is [bool]
            break
        }
        'null' {
            $null -eq $Value
            break
        }
        default {
            Throw-SLContractError -Code 'validation-type-contract' -Message "Unsupported validation type '$($Contract.type)' at $Path."
        }
    }
    if (-not $ValidType) {
        Throw-SLContractError -Code 'validation-type' -Message "Expected $($Contract.type) at $Path."
    }
    if ($null -ne $Contract.PSObject.Properties['const']) {
        if (
            (ConvertTo-SLCanonicalJson -Value $Value) -cne
            (ConvertTo-SLCanonicalJson -Value $Contract.const)
        ) {
            Throw-SLContractError -Code 'validation-const' -Message "Value does not match const at $Path."
        }
    }
    if ($null -ne $Contract.PSObject.Properties['enum']) {
        if ($Contract.enum -isnot [array]) {
            Throw-SLContractError -Code 'validation-contract' -Message "enum must be an array at $Path."
        }
        $ActualJson = ConvertTo-SLCanonicalJson -Value $Value
        $Matched = @(
            $Contract.enum |
                Where-Object { (ConvertTo-SLCanonicalJson -Value $_) -ceq $ActualJson }
        ).Count -gt 0
        if (-not $Matched) {
            Throw-SLContractError -Code 'validation-enum' -Message "Value is not in enum at $Path."
        }
    }
    if ($Value -is [string]) {
        if ($null -ne $Contract.PSObject.Properties['minLength']) {
            if ($Contract.minLength -isnot [long] -or $Contract.minLength -lt 0) {
                Throw-SLContractError -Code 'validation-contract' -Message "minLength must be a non-negative integer at $Path."
            }
            if ($Value.Length -lt $Contract.minLength) {
                Throw-SLContractError -Code 'validation-min-length' -Message "String is shorter than minLength at $Path."
            }
        }
        if ($null -ne $Contract.PSObject.Properties['pattern']) {
            if ($Contract.pattern -isnot [string]) {
                Throw-SLContractError -Code 'validation-contract' -Message "pattern must be a string at $Path."
            }
            if (
                $Contract.pattern -match '\(\?' -or
                $Contract.pattern -match '\\(?:[1-9k]|[pP]\{)'
            ) {
                Throw-SLContractError -Code 'validation-pattern-contract' -Message "pattern uses syntax outside the cross-runtime subset at $Path."
            }
            try {
                $Expression = [Regex]::new(
                    $Contract.pattern,
                    [Text.RegularExpressions.RegexOptions]::CultureInvariant
                )
            }
            catch {
                Throw-SLContractError -Code 'validation-contract' -Message "pattern is invalid at $Path."
            }
            if (-not $Expression.IsMatch($Value)) {
                Throw-SLContractError -Code 'validation-pattern' -Message "String does not match pattern at $Path."
            }
        }
    }
    if (
        $Contract.type -ceq 'integer' -and
        $null -ne $Contract.PSObject.Properties['minimum']
    ) {
        if ($Contract.minimum -isnot [long]) {
            Throw-SLContractError -Code 'validation-contract' -Message "minimum must be a safe integer at $Path."
        }
        if ([long] $Value -lt $Contract.minimum) {
            Throw-SLContractError -Code 'validation-minimum' -Message "Integer is below minimum at $Path."
        }
    }
    if ($Value -is [array]) {
        if ($null -ne $Contract.PSObject.Properties['minItems']) {
            if ($Contract.minItems -isnot [long] -or $Contract.minItems -lt 0) {
                Throw-SLContractError -Code 'validation-contract' -Message "minItems must be a non-negative integer at $Path."
            }
            if ($Value.Count -lt $Contract.minItems) {
                Throw-SLContractError -Code 'validation-min-items' -Message "Array is shorter than minItems at $Path."
            }
        }
        if ($null -ne $Contract.PSObject.Properties['items']) {
            for ($Index = 0; $Index -lt $Value.Count; $Index += 1) {
                Assert-SLTypedValue -Value $Value[$Index] -Contract $Contract.items -Path "$Path[$Index]"
            }
        }
    }
    if ($Contract.type -ceq 'object') {
        $Names = if ($Value -is [System.Collections.IDictionary]) {
            @($Value.Keys | ForEach-Object { [string] $_ })
        }
        else {
            @($Value.PSObject.Properties.Name)
        }
        $Required = if ($null -ne $Contract.PSObject.Properties['required']) {
            @($Contract.required)
        }
        else {
            @()
        }
        if (@($Required | Where-Object { $_ -isnot [string] }).Count -gt 0) {
            Throw-SLContractError -Code 'validation-contract' -Message "required must be an array of strings at $Path."
        }
        foreach ($Name in $Required) {
            if ($Name -cnotin $Names) {
                Throw-SLContractError -Code 'validation-required' -Message "Missing required property '$Name' at $Path."
            }
        }
        $Properties = if ($null -ne $Contract.PSObject.Properties['properties']) {
            $Contract.properties
        }
        else {
            [pscustomobject] @{}
        }
        if (-not (Test-SLMap $Properties)) {
            Throw-SLContractError -Code 'validation-contract' -Message "properties must be an object at $Path."
        }
        foreach ($Property in $Properties.PSObject.Properties) {
            if ($Property.Name -cin $Names) {
                $Child = $null
                if ($Value -is [System.Collections.IDictionary]) {
                    $Child = $Value[$Property.Name]
                }
                else {
                    $Child = $Value.($Property.Name)
                }
                Assert-SLTypedValue -Value $Child -Contract $Property.Value -Path "$Path.$($Property.Name)"
            }
        }
        if ($Contract.additionalProperties -eq $false) {
            foreach ($Name in $Names) {
                if ($Name -cnotin $Properties.PSObject.Properties.Name) {
                    Throw-SLContractError -Code 'validation-additional-property' -Message "Unexpected property '$Name' at $Path."
                }
            }
        }
        elseif (
            $null -ne $Contract.PSObject.Properties['additionalProperties'] -and
            $Contract.additionalProperties -ne $true
        ) {
            Throw-SLContractError -Code 'validation-contract' -Message "additionalProperties must be a boolean at $Path."
        }
    }
}

function ConvertTo-SLNormalizedGlob {
    param([Parameter(Mandatory)][string] $Pattern)

    $Normalized = $Pattern.Trim().Replace('\', '/')
    while ($Normalized.Contains('//')) {
        $Normalized = $Normalized.Replace('//', '/')
    }
    if (
        -not $Normalized -or
        $Normalized.StartsWith('/') -or
        $Normalized -match '^[A-Za-z]:' -or
        $Normalized.StartsWith('!') -or
        $Normalized.StartsWith('#') -or
        $Normalized.EndsWith('/') -or
        @($Normalized.Split('/') | Where-Object { $_ -ceq '..' -or $_ -ceq '.' }).Count -gt 0
    ) {
        Throw-SLContractError -Code 'glob-path' -Message "Glob must be a normalized repository-relative pattern: $Pattern"
    }
    if ($Normalized -match '[\[\]{}()|+@]' -or $Normalized.Contains('***')) {
        Throw-SLContractError -Code 'glob-syntax' -Message "Unsupported glob syntax: $Pattern"
    }
    return $Normalized
}

function Test-SLGlob {
    param(
        [Parameter(Mandatory)]
        [string] $Pattern,

        [Parameter(Mandatory)]
        [string] $Path
    )

    $NormalizedPattern = ConvertTo-SLNormalizedGlob -Pattern $Pattern
    $NormalizedPath = ConvertTo-SLNormalizedPath -Path $Path
    if ($NormalizedPath -ceq '.') {
        return $NormalizedPattern -ceq '**'
    }
    $Expression = '^'
    $Index = 0
    $TrailingGlobstar = $NormalizedPattern.EndsWith('/**')
    $ScanLimit = if ($TrailingGlobstar) {
        $NormalizedPattern.Length - 3
    }
    else {
        $NormalizedPattern.Length
    }
    while ($Index -lt $ScanLimit) {
        if (
            $Index + 3 -le $ScanLimit -and
            $NormalizedPattern.Substring($Index, 3) -ceq '**/'
        ) {
            $Expression += '(?:.*/)?'
            $Index += 3
            continue
        }
        $Character = $NormalizedPattern[$Index]
        if ($Character -ceq '*') {
            if (
                $Index + 1 -lt $ScanLimit -and
                $NormalizedPattern[$Index + 1] -ceq '*'
            ) {
                $Expression += '.*'
                $Index += 2
            }
            else {
                $Expression += '[^/]*'
                $Index += 1
            }
        }
        elseif ($Character -ceq '?') {
            $Expression += '[^/]'
            $Index += 1
        }
        else {
            $Expression += [Regex]::Escape([string] $Character)
            $Index += 1
        }
    }
    if ($TrailingGlobstar) {
        $Expression += '(?:/.*)?'
    }
    $Expression += '$'
    return [Regex]::IsMatch($NormalizedPath, $Expression, [Text.RegularExpressions.RegexOptions]::CultureInvariant)
}

function ConvertTo-SLYamlScalar {
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [object] $Value
    )

    if ($null -eq $Value) {
        return 'null'
    }
    if ($Value -is [bool]) {
        return $(if ($Value) { 'true' } else { 'false' })
    }
    if (
        $Value -is [byte] -or
        $Value -is [sbyte] -or
        $Value -is [int16] -or
        $Value -is [uint16] -or
        $Value -is [int32] -or
        $Value -is [uint32] -or
        $Value -is [int64] -or
        $Value -is [uint64]
    ) {
        return [Convert]::ToString($Value, [Globalization.CultureInfo]::InvariantCulture)
    }
    if ($Value -is [string]) {
        return ConvertTo-SLJsonString -Value $Value
    }
    Throw-SLContractError -Code 'yaml-write-type' -Message "Unsupported YAML scalar type $($Value.GetType().FullName)."
}

function ConvertTo-SLYaml {
    param(
        [Parameter(Mandatory)]
        [object] $Value,

        [int] $Indent = 0
    )

    $Prefix = ' ' * $Indent
    $Lines = [System.Collections.Generic.List[string]]::new()
    if (Test-SLMap $Value) {
        $Names = if ($Value -is [System.Collections.IDictionary]) {
            [string[]] @($Value.Keys | ForEach-Object { [string] $_ })
        }
        else {
            [string[]] @($Value.PSObject.Properties.Name)
        }
        [Array]::Sort($Names, [StringComparer]::Ordinal)
        foreach ($Name in $Names) {
            if ($Name -cnotmatch '^[A-Za-z][A-Za-z0-9_-]*$') {
                Throw-SLContractError -Code 'yaml-write-key' -Message "Invalid YAML mapping key: $Name"
            }
            [object] $Child = $null
            if ($Value -is [System.Collections.IDictionary]) {
                $Child = [object] $Value[$Name]
            }
            else {
                $Child = [object] $Value.$Name
            }
            if (
                (Test-SLMap $Child) -or
                (
                    $Child -is [System.Collections.IEnumerable] -and
                    $Child -isnot [string]
                )
            ) {
                $Array = @($Child)
                if ($Array.Count -eq 0) {
                    $Lines.Add("$Prefix$Name`: []")
                }
                else {
                    $Lines.Add("$Prefix$Name`:")
                    $Nested = ConvertTo-SLYaml -Value $Child -Indent ($Indent + 2)
                    foreach ($Line in $Nested.Split("`n")) {
                        if ($Line.Length -gt 0) {
                            $Lines.Add($Line)
                        }
                    }
                }
            }
            else {
                $Lines.Add("$Prefix$Name`: $(ConvertTo-SLYamlScalar -Value $Child)")
            }
        }
        return $Lines -join "`n"
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        foreach ($Child in @($Value)) {
            if (Test-SLMap $Child) {
                $Nested = ConvertTo-SLYaml -Value $Child -Indent ($Indent + 2)
                $NestedLines = $Nested.Split("`n")
                if ($NestedLines.Count -eq 0) {
                    $Lines.Add("$Prefix- {}")
                    continue
                }
                $First = $NestedLines[0].Substring($Indent + 2)
                $Lines.Add("$Prefix- $First")
                foreach ($Line in $NestedLines[1..($NestedLines.Count - 1)]) {
                    $Lines.Add($Line)
                }
            }
            else {
                $Lines.Add("$Prefix- $(ConvertTo-SLYamlScalar -Value $Child)")
            }
        }
        return $Lines -join "`n"
    }
    return "$Prefix$(ConvertTo-SLYamlScalar -Value $Value)"
}

function ConvertTo-SLFrontmatterText {
    param(
        [Parameter(Mandatory)]
        [object] $Frontmatter,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Body
    )

    $NormalizedBody = $Body.Replace("`r`n", "`n").Replace("`r", "`n")
    return "---`n$(ConvertTo-SLYaml -Value $Frontmatter)`n---`n$NormalizedBody".TrimEnd("`n") + "`n"
}

# ////////////////////////////////////////////////////////////////////////////////
# Generated from SL.Runtime.State.ps1
# ////////////////////////////////////////////////////////////////////////////////

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

# ////////////////////////////////////////////////////////////////////////////////
# Generated from SL.Runtime.Artifacts.ps1
# ////////////////////////////////////////////////////////////////////////////////

Set-StrictMode -Version Latest

$script:SLMutableFrontmatterFields = @(
    'id',
    'schemaVersion',
    'managedBy',
    'status',
    'previousStatus',
    'pinned',
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
        $Artifact.managedBy -cne 'sl' -or
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
            (Get-SLProperty $Markdown.frontmatter 'managedBy') -cne 'sl' -or
            (Get-SLProperty $Markdown.frontmatter 'status') -cne $Artifact.status -or
            [bool] (Get-SLProperty $Markdown.frontmatter 'pinned' $false) -ne [bool] $Artifact.pinned
        ) {
            Throw-SLContractError -Code 'artifact-ownership' -Message $ErrorMessage
        }
        $Name = [IO.Path]::GetFileName(([string] $Artifact.path).Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (
            ($Artifact.artifactType -ceq 'lesson' -and (
                $Artifact.classification -cne 'evidence' -or
                -not $Name.StartsWith('sl-') -or
                -not $Name.EndsWith('.md') -or
                (Get-SLProperty $Markdown.frontmatter 'kind') -cnotin @('win', 'pitfall', 'mixed')
            )) -or
            ($Artifact.artifactType -ceq 'instruction' -and (
                $Artifact.classification -cne 'promoted' -or
                -not $Name.StartsWith('sl-') -or
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
        $Path = "$script:SLLessonsRoot/$($Date.Substring(0, 7))/sl-$Date-$Slug.md"
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
            managedBy = 'sl'
            date = $Date
            kind = $Kind
            scope = $LessonScope
            status = 'raw'
            trigger = $CleanTriggers.ToArray()
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
            managedBy = 'sl'
            status = 'raw'
            createdAt = $Timestamp
            lastVerifiedAt = $Timestamp
            pinned = $false
            relatedTo = @()
            trigger = $CleanTriggers.ToArray()
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
    return "$($ScopeEntry.usageEventsPath)/$ArtifactShard/$(([string] $Event.timestamp).Substring(0, 7))/sl-usage-$(([string] $Event.eventId).Substring(7)).json"
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
                $Relative -match '^\.github/sl-learning/sl-scopes/[^/]+/sl-usage-events/'
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
        $Event.eventType -cne 'usage' -or
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
        Write-SLImmutableText -Root $Root -RelativePath $RelativePath -Content (
            "$(ConvertTo-Json $Event -Depth 100)`n"
        )
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

# ////////////////////////////////////////////////////////////////////////////////
# Generated from SL.Runtime.Resource.ps1
# ////////////////////////////////////////////////////////////////////////////////

Set-StrictMode -Version Latest

function Test-SLResourceSensitiveString {
    param([Parameter(Mandatory)][AllowEmptyString()][string] $Value)

    if (
        (Test-SLSensitiveText $Value) -or
        $Value -match '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' -or
        $Value -match '(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?:$|[^0-9])'
    ) {
        return $true
    }
    foreach ($Match in [Regex]::Matches($Value, '(?<![A-Za-z0-9])(?:[A-Fa-f0-9]{0,4}:){2,7}[A-Fa-f0-9:]{0,4}(?![A-Za-z0-9])')) {
        [Net.IPAddress] $Address = $null
        if ([Net.IPAddress]::TryParse($Match.Value, [ref] $Address) -and $Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6) {
            return $true
        }
    }
    return $false
}

function Assert-SLResourceNoSensitiveStrings {
    param(
        [Parameter(Mandatory)][AllowNull()][object] $Value,
        [string] $Path = 'resource input'
    )

    if ($null -eq $Value) {
        return
    }
    if ($Value -is [string]) {
        if (Test-SLResourceSensitiveString $Value) {
            Throw-SLContractError -Code 'resource-privacy' -Message "$Path must not contain secrets, PII, or user paths."
        }
        return
    }
    if ($Value -is [System.Collections.IDictionary]) {
        foreach ($Key in $Value.Keys) {
            Assert-SLResourceNoSensitiveStrings -Value $Value[$Key] -Path "$Path.$Key"
        }
        return
    }
    if ($Value -is [pscustomobject]) {
        foreach ($Property in $Value.PSObject.Properties) {
            Assert-SLResourceNoSensitiveStrings -Value $Property.Value -Path "$Path.$($Property.Name)"
        }
        return
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $Index = 0
        foreach ($Item in $Value) {
            Assert-SLResourceNoSensitiveStrings -Value $Item -Path "$Path[$Index]"
            $Index += 1
        }
    }
}

function Get-SLResourcePropertyNames {
    param([Parameter(Mandatory)][object] $Value)

    if ($Value -is [System.Collections.IDictionary]) {
        return [string[]] @($Value.Keys | ForEach-Object { [string] $_ })
    }
    return [string[]] @($Value.PSObject.Properties.Name)
}

function Assert-SLResourceKnownProperties {
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)][object] $Value,
        [Parameter(Mandatory)][string[]] $Allowed
    )

    $Unexpected = @(Get-SLResourcePropertyNames $Value | Where-Object { $_ -cnotin $Allowed } | Sort-Object -CaseSensitive)
    if ($Unexpected.Count -gt 0) {
        Throw-SLContractError -Code 'resource-input' -Message "$Name contains unsupported fields: $($Unexpected -join ', ')."
    }
}

function Assert-SLResourceRequiredProperties {
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)][object] $Value,
        [Parameter(Mandatory)][string[]] $Required
    )

    $Missing = @($Required | Where-Object { -not (Test-SLProperty $Value $_) })
    if ($Missing.Count -gt 0) {
        Throw-SLContractError -Code 'resource-input' -Message "$Name is missing required fields: $($Missing -join ', ')."
    }
}

function Assert-SLResourceStringProperty {
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)][object] $Value,
        [switch] $Optional
    )

    if ($null -eq $Value -and $Optional) {
        return
    }
    if ($Value -isnot [string]) {
        Throw-SLContractError -Code 'resource-input' -Message "$Name must be a string."
    }
}

function Assert-SLResourceNumberProperty {
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)][object] $Value,
        [switch] $Optional
    )

    if ($null -eq $Value -and $Optional) {
        return
    }
    if (
        $Value -isnot [byte] -and
        $Value -isnot [sbyte] -and
        $Value -isnot [int16] -and
        $Value -isnot [uint16] -and
        $Value -isnot [int32] -and
        $Value -isnot [uint32] -and
        $Value -isnot [int64] -and
        $Value -isnot [uint64] -and
        $Value -isnot [single] -and
        $Value -isnot [double] -and
        $Value -isnot [decimal]
    ) {
        Throw-SLContractError -Code 'resource-input' -Message "$Name must be a number."
    }
}

function Assert-SLResourceInputShape {
    param(
        [Parameter(Mandatory)][object] $Entry,
        [Parameter(Mandatory)][int] $Index
    )

    $Name = "receipts[$Index]"
    if (-not (Test-SLMap $Entry)) {
        Throw-SLContractError -Code 'resource-input' -Message "$Name must be a JSON object."
    }
    $Allowed = @(
        'idempotencyKey','phase','source','quality','provider','modelId','tokens',
        'wallClockDurationMs','modelDurationMs','toolDurationMs','attemptCount',
        'timestamp','evidenceRef','scope','reportedCost','artifactId',
        'artifactContentHash','generationRunId','taskRunId','applicationId','comparison'
    )
    Assert-SLResourceKnownProperties -Name $Name -Value $Entry -Allowed $Allowed
    Assert-SLResourceRequiredProperties -Name $Name -Value $Entry -Required @(
        'idempotencyKey','phase','source','quality','provider','modelId','tokens',
        'wallClockDurationMs','timestamp'
    )
    foreach ($Field in @('idempotencyKey','phase','source','quality','provider','modelId','timestamp')) {
        Assert-SLResourceStringProperty -Name "$Name.$Field" -Value (Get-SLProperty $Entry $Field)
    }
    foreach ($Field in @('artifactId','artifactContentHash','generationRunId','taskRunId','applicationId','evidenceRef')) {
        if (Test-SLProperty $Entry $Field) {
            Assert-SLResourceStringProperty -Name "$Name.$Field" -Value (Get-SLProperty $Entry $Field)
        }
    }
    foreach ($Field in @('wallClockDurationMs','modelDurationMs','toolDurationMs','attemptCount')) {
        if (Test-SLProperty $Entry $Field) {
            Assert-SLResourceNumberProperty -Name "$Name.$Field" -Value (Get-SLProperty $Entry $Field)
        }
    }
    if (-not (Test-SLMap $Entry.tokens)) {
        Throw-SLContractError -Code 'resource-input' -Message "$Name.tokens must be a JSON object."
    }
    Assert-SLResourceKnownProperties -Name "$Name.tokens" -Value $Entry.tokens -Allowed @('input','output','cacheRead','cacheWrite','reasoning')
    Assert-SLResourceRequiredProperties -Name "$Name.tokens" -Value $Entry.tokens -Required @('input','output')
    foreach ($Field in @('input','output','cacheRead','cacheWrite','reasoning')) {
        if (Test-SLProperty $Entry.tokens $Field) {
            Assert-SLResourceNumberProperty -Name "$Name.tokens.$Field" -Value (Get-SLProperty $Entry.tokens $Field)
        }
    }
    if (Test-SLProperty $Entry 'scope') {
        if (-not (Test-SLMap $Entry.scope)) {
            Throw-SLContractError -Code 'resource-input' -Message "$Name.scope must be a JSON object."
        }
        Assert-SLResourceKnownProperties -Name "$Name.scope" -Value $Entry.scope -Allowed @('id','path')
        Assert-SLResourceRequiredProperties -Name "$Name.scope" -Value $Entry.scope -Required @('id','path')
        Assert-SLResourceStringProperty -Name "$Name.scope.id" -Value $Entry.scope.id
        Assert-SLResourceStringProperty -Name "$Name.scope.path" -Value $Entry.scope.path
    }
    if (Test-SLProperty $Entry 'reportedCost') {
        if (-not (Test-SLMap $Entry.reportedCost)) {
            Throw-SLContractError -Code 'resource-input' -Message "$Name.reportedCost must be a JSON object."
        }
        Assert-SLResourceKnownProperties -Name "$Name.reportedCost" -Value $Entry.reportedCost -Allowed @('amount','currency','basis')
        Assert-SLResourceRequiredProperties -Name "$Name.reportedCost" -Value $Entry.reportedCost -Required @('amount','currency','basis')
        foreach ($Field in @('amount','currency','basis')) {
            Assert-SLResourceStringProperty -Name "$Name.reportedCost.$Field" -Value (Get-SLProperty $Entry.reportedCost $Field)
        }
    }
    if (Test-SLProperty $Entry 'comparison') {
        if (-not (Test-SLMap $Entry.comparison)) {
            Throw-SLContractError -Code 'resource-input' -Message "$Name.comparison must be a JSON object."
        }
        Assert-SLResourceKnownProperties -Name "$Name.comparison" -Value $Entry.comparison -Allowed @('comparisonId','scenarioKey','role')
        Assert-SLResourceRequiredProperties -Name "$Name.comparison" -Value $Entry.comparison -Required @('comparisonId','scenarioKey','role')
        foreach ($Field in @('comparisonId','scenarioKey','role')) {
            Assert-SLResourceStringProperty -Name "$Name.comparison.$Field" -Value (Get-SLProperty $Entry.comparison $Field)
        }
    }
    $Phase = [string] $Entry.phase
    if ($Phase -cnotin @('generation','application','baseline')) {
        Throw-SLContractError -Code 'resource-input' -Message "$Name.phase is not supported."
    }
    if ([string] $Entry.source -cnotin @('host','ci','manual')) {
        Throw-SLContractError -Code 'resource-input' -Message "$Name.source is not supported."
    }
    if ([string] $Entry.quality -cnotin @('measured','estimated')) {
        Throw-SLContractError -Code 'resource-input' -Message "$Name.quality is not supported."
    }
    if ($Phase -ceq 'generation') {
        Assert-SLResourceRequiredProperties -Name $Name -Value $Entry -Required @('artifactId','artifactContentHash','generationRunId')
        foreach ($Field in @('taskRunId','applicationId','comparison')) {
            if (Test-SLProperty $Entry $Field) {
                Throw-SLContractError -Code 'resource-input' -Message "$Name generation input cannot contain $Field."
            }
        }
    }
    elseif ($Phase -ceq 'application') {
        Assert-SLResourceRequiredProperties -Name $Name -Value $Entry -Required @('artifactId','artifactContentHash','taskRunId','applicationId')
        if (Test-SLProperty $Entry 'generationRunId') {
            Throw-SLContractError -Code 'resource-input' -Message "$Name application input cannot contain generationRunId."
        }
        if ((Test-SLProperty $Entry 'comparison') -and [string] $Entry.comparison.role -cne 'treatment') {
            Throw-SLContractError -Code 'resource-input' -Message "$Name.comparison.role must be treatment."
        }
    }
    else {
        Assert-SLResourceRequiredProperties -Name $Name -Value $Entry -Required @('taskRunId','comparison')
        foreach ($Field in @('artifactId','artifactContentHash','generationRunId','applicationId')) {
            if (Test-SLProperty $Entry $Field) {
                Throw-SLContractError -Code 'resource-input' -Message "$Name baseline input cannot contain $Field."
            }
        }
        if ([string] $Entry.comparison.role -cne 'baseline') {
            Throw-SLContractError -Code 'resource-input' -Message "$Name.comparison.role must be baseline."
        }
    }
}

function Assert-SLResourceOpaqueId {
    param([Parameter(Mandatory)][string] $Name, [Parameter(Mandatory)][string] $Value)

    if (-not (Test-SLOpaqueReference $Value)) {
        Throw-SLContractError -Code 'resource-privacy' -Message "$Name must not contain secrets, PII, user paths, or unsupported characters."
    }
}

function Assert-SLResourceInteger {
    param([string] $Name, [object] $Value, [switch] $Positive)

    $Integer = $Value -is [byte] -or $Value -is [sbyte] -or
        $Value -is [int16] -or $Value -is [uint16] -or
        $Value -is [int32] -or $Value -is [uint32] -or
        $Value -is [int64]
    if (-not $Integer -or [decimal] $Value -lt $(if ($Positive) { 1 } else { 0 }) -or [decimal] $Value -gt 9007199254740991) {
        Throw-SLContractError -Code 'resource-integer' -Message "$Name must be a $(if ($Positive) { 'positive' } else { 'non-negative' }) safe integer."
    }
}

function Assert-SLResourceReceipt {
    param([Parameter(Mandatory)][object] $Receipt)

    Assert-SLResourceNoSensitiveStrings -Value $Receipt -Path 'resource receipt'
    if (-not (Test-SLMap $Receipt)) {
        Throw-SLContractError -Code 'resource-input' -Message 'Resource receipt must be a JSON object.'
    }
    Assert-SLResourceKnownProperties -Name 'resource receipt' -Value $Receipt -Allowed @(
        'schemaVersion','receiptId','idempotencyKey','phase','source','quality',
        'provider','modelId','tokens','wallClockDurationMs','modelDurationMs',
        'toolDurationMs','attemptCount','timestamp','evidenceRef','scope',
        'reportedCost','artifactId','artifactVersion','artifactContentHash',
        'generationRunId','taskRunId','applicationId','comparison'
    )
    Assert-SLResourceRequiredProperties -Name 'resource receipt' -Value $Receipt -Required @(
        'schemaVersion','receiptId','idempotencyKey','phase','source','quality',
        'provider','modelId','tokens','wallClockDurationMs','timestamp','scope'
    )
    if (-not (Test-SLMap $Receipt.tokens)) {
        Throw-SLContractError -Code 'resource-tokens' -Message 'tokens must be an object.'
    }
    Assert-SLResourceKnownProperties -Name 'resource receipt.tokens' -Value $Receipt.tokens -Allowed @('input','output','cacheRead','cacheWrite','reasoning')
    Assert-SLResourceRequiredProperties -Name 'resource receipt.tokens' -Value $Receipt.tokens -Required @('input','output')
    if (-not (Test-SLMap $Receipt.scope)) {
        Throw-SLContractError -Code 'resource-scope' -Message 'scope must be an object.'
    }
    Assert-SLResourceKnownProperties -Name 'resource receipt.scope' -Value $Receipt.scope -Allowed @('id','path')
    Assert-SLResourceRequiredProperties -Name 'resource receipt.scope' -Value $Receipt.scope -Required @('id','path')
    if (Test-SLProperty $Receipt 'reportedCost') {
        if (-not (Test-SLMap $Receipt.reportedCost)) {
            Throw-SLContractError -Code 'resource-cost' -Message 'reportedCost must be an object.'
        }
        Assert-SLResourceKnownProperties -Name 'resource receipt.reportedCost' -Value $Receipt.reportedCost -Allowed @('amount','currency','basis')
        Assert-SLResourceRequiredProperties -Name 'resource receipt.reportedCost' -Value $Receipt.reportedCost -Required @('amount','currency','basis')
    }
    if (Test-SLProperty $Receipt 'comparison') {
        if (-not (Test-SLMap $Receipt.comparison)) {
            Throw-SLContractError -Code 'resource-comparison' -Message 'comparison must be an object.'
        }
        Assert-SLResourceKnownProperties -Name 'resource receipt.comparison' -Value $Receipt.comparison -Allowed @('comparisonId','scenarioKey','role')
        Assert-SLResourceRequiredProperties -Name 'resource receipt.comparison' -Value $Receipt.comparison -Required @('comparisonId','scenarioKey','role')
    }
    if (
        $Receipt.schemaVersion -ne 1 -or
        [string] $Receipt.receiptId -cnotmatch '^SL-RESOURCE-[A-F0-9]{32}$' -or
        [string] $Receipt.idempotencyKey -cnotmatch '^sha256:[a-f0-9]{64}$' -or
        [string] $Receipt.receiptId -cne "SL-RESOURCE-$(([string] $Receipt.idempotencyKey).Substring(7, 32).ToUpperInvariant())"
    ) {
        Throw-SLContractError -Code 'resource-identity' -Message 'Resource receipt identity does not match its idempotency key.'
    }
    if ([string] $Receipt.phase -cnotin @('generation', 'application', 'baseline')) {
        Throw-SLContractError -Code 'resource-phase' -Message 'phase is not supported.'
    }
    if ([string] $Receipt.source -cnotin @('host', 'ci', 'manual')) {
        Throw-SLContractError -Code 'resource-source' -Message 'source is not supported.'
    }
    if ([string] $Receipt.quality -cnotin @('measured', 'estimated')) {
        Throw-SLContractError -Code 'resource-quality' -Message 'quality is not supported.'
    }
    Assert-SLResourceOpaqueId provider ([string] $Receipt.provider)
    Assert-SLResourceOpaqueId modelId ([string] $Receipt.modelId)
    if (-not (Test-SLMap $Receipt.tokens)) {
        Throw-SLContractError -Code 'resource-tokens' -Message 'tokens must be an object.'
    }
    Assert-SLResourceInteger 'tokens.input' $Receipt.tokens.input
    Assert-SLResourceInteger 'tokens.output' $Receipt.tokens.output
    foreach ($Name in @('cacheRead', 'cacheWrite', 'reasoning')) {
        if (Test-SLProperty $Receipt.tokens $Name) {
            Assert-SLResourceInteger "tokens.$Name" (Get-SLProperty $Receipt.tokens $Name)
        }
    }
    Assert-SLResourceInteger wallClockDurationMs $Receipt.wallClockDurationMs -Positive
    foreach ($Name in @('modelDurationMs', 'toolDurationMs')) {
        if (Test-SLProperty $Receipt $Name) {
            $Value = Get-SLProperty $Receipt $Name
            Assert-SLResourceInteger $Name $Value
            if ([long] $Value -gt [long] $Receipt.wallClockDurationMs) {
                Throw-SLContractError -Code 'resource-duration' -Message "$Name cannot exceed wallClockDurationMs."
            }
        }
    }
    if (Test-SLProperty $Receipt 'attemptCount') {
        Assert-SLResourceInteger attemptCount $Receipt.attemptCount -Positive
    }
    $CanonicalTimestamp = Get-SLNormalizedTimestamp ([string] $Receipt.timestamp)
    if ($CanonicalTimestamp -cne [string] $Receipt.timestamp) {
        Throw-SLContractError -Code 'resource-timestamp' -Message 'timestamp must be a canonical ISO-8601 UTC timestamp.'
    }
    if ((Test-SLProperty $Receipt 'evidenceRef') -and -not (Test-SLOpaqueReference ([string] $Receipt.evidenceRef))) {
        Throw-SLContractError -Code 'resource-evidence' -Message 'evidenceRef must be an opaque, non-PII reference.'
    }
    $Scope = Normalize-SLScope $Receipt.scope
    if ((Get-SLScopeKey $Scope) -cne (Get-SLScopeKey $Receipt.scope)) {
        Throw-SLContractError -Code 'resource-scope' -Message 'scope must be normalized.'
    }
    if (Test-SLProperty $Receipt 'reportedCost') {
        if (
            [string] $Receipt.reportedCost.amount -cnotmatch '^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$' -or
            [string] $Receipt.reportedCost.currency -cnotmatch '^[A-Z]{3}$' -or
            [string] $Receipt.reportedCost.basis -cne 'host-reported'
        ) {
            Throw-SLContractError -Code 'resource-cost' -Message 'reportedCost requires a non-negative 12-place decimal, uppercase currency, and host-reported basis.'
        }
    }
    if ($Receipt.phase -cin @('generation', 'application')) {
        if (
            [string] $Receipt.artifactId -cnotmatch '^SL-[A-Z0-9][A-Z0-9-]*$' -or
            [string] $Receipt.artifactContentHash -cnotmatch '^[a-f0-9]{64}$' -or
            [string] $Receipt.artifactVersion -cne "sha256:$($Receipt.artifactContentHash)"
        ) {
            Throw-SLContractError -Code 'resource-artifact' -Message 'Artifact resource identity is invalid.'
        }
    }
    if ($Receipt.phase -ceq 'generation') {
        Assert-SLResourceRequiredProperties -Name 'resource receipt' -Value $Receipt -Required @('artifactId','artifactVersion','artifactContentHash','generationRunId')
        Assert-SLResourceOpaqueId generationRunId ([string] $Receipt.generationRunId)
        if (
            (Test-SLProperty $Receipt 'taskRunId') -or
            (Test-SLProperty $Receipt 'applicationId') -or
            (Test-SLProperty $Receipt 'comparison')
        ) {
            Throw-SLContractError -Code 'resource-generation-fields' -Message 'Generation receipts cannot contain application or comparison fields.'
        }
    }
    elseif ($Receipt.phase -ceq 'application') {
        Assert-SLResourceRequiredProperties -Name 'resource receipt' -Value $Receipt -Required @('artifactId','artifactVersion','artifactContentHash','taskRunId','applicationId')
        Assert-SLResourceOpaqueId taskRunId ([string] $Receipt.taskRunId)
        Assert-SLResourceOpaqueId applicationId ([string] $Receipt.applicationId)
        if (Test-SLProperty $Receipt 'generationRunId') {
            Throw-SLContractError -Code 'resource-application-fields' -Message 'Application receipts cannot contain generationRunId.'
        }
        if (Test-SLProperty $Receipt 'comparison') {
            Assert-SLResourceOpaqueId comparisonId ([string] $Receipt.comparison.comparisonId)
            Assert-SLResourceOpaqueId scenarioKey ([string] $Receipt.comparison.scenarioKey)
            if ($Receipt.comparison.role -cne 'treatment') {
                Throw-SLContractError -Code 'resource-comparison-role' -Message 'Application comparisons must use treatment role.'
            }
        }
    }
    else {
        Assert-SLResourceRequiredProperties -Name 'resource receipt' -Value $Receipt -Required @('taskRunId','comparison')
        Assert-SLResourceOpaqueId taskRunId ([string] $Receipt.taskRunId)
        if (-not (Test-SLProperty $Receipt 'comparison')) {
            Throw-SLContractError -Code 'resource-baseline-fields' -Message 'Baseline receipts require comparison identity.'
        }
        Assert-SLResourceOpaqueId comparisonId ([string] $Receipt.comparison.comparisonId)
        Assert-SLResourceOpaqueId scenarioKey ([string] $Receipt.comparison.scenarioKey)
        if ($Receipt.comparison.role -cne 'baseline') {
            Throw-SLContractError -Code 'resource-comparison-role' -Message 'Baseline comparisons must use baseline role.'
        }
        foreach ($Name in @('artifactId', 'artifactVersion', 'artifactContentHash', 'generationRunId', 'applicationId')) {
            if (Test-SLProperty $Receipt $Name) {
                Throw-SLContractError -Code 'resource-baseline-fields' -Message "Baseline receipts cannot contain $Name."
            }
        }
    }
}

function New-SLResourceReceipt {
    param([Parameter(Mandatory)][object] $ReceiptInput)

    Assert-SLResourceNoSensitiveStrings -Value $ReceiptInput
    $RawKey = ([string] $ReceiptInput.idempotencyKey).Trim()
    if (-not $RawKey) {
        Throw-SLContractError -Code 'resource-idempotency' -Message 'idempotencyKey is required.'
    }
    $Hash = Get-SLSha256 $RawKey
    $Common = [ordered] @{
        schemaVersion = 1
        receiptId = "SL-RESOURCE-$($Hash.Substring(0, 32).ToUpperInvariant())"
        idempotencyKey = "sha256:$Hash"
        phase = [string] $ReceiptInput.phase
        source = [string] $ReceiptInput.source
        quality = [string] $ReceiptInput.quality
        provider = [string] $ReceiptInput.provider
        modelId = [string] $ReceiptInput.modelId
        tokens = $ReceiptInput.tokens
        wallClockDurationMs = $ReceiptInput.wallClockDurationMs
        timestamp = [string] $ReceiptInput.timestamp
        scope = Normalize-SLScope (Get-SLProperty $ReceiptInput 'scope' $script:SLDefaultScope)
    }
    foreach ($Name in @('modelDurationMs', 'toolDurationMs', 'attemptCount', 'evidenceRef', 'reportedCost')) {
        if (Test-SLProperty $ReceiptInput $Name) { $Common[$Name] = Get-SLProperty $ReceiptInput $Name }
    }
    if ($ReceiptInput.phase -ceq 'generation') {
        foreach ($Name in @('artifactId', 'artifactContentHash', 'generationRunId')) {
            if (-not (Test-SLProperty $ReceiptInput $Name)) {
                Throw-SLContractError -Code 'resource-generation-fields' -Message 'Generation receipts require artifactId, artifactContentHash, and generationRunId.'
            }
        }
        $Common['artifactId'] = $ReceiptInput.artifactId
        $Common['artifactVersion'] = "sha256:$($ReceiptInput.artifactContentHash)"
        $Common['artifactContentHash'] = $ReceiptInput.artifactContentHash
        $Common['generationRunId'] = $ReceiptInput.generationRunId
    }
    elseif ($ReceiptInput.phase -ceq 'application') {
        foreach ($Name in @('artifactId', 'artifactContentHash', 'taskRunId', 'applicationId')) {
            if (-not (Test-SLProperty $ReceiptInput $Name)) {
                Throw-SLContractError -Code 'resource-application-fields' -Message 'Application receipts require artifactId, artifactContentHash, taskRunId, and applicationId.'
            }
        }
        $Common['artifactId'] = $ReceiptInput.artifactId
        $Common['artifactVersion'] = "sha256:$($ReceiptInput.artifactContentHash)"
        $Common['artifactContentHash'] = $ReceiptInput.artifactContentHash
        $Common['taskRunId'] = $ReceiptInput.taskRunId
        $Common['applicationId'] = $ReceiptInput.applicationId
        if (Test-SLProperty $ReceiptInput 'comparison') {
            $Comparison = Copy-SLValue $ReceiptInput.comparison
            $Common['comparison'] = $Comparison
        }
    }
    elseif ($ReceiptInput.phase -ceq 'baseline') {
        if (-not (Test-SLProperty $ReceiptInput 'taskRunId') -or -not (Test-SLProperty $ReceiptInput 'comparison')) {
            Throw-SLContractError -Code 'resource-baseline-fields' -Message 'Baseline receipts require taskRunId and comparison identity.'
        }
        $Comparison = Copy-SLValue $ReceiptInput.comparison
        $Common['taskRunId'] = $ReceiptInput.taskRunId
        $Common['comparison'] = $Comparison
    }
    else {
        Throw-SLContractError -Code 'resource-phase' -Message 'phase is not supported.'
    }
    $Receipt = [pscustomobject] $Common
    Assert-SLResourceReceipt $Receipt
    return $Receipt
}

function Get-SLResourceReceiptPath {
    param([Parameter(Mandatory)][object] $Receipt)

    $Entry = Get-SLStateCatalogEntry $Receipt.scope
    $Month = ([string] $Receipt.timestamp).Substring(0, 7)
    $Owner = if ($Receipt.phase -ceq 'baseline') {
        $BaselineId = "SL-BASELINE-$((Get-SLSha256 ([string] $Receipt.comparison.comparisonId)).Substring(0, 12).ToUpperInvariant())"
        "sl-baselines/$(Get-SLArtifactShardName $BaselineId)"
    }
    else {
        Get-SLArtifactShardName ([string] $Receipt.artifactId)
    }
    return "$($Entry.resourceReceiptsPath)/$Owner/$Month/sl-resource-$(([string] $Receipt.receiptId).Substring(12)).json"
}

function Test-SLResourceReceiptEquivalent {
    param([object] $Left, [object] $Right)

    $LeftCopy = Copy-SLValue $Left
    $RightCopy = Copy-SLValue $Right
    Remove-SLProperty $LeftCopy 'timestamp'
    Remove-SLProperty $RightCopy 'timestamp'
    return (ConvertTo-SLCanonicalJson $LeftCopy) -ceq (ConvertTo-SLCanonicalJson $RightCopy)
}

function Get-SLResourceReceipts {
    param([Parameter(Mandatory)][string] $Root)

    $LearningPath = Resolve-SLContainedPath -Root $Root -RelativePath $script:SLLearningRoot
    if (-not [IO.Directory]::Exists($LearningPath)) { return @() }
    $Files = @(
        [IO.Directory]::EnumerateFiles($LearningPath, '*.json', [IO.SearchOption]::AllDirectories) |
            Where-Object {
                $Relative = [IO.Path]::GetRelativePath($Root, $_).Replace('\', '/')
                $Relative -match '^\.github/sl-learning/sl-scopes/[^/]+/sl-resource-receipts/'
            }
    )
    [Array]::Sort($Files, [StringComparer]::Ordinal)
    $Receipts = [System.Collections.Generic.List[object]]::new()
    $ById = @{}
    $ByKey = @{}
    $ByApplication = @{}
    foreach ($File in $Files) {
        $Relative = [IO.Path]::GetRelativePath($Root, $File).Replace('\', '/')
        $Receipt = Read-SLJson -Root $Root -RelativePath $Relative
        Assert-SLResourceReceipt $Receipt
        if ((Get-SLResourceReceiptPath $Receipt) -cne $Relative) {
            Throw-SLContractError -Code 'resource-path' -Message "SL resource receipt path mismatch: $Relative"
        }
        $Collision = if ($ById.ContainsKey([string] $Receipt.receiptId)) {
            $ById[[string] $Receipt.receiptId]
        }
        elseif ($ByKey.ContainsKey([string] $Receipt.idempotencyKey)) {
            $ByKey[[string] $Receipt.idempotencyKey]
        }
        else { $null }
        if ($null -ne $Collision -and -not (Test-SLResourceReceiptEquivalent $Collision $Receipt)) {
            Throw-SLContractError -Code 'resource-collision' -Message "Conflicting SL resource receipt identity: $($Receipt.receiptId)"
        }
        if ($Receipt.phase -ceq 'application') {
            if ($ByApplication.ContainsKey([string] $Receipt.applicationId) -and -not (Test-SLResourceReceiptEquivalent $ByApplication[[string] $Receipt.applicationId] $Receipt)) {
                Throw-SLContractError -Code 'resource-collision' -Message "Application $($Receipt.applicationId) has conflicting resource receipts."
            }
            $ByApplication[[string] $Receipt.applicationId] = $Receipt
        }
        if ($null -ne $Collision) {
            continue
        }
        $ById[[string] $Receipt.receiptId] = $Receipt
        $ByKey[[string] $Receipt.idempotencyKey] = $Receipt
        $Receipts.Add($Receipt)
    }
    return $Receipts.ToArray()
}

function Write-SLResourceReceipt {
    param([string] $Root, [object] $Receipt, [switch] $DryRun)

    Assert-SLResourceReceipt $Receipt
    $RelativePath = Get-SLResourceReceiptPath $Receipt
    $Path = Resolve-SLContainedPath -Root $Root -RelativePath $RelativePath
    if ([IO.File]::Exists($Path)) {
        $Existing = Read-SLJson -Root $Root -RelativePath $RelativePath
        if (-not (Test-SLResourceReceiptEquivalent $Existing $Receipt)) {
            Throw-SLContractError -Code 'resource-collision' -Message "Immutable SL resource receipt collision: $RelativePath"
        }
        return [pscustomobject] @{ action = 'skip'; path = $RelativePath; detail = 'idempotent receipt already recorded' }
    }
    if (-not $DryRun) {
        Write-SLImmutableText -Root $Root -RelativePath $RelativePath -Content (
            "$(ConvertTo-Json $Receipt -Depth 100)`n"
        )
    }
    return [pscustomobject] @{ action = 'create'; path = $RelativePath; detail = $(if ($DryRun) { 'planned' } else { 'written' }) }
}

function Assert-SLResourceCorrelation {
    param([string] $Root, [object] $Receipt)

    if ($Receipt.phase -ceq 'baseline') {
        $Catalog = Get-SLStateCatalog $Root
        if (@($Catalog.scopes | Where-Object { (Get-SLScopeKey $_.scope) -ceq (Get-SLScopeKey $Receipt.scope) }).Count -eq 0) {
            Throw-SLContractError -Code 'resource-correlation' -Message "Baseline resource receipt scope is not registered: $($Receipt.scope.id)."
        }
        return
    }
    if ($Receipt.phase -ceq 'application') {
        $Events = @(Get-SLUsageEvents $Root | Where-Object { $_.eventType -ceq 'usage' -and $_.applicationId -ceq $Receipt.applicationId })
        if ($Events.Count -eq 0) {
            Throw-SLContractError -Code 'resource-correlation' -Message "Application resource receipt has no usage lifecycle: $($Receipt.applicationId)"
        }
        foreach ($Event in $Events) {
            if (
                $Event.artifactId -cne $Receipt.artifactId -or
                $Event.artifactVersion -cne $Receipt.artifactVersion -or
                $Event.artifactContentHash -cne $Receipt.artifactContentHash -or
                $Event.taskRunId -cne $Receipt.taskRunId -or
                (Get-SLScopeKey $Event.scope) -cne (Get-SLScopeKey $Receipt.scope)
            ) {
                Throw-SLContractError -Code 'resource-correlation' -Message "Application resource receipt disagrees with usage lifecycle $($Receipt.applicationId)."
            }
        }
        return
    }
    $Registry = Get-SLRegistry $Root
    $Artifact = Find-SLArtifact $Registry ([string] $Receipt.artifactId)
    if (-not $Artifact.path) {
        Throw-SLContractError -Code 'resource-correlation' -Message "Generation resource receipt artifact has no active path: $($Receipt.artifactId)."
    }
    $Hash = Get-SLArtifactUsageContentHash (Read-SLSafeText -Root $Root -RelativePath ([string] $Artifact.path))
    if ($Hash -cne $Receipt.artifactContentHash -or "sha256:$Hash" -cne $Receipt.artifactVersion) {
        Throw-SLContractError -Code 'resource-correlation' -Message "Generation resource receipt does not match artifact version $($Receipt.artifactId)."
    }
    if ((Get-SLScopeKey $Artifact.scope) -cne (Get-SLScopeKey $Receipt.scope)) {
        Throw-SLContractError -Code 'resource-correlation' -Message "Generation resource receipt scope does not own artifact $($Receipt.artifactId)."
    }
}

function Import-SLResourceReceipts {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]] $Inputs,
        [switch] $DryRun
    )

    if ($Inputs.Count -eq 0) {
        Throw-SLContractError -Code 'resource-input' -Message 'Resource import requires at least one receipt.'
    }
    return Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation {
        [object[]] $Receipts = @($Inputs | ForEach-Object { New-SLResourceReceipt $_ })
        foreach ($Receipt in $Receipts) { Assert-SLResourceCorrelation $Root $Receipt }
        [object[]] $Existing = @(Get-SLResourceReceipts $Root)
        $Candidates = [System.Collections.Generic.List[object]]::new()
        foreach ($Receipt in $Existing) { $Candidates.Add($Receipt) }
        foreach ($Receipt in $Receipts) {
            $Collision = @($Candidates | Where-Object {
                $_.receiptId -ceq $Receipt.receiptId -or
                $_.idempotencyKey -ceq $Receipt.idempotencyKey -or
                ($_.phase -ceq 'application' -and $Receipt.phase -ceq 'application' -and $_.applicationId -ceq $Receipt.applicationId)
            })
            if ($Collision.Count -gt 0 -and -not (Test-SLResourceReceiptEquivalent $Collision[0] $Receipt)) {
                Throw-SLContractError -Code 'resource-collision' -Message "Immutable SL resource receipt collision: $($Collision[0].receiptId)"
            }
            if ($Collision.Count -eq 0) { $Candidates.Add($Receipt) }
        }
        $Changes = [System.Collections.Generic.List[object]]::new()
        $Canonical = [System.Collections.Generic.List[object]]::new()
        foreach ($Receipt in $Receipts) {
            $Collision = @($Existing | Where-Object {
                $_.receiptId -ceq $Receipt.receiptId -or
                $_.idempotencyKey -ceq $Receipt.idempotencyKey -or
                ($_.phase -ceq 'application' -and $Receipt.phase -ceq 'application' -and $_.applicationId -ceq $Receipt.applicationId)
            })
            if ($Collision.Count -gt 0) {
                $Canonical.Add($Collision[0])
                $Changes.Add([pscustomobject] @{ action = 'skip'; path = Get-SLResourceReceiptPath $Collision[0]; detail = 'idempotent receipt already recorded' })
            }
            else {
                $Canonical.Add($Receipt)
                $Changes.Add((Write-SLResourceReceipt -Root $Root -Receipt $Receipt -DryRun:$DryRun))
            }
        }
        Sync-SLResourceProjection -Root $Root -DryRun:$DryRun -Changes $Changes -SuppliedReceipts $Candidates.ToArray()
        return [pscustomobject] @{ receipts = $Canonical.ToArray(); changes = $Changes.ToArray() }
    }
}

function Get-SLResourceProjection {
    param([Parameter(Mandatory)][AllowNull()][AllowEmptyCollection()][object[]] $Receipts)

    $Groups = @{}
    foreach ($Receipt in @($Receipts | Where-Object { $null -ne $_ })) {
        $Identity = [ordered] @{ scope = $Receipt.scope }
        if ($Receipt.phase -cne 'baseline') {
            $Identity['artifactId'] = $Receipt.artifactId
            $Identity['artifactVersion'] = $Receipt.artifactVersion
            $Identity['artifactContentHash'] = $Receipt.artifactContentHash
        }
        foreach ($Name in @('phase', 'source', 'quality', 'provider', 'modelId')) { $Identity[$Name] = $Receipt.$Name }
        $Key = ConvertTo-SLCanonicalJson ([pscustomobject] $Identity)
        if (-not $Groups.ContainsKey($Key)) {
            $Projection = [ordered] @{}
            foreach ($Name in $Identity.Keys) { $Projection[$Name] = $Identity[$Name] }
            foreach ($Name in @('receiptCount', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens', 'wallClockDurationMs', 'modelDurationMs', 'toolDurationMs', 'attemptCount')) { $Projection[$Name] = 0 }
            $Projection['reportedCosts'] = [pscustomobject] @{}
            $Groups[$Key] = [pscustomobject] $Projection
        }
        $Item = $Groups[$Key]
        $InputTokens = [long] $Receipt.tokens.input
        $OutputTokens = [long] $Receipt.tokens.output
        $CacheRead = [long] (Get-SLProperty $Receipt.tokens 'cacheRead' 0)
        $CacheWrite = [long] (Get-SLProperty $Receipt.tokens 'cacheWrite' 0)
        $Reasoning = [long] (Get-SLProperty $Receipt.tokens 'reasoning' 0)
        $Item.receiptCount += 1
        $Item.inputTokens += $InputTokens
        $Item.outputTokens += $OutputTokens
        $Item.cacheReadTokens += $CacheRead
        $Item.cacheWriteTokens += $CacheWrite
        $Item.reasoningTokens += $Reasoning
        $Item.totalTokens += $InputTokens + $OutputTokens + $CacheRead + $CacheWrite + $Reasoning
        $Item.wallClockDurationMs += [long] $Receipt.wallClockDurationMs
        $Item.modelDurationMs += [long] (Get-SLProperty $Receipt 'modelDurationMs' 0)
        $Item.toolDurationMs += [long] (Get-SLProperty $Receipt 'toolDurationMs' 0)
        $Item.attemptCount += [long] (Get-SLProperty $Receipt 'attemptCount' 1)
        if (Test-SLProperty $Receipt 'reportedCost') {
            $Currency = [string] $Receipt.reportedCost.currency
            $Prior = [string] (Get-SLProperty $Item.reportedCosts $Currency '0')
            Set-SLProperty $Item.reportedCosts $Currency (Add-SLDecimal $Prior ([string] $Receipt.reportedCost.amount))
        }
    }
    return @((Sort-SLOrdinal @($Groups.Keys)) | ForEach-Object { $Groups[$_] })
}

function Sync-SLResourceProjection {
    param(
        [Parameter(Mandatory)][string] $Root,
        [switch] $DryRun,
        [AllowNull()][System.Collections.Generic.List[object]] $Changes,
        [AllowNull()][object[]] $SuppliedReceipts
    )

    if ($null -eq $Changes) { $Changes = [System.Collections.Generic.List[object]]::new() }
    [object[]] $Receipts = if ($null -ne $SuppliedReceipts) { @($SuppliedReceipts) } else { @(Get-SLResourceReceipts $Root) }
    $Catalog = Get-SLStateCatalog $Root
    foreach ($Entry in @($Catalog.scopes)) {
        [object[]] $Scoped = @($Receipts | Where-Object { $null -ne $_ -and (Get-SLScopeKey $_.scope) -ceq (Get-SLScopeKey $Entry.scope) })
        [object[]] $Projections = @(Get-SLResourceProjection $Scoped)
        $ProjectionPath = Resolve-SLContainedPath -Root $Root -RelativePath ([string] $Entry.resourceProjectionPath)
        if ($Scoped.Count -eq 0 -and -not [IO.File]::Exists($ProjectionPath)) {
            continue
        }
        $Projection = [pscustomobject] @{ schemaVersion = 1; scope = $Entry.scope; projections = $Projections }
        Write-SLJson -Root $Root -RelativePath ([string] $Entry.resourceProjectionPath) -Value $Projection -Changes $Changes -DryRun:$DryRun
    }
}

function ConvertTo-SLScaledDecimal {
    param([Parameter(Mandatory)][string] $Value)

    $Negative = $Value.StartsWith('-')
    $Unsigned = $(if ($Negative) { $Value.Substring(1) } else { $Value })
    $Parts = $Unsigned.Split('.')
    $Fraction = $(if ($Parts.Count -gt 1) { $Parts[1] } else { '' }).PadRight(12, '0')
    $Scaled = [Numerics.BigInteger]::Parse("$($Parts[0])$Fraction", [Globalization.CultureInfo]::InvariantCulture)
    return $(if ($Negative) { -$Scaled } else { $Scaled })
}

function ConvertFrom-SLScaledDecimal {
    param([Parameter(Mandatory)][Numerics.BigInteger] $Value)

    $Negative = $Value.Sign -lt 0
    $Absolute = [Numerics.BigInteger]::Abs($Value).ToString().PadLeft(13, '0')
    $Whole = $Absolute.Substring(0, $Absolute.Length - 12)
    $Fraction = $Absolute.Substring($Absolute.Length - 12).TrimEnd('0')
    return "$(if ($Negative) { '-' })$Whole$(if ($Fraction) { ".$Fraction" })"
}

function Add-SLDecimal {
    param([string] $Left, [string] $Right)
    return ConvertFrom-SLScaledDecimal ((ConvertTo-SLScaledDecimal $Left) + (ConvertTo-SLScaledDecimal $Right))
}

function Divide-SLScaledDecimal {
    param([Numerics.BigInteger] $Value, [int] $Divisor)
    $Quotient = $Value / $Divisor
    $Remainder = $Value % $Divisor
    if ($Remainder -ne 0 -and [Numerics.BigInteger]::Abs($Remainder) * 2 -ge $Divisor) {
        $Quotient += $(if ($Value.Sign -lt 0) { -1 } else { 1 })
    }
    return $Quotient
}

function Get-SLEmptyMetricValues {
    return [pscustomobject] @{
        inputTokens = 0; outputTokens = 0; cacheReadTokens = 0; cacheWriteTokens = 0
        reasoningTokens = 0; totalTokens = 0; wallClockDurationMs = 0
        modelDurationMs = 0; toolDurationMs = 0; attemptCount = 0
        reportedCosts = [pscustomobject] @{}
    }
}

function Get-SLReceiptMetricValues {
    param([object] $Receipt)
    $InputTokens = [long] $Receipt.tokens.input
    $OutputTokens = [long] $Receipt.tokens.output
    $CacheRead = [long] (Get-SLProperty $Receipt.tokens 'cacheRead' 0)
    $CacheWrite = [long] (Get-SLProperty $Receipt.tokens 'cacheWrite' 0)
    $Reasoning = [long] (Get-SLProperty $Receipt.tokens 'reasoning' 0)
    $Costs = [ordered] @{}
    if (Test-SLProperty $Receipt 'reportedCost') { $Costs[[string] $Receipt.reportedCost.currency] = [string] $Receipt.reportedCost.amount }
    return [pscustomobject] @{
        inputTokens = $InputTokens; outputTokens = $OutputTokens
        cacheReadTokens = $CacheRead; cacheWriteTokens = $CacheWrite
        reasoningTokens = $Reasoning
        totalTokens = $InputTokens + $OutputTokens + $CacheRead + $CacheWrite + $Reasoning
        wallClockDurationMs = [long] $Receipt.wallClockDurationMs
        modelDurationMs = [long] (Get-SLProperty $Receipt 'modelDurationMs' 0)
        toolDurationMs = [long] (Get-SLProperty $Receipt 'toolDurationMs' 0)
        attemptCount = [long] (Get-SLProperty $Receipt 'attemptCount' 1)
        reportedCosts = [pscustomobject] $Costs
    }
}

function Add-SLMetricValues {
    param([object] $Left, [object] $Right)
    $Costs = [ordered] @{}
    foreach ($Property in $Left.reportedCosts.PSObject.Properties) { $Costs[$Property.Name] = [string] $Property.Value }
    foreach ($Property in $Right.reportedCosts.PSObject.Properties) {
        $Costs[$Property.Name] = Add-SLDecimal ([string] (Get-SLProperty $Costs $Property.Name '0')) ([string] $Property.Value)
    }
    return [pscustomobject] @{
        inputTokens = $Left.inputTokens + $Right.inputTokens
        outputTokens = $Left.outputTokens + $Right.outputTokens
        cacheReadTokens = $Left.cacheReadTokens + $Right.cacheReadTokens
        cacheWriteTokens = $Left.cacheWriteTokens + $Right.cacheWriteTokens
        reasoningTokens = $Left.reasoningTokens + $Right.reasoningTokens
        totalTokens = $Left.totalTokens + $Right.totalTokens
        wallClockDurationMs = $Left.wallClockDurationMs + $Right.wallClockDurationMs
        modelDurationMs = $Left.modelDurationMs + $Right.modelDurationMs
        toolDurationMs = $Left.toolDurationMs + $Right.toolDurationMs
        attemptCount = $Left.attemptCount + $Right.attemptCount
        reportedCosts = [pscustomobject] $Costs
    }
}

function Measure-SLResourceReceipts {
    param([Parameter(Mandatory)][AllowNull()][AllowEmptyCollection()][object[]] $Receipts)
    $Values = Get-SLEmptyMetricValues
    $Counts = [ordered] @{}
    foreach ($Receipt in @($Receipts | Where-Object { $null -ne $_ })) {
        $Values = Add-SLMetricValues $Values (Get-SLReceiptMetricValues $Receipt)
        if (Test-SLProperty $Receipt 'reportedCost') {
            $Currency = [string] $Receipt.reportedCost.currency
            $Counts[$Currency] = [int] (Get-SLProperty $Counts $Currency 0) + 1
        }
    }
    $Result = [ordered] @{ receiptCount = @($Receipts | Where-Object { $null -ne $_ }).Count }
    foreach ($Property in $Values.PSObject.Properties) { $Result[$Property.Name] = $Property.Value }
    $Result['reportedCostReceiptCounts'] = [pscustomobject] $Counts
    return [pscustomobject] $Result
}

function Get-SLAverageSummary {
    param([object] $Summary, [int] $Divisor)
    if ($Divisor -eq 0) { return $null }
    $Costs = [ordered] @{}
    $CostCounts = [ordered] @{}
    foreach ($Property in $Summary.reportedCosts.PSObject.Properties) {
        $Count = [int] (Get-SLProperty $Summary.reportedCostReceiptCounts $Property.Name $Divisor)
        $Costs[$Property.Name] = ConvertFrom-SLScaledDecimal (Divide-SLScaledDecimal (ConvertTo-SLScaledDecimal ([string] $Property.Value)) $Count)
        $CostCounts[$Property.Name] = $Count
    }
    return [pscustomobject] @{
        sampleCount = $Divisor
        inputTokens = $Summary.inputTokens / $Divisor
        outputTokens = $Summary.outputTokens / $Divisor
        cacheReadTokens = $Summary.cacheReadTokens / $Divisor
        cacheWriteTokens = $Summary.cacheWriteTokens / $Divisor
        reasoningTokens = $Summary.reasoningTokens / $Divisor
        totalTokens = $Summary.totalTokens / $Divisor
        wallClockDurationMs = $Summary.wallClockDurationMs / $Divisor
        modelDurationMs = $Summary.modelDurationMs / $Divisor
        toolDurationMs = $Summary.toolDurationMs / $Divisor
        attemptCount = $Summary.attemptCount / $Divisor
        reportedCosts = [pscustomobject] $Costs
        reportedCostSampleCounts = [pscustomobject] $CostCounts
    }
}

function Get-SLAmortizedSummary {
    param([object] $Summary, [int] $Divisor)
    if ($Divisor -eq 0 -or $Summary.receiptCount -eq 0) { return $null }
    $Costs = [ordered] @{}
    $CostCounts = [ordered] @{}
    foreach ($Property in $Summary.reportedCosts.PSObject.Properties) {
        $Costs[$Property.Name] = ConvertFrom-SLScaledDecimal (
            Divide-SLScaledDecimal (ConvertTo-SLScaledDecimal ([string] $Property.Value)) $Divisor
        )
        $CostCounts[$Property.Name] = $Divisor
    }
    return [pscustomobject] @{
        sampleCount = $Divisor
        inputTokens = $Summary.inputTokens / $Divisor
        outputTokens = $Summary.outputTokens / $Divisor
        cacheReadTokens = $Summary.cacheReadTokens / $Divisor
        cacheWriteTokens = $Summary.cacheWriteTokens / $Divisor
        reasoningTokens = $Summary.reasoningTokens / $Divisor
        totalTokens = $Summary.totalTokens / $Divisor
        wallClockDurationMs = $Summary.wallClockDurationMs / $Divisor
        modelDurationMs = $Summary.modelDurationMs / $Divisor
        toolDurationMs = $Summary.toolDurationMs / $Divisor
        attemptCount = $Summary.attemptCount / $Divisor
        reportedCosts = [pscustomobject] $Costs
        reportedCostSampleCounts = [pscustomobject] $CostCounts
    }
}

function Subtract-SLMetricValues {
    param([object] $Baseline, [object] $Treatment)
    $Costs = [ordered] @{}
    foreach ($Property in $Baseline.reportedCosts.PSObject.Properties) {
        if (Test-SLProperty $Treatment.reportedCosts $Property.Name) {
            $BaselineCost = ConvertTo-SLScaledDecimal ([string] $Property.Value)
            $TreatmentCost = ConvertTo-SLScaledDecimal ([string] (Get-SLProperty $Treatment.reportedCosts $Property.Name))
            $Costs[$Property.Name] = ConvertFrom-SLScaledDecimal ($BaselineCost - $TreatmentCost)
        }
    }
    return [pscustomobject] @{
        inputTokens = $Baseline.inputTokens - $Treatment.inputTokens
        outputTokens = $Baseline.outputTokens - $Treatment.outputTokens
        cacheReadTokens = $Baseline.cacheReadTokens - $Treatment.cacheReadTokens
        cacheWriteTokens = $Baseline.cacheWriteTokens - $Treatment.cacheWriteTokens
        reasoningTokens = $Baseline.reasoningTokens - $Treatment.reasoningTokens
        totalTokens = $Baseline.totalTokens - $Treatment.totalTokens
        wallClockDurationMs = $Baseline.wallClockDurationMs - $Treatment.wallClockDurationMs
        modelDurationMs = $Baseline.modelDurationMs - $Treatment.modelDurationMs
        toolDurationMs = $Baseline.toolDurationMs - $Treatment.toolDurationMs
        attemptCount = $Baseline.attemptCount - $Treatment.attemptCount
        reportedCosts = [pscustomobject] $Costs
    }
}

function Get-SLMedian {
    param([Parameter(Mandatory)][AllowEmptyCollection()][double[]] $Values)
    if ($Values.Count -eq 0) { return $null }
    [Array]::Sort($Values)
    $Middle = [Math]::Floor($Values.Count / 2)
    return $(if (($Values.Count % 2) -eq 1) { $Values[$Middle] } else { ($Values[$Middle - 1] + $Values[$Middle]) / 2 })
}

function Get-SLMedianSavings {
    param([object[]] $Pairs)
    if ($Pairs.Count -eq 0) { return $null }
    $Costs = [ordered] @{}
    $Currencies = Sort-SLOrdinal @($Pairs | ForEach-Object { $_.savings.reportedCosts.PSObject.Properties | ForEach-Object { $_.Name } } | Select-Object -Unique)
    foreach ($Currency in $Currencies) {
        [Numerics.BigInteger[]] $Values = @($Pairs | ForEach-Object {
            if (Test-SLProperty $_.savings.reportedCosts $Currency) {
                ConvertTo-SLScaledDecimal ([string] (Get-SLProperty $_.savings.reportedCosts $Currency))
            }
        })
        if ($Values.Count -gt 0) {
            [Array]::Sort($Values)
            $Middle = [Math]::Floor($Values.Count / 2)
            $Median = if (($Values.Count % 2) -eq 1) { $Values[$Middle] } else { Divide-SLScaledDecimal ($Values[$Middle - 1] + $Values[$Middle]) 2 }
            $Costs[$Currency] = ConvertFrom-SLScaledDecimal $Median
        }
    }
    $Result = [ordered] @{}
    foreach ($Name in @('inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens', 'wallClockDurationMs', 'modelDurationMs', 'toolDurationMs', 'attemptCount')) {
        [double[]] $Values = @($Pairs | ForEach-Object { [double] $_.savings.$Name })
        $Result[$Name] = Get-SLMedian $Values
    }
    $Result['reportedCosts'] = [pscustomobject] $Costs
    return [pscustomobject] $Result
}

function Get-SLBreakEven {
    param([object] $Generation, [AllowNull()][object] $MedianSavings)
    if ($null -eq $MedianSavings -or $Generation.receiptCount -eq 0) { return $null }
    $Result = [ordered] @{}
    foreach ($Name in @('inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens', 'wallClockDurationMs', 'modelDurationMs', 'toolDurationMs', 'attemptCount')) {
        $Savings = [double] $MedianSavings.$Name
        $Result[$Name] = $(if ($Savings -gt 0) { [Math]::Ceiling([double] $Generation.$Name / $Savings) } else { $null })
    }
    $Costs = [ordered] @{}
    foreach ($Property in $MedianSavings.reportedCosts.PSObject.Properties) {
        $Savings = ConvertTo-SLScaledDecimal ([string] $Property.Value)
        if ($Savings -gt 0 -and (Test-SLProperty $Generation.reportedCosts $Property.Name)) {
            $GenerationCost = ConvertTo-SLScaledDecimal ([string] (Get-SLProperty $Generation.reportedCosts $Property.Name)
            )
            $Costs[$Property.Name] = [long] (($GenerationCost + $Savings - 1) / $Savings)
        } else { $Costs[$Property.Name] = $null }
    }
    $Result['reportedCosts'] = [pscustomobject] $Costs
    $Any = @($Result.Values | Where-Object { $null -ne $_ }).Count -gt 0
    return $(if ($Any) { [pscustomobject] $Result } else { $null })
}

function Get-SLEfficiencyReport {
    param(
        [Parameter(Mandatory)][string] $Root,
        [AllowNull()][string] $ArtifactId,
        [AllowNull()][string] $ScopeId,
        [AllowNull()][string] $Provider,
        [AllowNull()][string] $ModelId,
        [AllowNull()][string] $Quality
    )

    [object[]] $Receipts = @(Get-SLResourceReceipts $Root)
    [object[]] $UsageEvents = @(Get-SLUsageEvents $Root)
    $Registry = Get-SLRegistry $Root
    $Successes = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($Event in $UsageEvents) {
        if ($Event.eventType -ceq 'usage' -and $Event.stage -ceq 'verified' -and $Event.outcome -ceq 'success') {
            [void] $Successes.Add("$(Get-SLScopeKey $Event.scope)$([char]0)$($Event.artifactId)$([char]0)$($Event.artifactVersion)$([char]0)$($Event.applicationId)")
        }
    }
    $Filters = [ordered] @{}
    if ($ArtifactId) { $Filters['artifactId'] = $ArtifactId }
    if ($ScopeId) { $Filters['scopeId'] = $ScopeId }
    if ($Provider) { $Filters['provider'] = $Provider }
    if ($ModelId) { $Filters['modelId'] = $ModelId }
    if ($Quality) { $Filters['quality'] = $Quality }
    function Test-ResourceFilter {
        param([object] $Receipt, [bool] $IncludeArtifact)
        return (
            (-not $IncludeArtifact -or -not $ArtifactId -or $Receipt.artifactId -ceq $ArtifactId) -and
            (-not $ScopeId -or $Receipt.scope.id -ceq $ScopeId) -and
            (-not $Provider -or $Receipt.provider -ceq $Provider) -and
            (-not $ModelId -or $Receipt.modelId -ceq $ModelId) -and
            (-not $Quality -or $Receipt.quality -ceq $Quality)
        )
    }
    $Baselines = @($Receipts | Where-Object phase -ceq 'baseline')
    $SuccessfulTreatments = @($Receipts | Where-Object {
        $_.phase -ceq 'application' -and
        (Test-SLProperty $_ 'comparison') -and
        $Successes.Contains("$(Get-SLScopeKey $_.scope)$([char]0)$($_.artifactId)$([char]0)$($_.artifactVersion)$([char]0)$($_.applicationId)")
    })
    $SelectedTreatments = @($SuccessfulTreatments | Where-Object { Test-ResourceFilter $_ $true })
    $SelectedComparisonIds = @($SelectedTreatments | ForEach-Object { [string] $_.comparison.comparisonId } | Select-Object -Unique)
    $RelevantBaselines = if ($Filters.Count -eq 0) { $Baselines } else { @($Baselines | Where-Object { $SelectedComparisonIds -contains $_.comparison.comparisonId }) }
    $SegmentKeys = @{}
    foreach ($Receipt in @($Receipts | Where-Object { $_.phase -cne 'baseline' -and (Test-ResourceFilter $_ $true) })) {
        $KeyObject = [pscustomobject] @{
            scope = $Receipt.scope; artifactId = $Receipt.artifactId; artifactVersion = $Receipt.artifactVersion
            provider = $Receipt.provider; modelId = $Receipt.modelId; quality = $Receipt.quality
        }
        $SegmentKeys[(ConvertTo-SLCanonicalJson $KeyObject)] = $KeyObject
    }
    $PairedBaselineIds = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $Segments = [System.Collections.Generic.List[object]]::new()
    foreach ($Key in $SegmentKeys.Values) {
        $Identity = ConvertTo-SLCanonicalJson $Key
        $Generation = @($Receipts | Where-Object {
            $_.phase -ceq 'generation' -and (ConvertTo-SLCanonicalJson ([pscustomobject] @{
                scope=$_.scope; artifactId=$_.artifactId; artifactVersion=$_.artifactVersion; provider=$_.provider; modelId=$_.modelId; quality=$_.quality
            })) -ceq $Identity
        })
        $Applications = @($SelectedTreatments | Where-Object {
            (ConvertTo-SLCanonicalJson ([pscustomobject] @{
                scope=$_.scope; artifactId=$_.artifactId; artifactVersion=$_.artifactVersion; provider=$_.provider; modelId=$_.modelId; quality=$_.quality
            })) -ceq $Identity
        })
        $SuccessPrefix = "$(Get-SLScopeKey $Key.scope)$([char]0)$($Key.artifactId)$([char]0)$($Key.artifactVersion)$([char]0)"
        $EligibleCount = @($Successes | Where-Object { $_.StartsWith($SuccessPrefix, [StringComparison]::Ordinal) }).Count
        $GenerationTotals = Measure-SLResourceReceipts $Generation
        $ApplicationTotals = Measure-SLResourceReceipts $Applications
        $ApplicationAverage = Get-SLAverageSummary $ApplicationTotals $Applications.Count
        $Amortized = Get-SLAmortizedSummary $GenerationTotals $EligibleCount
        $Pairs = [System.Collections.Generic.List[object]]::new()
        $Incompatibilities = [System.Collections.Generic.List[object]]::new()
        foreach ($Treatment in @($Applications | Where-Object { Test-SLProperty $_ 'comparison' })) {
            $ComparisonId = [string] $Treatment.comparison.comparisonId
            $MatchingTreatments = @($SuccessfulTreatments | Where-Object { $_.comparison.comparisonId -ceq $ComparisonId })
            $MatchingBaselines = @($RelevantBaselines | Where-Object { $_.comparison.comparisonId -ceq $ComparisonId })
            $Reason = $null
            if ($MatchingTreatments.Count -ne 1) { $Reason = 'ambiguous-treatment' }
            elseif ($MatchingBaselines.Count -eq 0) { $Reason = 'missing-baseline' }
            elseif ($MatchingBaselines.Count -ne 1) { $Reason = 'ambiguous-baseline' }
            elseif ($MatchingBaselines[0].comparison.scenarioKey -cne $Treatment.comparison.scenarioKey) { $Reason = 'scenario-mismatch' }
            elseif ((Get-SLScopeKey $MatchingBaselines[0].scope) -cne (Get-SLScopeKey $Treatment.scope)) { $Reason = 'scope-mismatch' }
            elseif ($MatchingBaselines[0].quality -cne $Treatment.quality) { $Reason = 'quality-mismatch' }
            if ($Reason) {
                $Incompatibilities.Add([pscustomobject] @{ comparisonId=$ComparisonId; treatmentReceiptId=$Treatment.receiptId; reason=$Reason })
            }
            else {
                $Baseline = $MatchingBaselines[0]
                [void] $PairedBaselineIds.Add([string] $Baseline.receiptId)
                $Pairs.Add([pscustomobject] @{
                    comparisonId=$ComparisonId; scenarioKey=$Treatment.comparison.scenarioKey
                    baselineReceiptId=$Baseline.receiptId; treatmentReceiptId=$Treatment.receiptId
                    savings=Subtract-SLMetricValues (Get-SLReceiptMetricValues $Baseline) (Get-SLReceiptMetricValues $Treatment)
                })
            }
        }
        [object[]] $PairArray = @($Pairs | Sort-Object -Stable -Property comparisonId)
        [object[]] $IncompatibilityArray = @($Incompatibilities | Sort-Object -Stable -Property comparisonId,treatmentReceiptId)
        $Median = Get-SLMedianSavings $PairArray
        $CombinedAverage = if ($null -eq $ApplicationAverage) { $null } elseif ($null -eq $Amortized) {
            $Copy = Copy-SLValue $ApplicationAverage
            Remove-SLProperty $Copy 'sampleCount'; Remove-SLProperty $Copy 'reportedCostSampleCounts'; $Copy
        } else {
            $ApplicationValues = Copy-SLValue $ApplicationAverage
            Remove-SLProperty $ApplicationValues 'sampleCount'; Remove-SLProperty $ApplicationValues 'reportedCostSampleCounts'
            $AmortizedValues = Copy-SLValue $Amortized
            Remove-SLProperty $AmortizedValues 'sampleCount'; Remove-SLProperty $AmortizedValues 'reportedCostSampleCounts'
            Add-SLMetricValues $ApplicationValues $AmortizedValues
        }
        $Segments.Add([pscustomobject] @{
            key=$Key
            generation=[pscustomobject] @{ totals=$GenerationTotals; amortizedPerVerifiedSuccess=$Amortized }
            verifiedSuccessApplications=[pscustomobject] @{
                eligibleCount=$EligibleCount; receiptCount=$Applications.Count
                coverage=$(if ($EligibleCount -eq 0) { $null } else { $Applications.Count / $EligibleCount })
                average=$ApplicationAverage; averageWithAmortizedGeneration=$CombinedAverage
            }
            pairedBaseline=[pscustomobject] @{
                compatiblePairCount=$PairArray.Count; incompatiblePairCount=$IncompatibilityArray.Count
                pairSavings=$PairArray; incompatibilities=$IncompatibilityArray
                medianSavings=$Median; breakEvenApplications=Get-SLBreakEven $GenerationTotals $Median
            }
        })
    }
    [object[]] $SegmentArray = @($Segments | Sort-Object -Stable -Property @{ Expression = { ConvertTo-SLCanonicalJson $_.key } })
    function Get-LineageCost {
        param([object[]] $LineageReceipts)
        $Generation = @($LineageReceipts | Where-Object phase -ceq 'generation')
        $Application = @($LineageReceipts | Where-Object phase -ceq 'application')
        $LineageGroups = @{}
        foreach ($Receipt in $LineageReceipts) {
            $Key = [pscustomobject] @{
                scope=$Receipt.scope; artifactId=$Receipt.artifactId; artifactVersion=$Receipt.artifactVersion
                provider=$Receipt.provider; modelId=$Receipt.modelId; quality=$Receipt.quality; phase=$Receipt.phase
            }
            $Identity = ConvertTo-SLCanonicalJson $Key
            if (-not $LineageGroups.ContainsKey($Identity)) { $LineageGroups[$Identity] = [pscustomobject] @{ key=$Key; receipts=[System.Collections.Generic.List[object]]::new() } }
            $LineageGroups[$Identity].receipts.Add($Receipt)
        }
        [object[]] $LineageSegments = @($LineageGroups.Values | ForEach-Object { [pscustomobject] @{ key=$_.key; totals=Measure-SLResourceReceipts $_.receipts.ToArray() } } | Sort-Object -Stable -Property @{Expression={ConvertTo-SLCanonicalJson $_.key}})
        return [pscustomobject] @{ generation=Measure-SLResourceReceipts $Generation; application=Measure-SLResourceReceipts $Application; combined=Measure-SLResourceReceipts $LineageReceipts; segments=$LineageSegments }
    }
    $FilteredLineageReceipts = @($Receipts | Where-Object { $_.phase -cne 'baseline' -and (Test-ResourceFilter $_ $false) })
    $Lineage = [System.Collections.Generic.List[object]]::new()
    foreach ($Artifact in @($Registry.artifacts | Where-Object { $_.classification -ceq 'promoted' -and (-not $ArtifactId -or $_.id -ceq $ArtifactId) })) {
        [string[]] $SourceIds = Sort-SLOrdinal @((Get-SLProperty $Artifact 'dependsOn' @()))
        [object[]] $Direct = @($FilteredLineageReceipts | Where-Object artifactId -ceq $Artifact.id)
        [object[]] $Source = @($FilteredLineageReceipts | Where-Object { $SourceIds -contains $_.artifactId })
        $Lineage.Add([pscustomobject] @{
            artifactId=$Artifact.id; directArtifactIds=@($Artifact.id); sourceArtifactIds=$SourceIds
            direct=Get-LineageCost $Direct; source=Get-LineageCost $Source; combined=Get-LineageCost (@($Direct)+@($Source))
        })
    }
    return [pscustomobject] @{
        schemaVersion=1; advisory=$true; filters=[pscustomobject] $Filters
        baselineReceiptCount=@($RelevantBaselines).Count
        unpairedBaselineCount=@($RelevantBaselines | Where-Object { -not $PairedBaselineIds.Contains([string] $_.receiptId) }).Count
        segments=$SegmentArray
        promotionLineage=@($Lineage | Sort-Object -Stable -Property artifactId)
    }
}

function ConvertFrom-SLResourceInput {
    param([Parameter(Mandatory)][object] $Value)

    Assert-SLResourceNoSensitiveStrings -Value $Value
    $Entries = if ($Value -is [array]) {
        @($Value)
    }
    elseif ((Test-SLProperty $Value 'receipts') -or (Test-SLProperty $Value 'schemaVersion')) {
        if (-not (Test-SLMap $Value)) {
            Throw-SLContractError -Code 'resource-input' -Message 'Resource input envelope must be a JSON object.'
        }
        Assert-SLResourceKnownProperties -Name 'resource input' -Value $Value -Allowed @('schemaVersion','receipts')
        if ($Value.schemaVersion -ne 1 -or -not (Test-SLProperty $Value 'receipts') -or $Value.receipts -isnot [array]) {
            Throw-SLContractError -Code 'resource-input' -Message 'Resource input envelope requires schemaVersion 1 and a receipts array.'
        }
        @($Value.receipts)
    }
    else {
        @($Value)
    }
    if ($Entries.Count -eq 0) { Throw-SLContractError -Code 'resource-input' -Message 'Resource input must contain at least one receipt.' }
    for ($Index = 0; $Index -lt $Entries.Count; $Index += 1) {
        $Entry = $Entries[$Index]
        Assert-SLResourceInputShape -Entry $Entry -Index $Index
        [void] (New-SLResourceReceipt $Entry)
    }
    return $Entries
}

# ////////////////////////////////////////////////////////////////////////////////
# Generated from SL.Runtime.Promotion.ps1
# ////////////////////////////////////////////////////////////////////////////////

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
    Throw-SLContractError -Code 'promotion-path' -Message 'Promoted path must be .github/instructions/sl-*.instructions.md or .github/skills/<skill-name>/SKILL.md.'
}

function Test-SLSkillName {
    param([AllowNull()][object] $Value)

    return $Value -is [string] -and [string] $Value -cmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$'
}

function Get-SLSkillNameForArtifactId {
    param([Parameter(Mandatory)][string] $ArtifactId)

    return $ArtifactId.ToLowerInvariant()
}

function Get-SLProbationPath {
    param([string] $ArtifactId, [string] $ArtifactType, [string] $TargetPath)

    $DirectoryName = $ArtifactId.ToLowerInvariant()
    return $(if ($ArtifactType -ceq 'instruction') {
        "$script:SLProbationRoot/$DirectoryName/$([IO.Path]::GetFileName($TargetPath))"
    } else {
        "$script:SLProbationRoot/$DirectoryName/SKILL.md"
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
        (Get-SLProperty $Frontmatter 'managedBy') -cne 'sl' -or
        (Get-SLProperty $Frontmatter 'status') -cne $ExpectedStatus -or
        [bool] (Get-SLProperty $Frontmatter 'pinned' $false)
    ) {
        return $false
    }
    if ($ArtifactType -ceq 'instruction') {
        return (Get-SLProperty $Frontmatter 'applyTo') -is [string]
    }
    $FolderName = ([string] $ArtifactPath).Split('/')[-2]
    $ExpectedName = Get-SLSkillNameForArtifactId $ArtifactId
    return (
        (Test-SLSkillName $FolderName) -and
        $FolderName -ceq $ExpectedName -and
        $ArtifactPath -ceq ".github/skills/$FolderName/SKILL.md" -and
        (Get-SLProperty $Frontmatter 'name') -ceq $FolderName
    )
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
        -not $ContractPath.StartsWith('.github/sl-learning/sl-validation-contracts/') -or
        -not ([IO.Path]::GetFileName($ContractPath)).StartsWith('sl-') -or
        -not $ContractPath.EndsWith('.validation.json')
    ) {
        Add-ContractCheck 'contract-path' static $false '' 'validationContract must reference an sl-*.validation.json file under .github/sl-learning/sl-validation-contracts/.'
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
            [string] $Artifact.status -cne 'active' -or
            -not $Artifact.path
        ) { continue }
        if (-not (Test-SLPromotionEvaluationCurrent $Root $Artifact)) {
            Throw-SLContractError -Code 'promotion-stale' -Message "Active promotion $($Artifact.id) has a stale evaluation."
        }
        $Content = Read-SLSafeText -Root $Root -RelativePath ([string] $Artifact.path)
        $Frontmatter = (ConvertFrom-SLFrontmatter $Content).frontmatter
        $ContractPath = Get-SLProperty $Frontmatter 'validationContract'
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
        if ($ArtifactType -ceq 'instruction' -and -not ([IO.Path]::GetFileName($TargetPath)).StartsWith('sl-')) {
            Throw-SLContractError -Code 'promotion-prefix' -Message 'Promoted instruction path must use an sl- prefix.'
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
        if ($ArtifactType -ceq 'skill') {
            $FolderName = $TargetPath.Split('/')[-2]
            $ExpectedName = Get-SLSkillNameForArtifactId $PromotedId
            if (-not (Test-SLSkillName $FolderName)) {
                Throw-SLContractError -Code 'promotion-skill-name' -Message 'Promoted skill directory must be a lowercase kebab-case skill name.'
            }
            if ($FolderName -cne $ExpectedName) {
                Throw-SLContractError -Code 'promotion-skill-name' -Message "Promoted skill directory must be the deterministic skill name $ExpectedName."
            }
            if ($TargetPath -cne ".github/skills/$FolderName/SKILL.md") {
                Throw-SLContractError -Code 'promotion-skill-name' -Message "Promoted skill path must be .github/skills/$FolderName/SKILL.md."
            }
            if ((Get-SLProperty $Markdown.frontmatter 'name') -cne $FolderName) {
                Throw-SLContractError -Code 'promotion-skill-name' -Message "Promoted skill frontmatter name must match its directory $FolderName."
            }
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
        Set-SLProperty $Markdown.frontmatter 'managedBy' 'sl'
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
            managedBy = 'sl'
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

# ////////////////////////////////////////////////////////////////////////////////
# Generated from SL.Runtime.Lifecycle.ps1
# ////////////////////////////////////////////////////////////////////////////////

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
    $Paths.Add($script:SLStateCatalogPath)
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

# ////////////////////////////////////////////////////////////////////////////////
# Generated from SL.Runtime.Conformance.ps1
# ////////////////////////////////////////////////////////////////////////////////

Set-StrictMode -Version Latest

function Invoke-SLConformanceVector {
    param([Parameter(Mandatory)][pscustomobject] $Vector)

    switch ($Vector.operation) {
        'canonical-json' {
            return ConvertTo-SLCanonicalJson -Value $Vector.input
        }
        'sha256' {
            if ($Vector.input -isnot [string]) {
                Throw-SLContractError -Code 'vector-input' -Message 'sha256 input must be a string.'
            }
            return Get-SLSha256 -Value $Vector.input
        }
        'normalize-path' {
            if ($Vector.input -isnot [string]) {
                Throw-SLContractError -Code 'vector-input' -Message 'normalize-path input must be a string.'
            }
            return ConvertTo-SLNormalizedPath -Path $Vector.input
        }
        'parse-yaml' {
            if ($Vector.input -isnot [string]) {
                Throw-SLContractError -Code 'vector-input' -Message 'parse-yaml input must be a string.'
            }
            return ConvertFrom-SLYaml -Content $Vector.input
        }
        'parse-frontmatter' {
            if ($Vector.input -isnot [string]) {
                Throw-SLContractError -Code 'vector-input' -Message 'parse-frontmatter input must be a string.'
            }
            return ConvertFrom-SLFrontmatter -Content $Vector.input
        }
        'validate-value' {
            if (
                $Vector.input -isnot [pscustomobject] -or
                $null -eq $Vector.input.PSObject.Properties['value'] -or
                $null -eq $Vector.input.PSObject.Properties['contract']
            ) {
                Throw-SLContractError -Code 'vector-input' -Message 'validate-value input requires value and contract.'
            }
            Assert-SLTypedValue -Value $Vector.input.value -Contract $Vector.input.contract
            return $true
        }
        'glob-match' {
            if (
                $Vector.input -isnot [pscustomobject] -or
                $Vector.input.pattern -isnot [string] -or
                $Vector.input.path -isnot [string]
            ) {
                Throw-SLContractError -Code 'vector-input' -Message 'glob-match input requires pattern and path strings.'
            }
            return Test-SLGlob -Pattern $Vector.input.pattern -Path $Vector.input.path
        }
        'slugify' {
            if ($Vector.input -isnot [string]) {
                Throw-SLContractError -Code 'vector-input' -Message 'slugify input must be a string.'
            }
            return ConvertTo-SLSlug $Vector.input
        }
        'scope-shard' {
            if (
                -not (Test-SLMap $Vector.input) -or
                $Vector.input.id -isnot [string] -or
                $Vector.input.path -isnot [string]
            ) {
                Throw-SLContractError -Code 'vector-input' -Message 'scope-shard input requires id and path strings.'
            }
            return Get-SLScopeShardName ([pscustomobject] @{
                id = $Vector.input.id
                path = ConvertTo-SLNormalizedPath $Vector.input.path
            })
        }
        'usage-event-id' {
            if ($Vector.input -isnot [string] -or -not $Vector.input.Trim()) {
                Throw-SLContractError -Code 'vector-input' -Message 'usage-event-id input must be a non-empty string.'
            }
            $Hash = Get-SLSha256 $Vector.input.Trim()
            return "SL-USE-$($Hash.Substring(0, 32).ToUpperInvariant())"
        }
        'lifecycle-event-id' {
            if (-not (Test-SLMap $Vector.input)) {
                Throw-SLContractError -Code 'vector-input' -Message 'lifecycle-event-id input must be an object.'
            }
            return (New-SLLifecycleEvent $Vector.input).eventId
        }
        'retention-deadline' {
            if (
                -not (Test-SLMap $Vector.input) -or
                $Vector.input.timestamp -isnot [string] -or
                $Vector.input.days -isnot [long]
            ) {
                Throw-SLContractError -Code 'vector-input' -Message 'retention-deadline requires timestamp and integer days.'
            }
            $Timestamp = [DateTimeOffset]::Parse(
                $Vector.input.timestamp,
                [Globalization.CultureInfo]::InvariantCulture
            )
            return $Timestamp.AddDays($Vector.input.days).UtcDateTime.ToString(
                'yyyy-MM-ddTHH:mm:ss.fffZ',
                [Globalization.CultureInfo]::InvariantCulture
            )
        }
        'promotion-owner-set' {
            if (-not (Test-SLMap $Vector.input)) {
                Throw-SLContractError -Code 'vector-input' -Message 'promotion-owner-set requires ownerAliases strings.'
            }
            $Aliases = Sort-SLOrdinal @($Vector.input.ownerAliases)
            return "SL-OWNERS-$((Get-SLSha256 (ConvertTo-SLCanonicalJson $Aliases)).Substring(0, 16).ToUpperInvariant())"
        }
        'safe-reference' {
            if ($Vector.input -isnot [string]) {
                Throw-SLContractError -Code 'vector-input' -Message 'safe-reference input must be a string.'
            }
            return Test-SLOpaqueReference $Vector.input
        }
        'resource-receipt-id' {
            if ($Vector.input -isnot [string] -or -not $Vector.input.Trim()) {
                Throw-SLContractError -Code 'vector-input' -Message 'resource-receipt-id input must be a non-empty string.'
            }
            $Hash = Get-SLSha256 $Vector.input.Trim()
            return "SL-RESOURCE-$($Hash.Substring(0, 32).ToUpperInvariant())"
        }
        'resource-total-tokens' {
            if (-not (Test-SLMap $Vector.input)) {
                Throw-SLContractError -Code 'vector-input' -Message 'resource-total-tokens input must be an object.'
            }
            [long] $Total = 0
            foreach ($Name in @('input', 'output', 'cacheRead', 'cacheWrite', 'reasoning')) {
                $Value = Get-SLProperty $Vector.input $Name 0
                Assert-SLResourceInteger "tokens.$Name" $Value
                $Total += [long] $Value
            }
            return $Total
        }
        'resource-cost-add' {
            if (
                -not (Test-SLMap $Vector.input) -or
                [string] $Vector.input.left -cnotmatch '^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$' -or
                [string] $Vector.input.right -cnotmatch '^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$'
            ) {
                Throw-SLContractError -Code 'vector-input' -Message 'resource-cost-add requires decimal strings.'
            }
            return Add-SLDecimal ([string] $Vector.input.left) ([string] $Vector.input.right)
        }
        default {
            Throw-SLContractError -Code 'vector-operation' -Message "Unknown conformance operation: $($Vector.operation)"
        }
    }
}

function Invoke-SLRuntimeConformance {
    param(
        [Parameter(Mandatory)]
        [string] $RuntimeHome
    )

    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) {
        $Suite = ConvertFrom-Json -InputObject $script:SLConformanceVectorsJson -Depth 100 -DateKind String
    }
    else {
        $Suite = ConvertFrom-Json -InputObject $script:SLConformanceVectorsJson -Depth 100
    }
    if (
        $Suite.schemaVersion -ne 1 -or
        $Suite.conformanceVersion -ne 1 -or
        $Suite.vectors -isnot [array]
    ) {
        Throw-SLContractError -Code 'conformance-format' -Message 'Unsupported SL runtime conformance vector format.'
    }
    $Failures = [System.Collections.Generic.List[object]]::new()
    foreach ($Vector in $Suite.vectors) {
        try {
            $ActualValue = Invoke-SLConformanceVector -Vector $Vector
            if ($null -ne $Vector.PSObject.Properties['error']) {
                $Failures.Add([pscustomobject] @{
                    id = $Vector.id
                    expected = "error:$($Vector.error)"
                    actual = ConvertTo-SLCanonicalJson -Value $ActualValue
                })
                continue
            }
            $Expected = ConvertTo-SLCanonicalJson -Value $Vector.expected
            $Actual = ConvertTo-SLCanonicalJson -Value $ActualValue
            if ($Actual -cne $Expected) {
                $Failures.Add([pscustomobject] @{
                    id = $Vector.id
                    expected = $Expected
                    actual = $Actual
                })
            }
        }
        catch {
            $Code = [string] $_.Exception.Data['SLCode']
            if (
                $null -ne $Vector.PSObject.Properties['error'] -and
                $Code -ceq [string] $Vector.error
            ) {
                continue
            }
            $Expected = if ($null -ne $Vector.PSObject.Properties['error']) {
                "error:$($Vector.error)"
            }
            else {
                ConvertTo-SLCanonicalJson -Value $Vector.expected
            }
            $Failures.Add([pscustomobject] @{
                id = $Vector.id
                expected = $Expected
                actual = if ($Code) { "error:$Code" } else { "error:$($_.Exception.Message)" }
            })
        }
    }
    return [pscustomobject] @{
        conformanceVersion = [int] $Suite.conformanceVersion
        passed = [int] ($Suite.vectors.Count - $Failures.Count)
        failed = [int] $Failures.Count
        failures = $Failures.ToArray()
    }
}

# ////////////////////////////////////////////////////////////////////////////////
# Generated from SL.Runtime.Doctor.ps1
# ////////////////////////////////////////////////////////////////////////////////

Set-StrictMode -Version Latest

function Test-SLRuntimeManifestShape {
    param([Parameter(Mandatory)][pscustomobject] $Manifest)

    $ExpectedProperties = [string[]] @(
        'configContractVersion',
        'conformanceVersion',
        'files',
        'minimumPowerShellVersion',
        'runtimeVersion',
        'schemaVersion',
        'sourceReleaseCommit'
    )
    $ActualProperties = [string[]] @($Manifest.PSObject.Properties.Name)
    [Array]::Sort($ActualProperties, [StringComparer]::Ordinal)
    if (($ActualProperties -join ',') -cne ($ExpectedProperties -join ',')) {
        Throw-SLContractError -Code 'manifest-properties' -Message 'Runtime manifest properties do not match the contract.'
    }
    if ($Manifest.schemaVersion -ne 1) {
        Throw-SLContractError -Code 'manifest-schema-version' -Message 'Unsupported runtime manifest schemaVersion.'
    }
    if ([string] $Manifest.runtimeVersion -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
        Throw-SLContractError -Code 'manifest-runtime-version' -Message 'runtimeVersion must be a semantic version.'
    }
    if ([string] $Manifest.sourceReleaseCommit -cnotmatch '^(?:[0-9a-f]{40}|__SL_SOURCE_RELEASE_COMMIT__)$') {
        Throw-SLContractError -Code 'manifest-source-release' -Message 'sourceReleaseCommit must be a full commit or the staging placeholder.'
    }
    if (
        $Manifest.configContractVersion -isnot [long] -or
        $Manifest.configContractVersion -lt 1 -or
        $Manifest.conformanceVersion -isnot [long] -or
        $Manifest.conformanceVersion -lt 1
    ) {
        Throw-SLContractError -Code 'manifest-contract-version' -Message 'Manifest contract versions must be positive integers.'
    }
    if ([string] $Manifest.minimumPowerShellVersion -cne '7.0.0') {
        Throw-SLContractError -Code 'manifest-powershell-version' -Message 'minimumPowerShellVersion must be 7.0.0.'
    }
    if ($Manifest.files -isnot [array] -or $Manifest.files.Count -eq 0) {
        Throw-SLContractError -Code 'manifest-files' -Message 'Runtime manifest files must be a non-empty array.'
    }
    $Previous = ''
    $Seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($File in $Manifest.files) {
        $Properties = [string[]] @($File.PSObject.Properties.Name)
        [Array]::Sort($Properties, [StringComparer]::Ordinal)
        if (
            ($Properties -join ',') -cne 'path,sha256' -or
            $File.path -isnot [string] -or
            $File.sha256 -isnot [string]
        ) {
            Throw-SLContractError -Code 'manifest-file' -Message 'Each runtime manifest file requires only path and sha256 strings.'
        }
        $Normalized = ConvertTo-SLNormalizedPath -Path $File.path
        if ($Normalized -cne $File.path -or $File.path -ceq 'sl-runtime.manifest.json') {
            Throw-SLContractError -Code 'manifest-file-path' -Message "Invalid runtime manifest path: $($File.path)"
        }
        if ($File.sha256 -cnotmatch '^[0-9a-f]{64}$') {
            Throw-SLContractError -Code 'manifest-file-hash' -Message "Invalid SHA-256 for runtime file: $($File.path)"
        }
        if (
            -not $Seen.Add($File.path) -or
            ($Previous -and [StringComparer]::Ordinal.Compare($Previous, $File.path) -ge 0)
        ) {
            Throw-SLContractError -Code 'manifest-file-order' -Message 'Runtime manifest files must be unique and ordinally sorted.'
        }
        $Previous = $File.path
    }
    $ManifestPaths = [string[]] @($Manifest.files | ForEach-Object { [string] $_.path })
    if (
        $ManifestPaths.Count -ne $script:SLRuntimePayloadFiles.Count -or
        [string]::Join([char] 0, $ManifestPaths) -cne [string]::Join([char] 0, $script:SLRuntimePayloadFiles)
    ) {
        Throw-SLContractError -Code 'manifest-files' -Message 'Runtime manifest payload inventory does not match the contract.'
    }
}

function Test-SLRuntimeInstallation {
    param(
        [Parameter(Mandatory)]
        [string] $RuntimeHome,

        [Parameter(Mandatory)]
        [string] $ExpectedRuntimeVersion
    )

    $Checks = [System.Collections.Generic.List[object]]::new()
    $ManifestPath = [IO.Path]::Combine($RuntimeHome, 'sl-runtime.manifest.json')
    if (-not [IO.File]::Exists($ManifestPath)) {
        $Checks.Add([pscustomobject] @{
            status = 'error'
            code = 'runtime-manifest-missing'
            message = 'SL runtime manifest is missing.'
        })
        return [pscustomobject] @{ healthy = $false; checks = $Checks.ToArray() }
    }
    try {
        $Manifest = ConvertFrom-Json -InputObject (
            [IO.File]::ReadAllText($ManifestPath, [Text.UTF8Encoding]::new($false, $true))
        ) -Depth 100
        Test-SLRuntimeManifestShape -Manifest $Manifest
        $Checks.Add([pscustomobject] @{
            status = 'ok'
            code = 'runtime-manifest'
            message = "Runtime manifest $($Manifest.runtimeVersion) is valid."
        })
    }
    catch {
        $Checks.Add([pscustomobject] @{
            status = 'error'
            code = 'runtime-manifest-invalid'
            message = $_.Exception.Message
        })
        return [pscustomobject] @{ healthy = $false; checks = $Checks.ToArray() }
    }
    if ([string] $Manifest.runtimeVersion -cne $ExpectedRuntimeVersion) {
        $Checks.Add([pscustomobject] @{
            status = 'error'
            code = 'runtime-mixed-version'
            message = "Loaded runtime $ExpectedRuntimeVersion does not match manifest $($Manifest.runtimeVersion)."
        })
    }
    foreach ($File in $Manifest.files) {
        $Path = [IO.Path]::Combine($RuntimeHome, $File.path.Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (-not [IO.File]::Exists($Path)) {
            $Checks.Add([pscustomobject] @{
                status = 'error'
                code = 'runtime-file-missing'
                message = "Runtime file is missing: $($File.path)"
            })
            continue
        }
        $ActualHash = Get-SLFileSha256 -Path $Path
        if ($ActualHash -cne $File.sha256) {
            $Checks.Add([pscustomobject] @{
                status = 'error'
                code = 'runtime-hash-drift'
                message = "Runtime file hash drift: $($File.path)"
            })
        }
    }
    $ManagedPaths = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($File in $Manifest.files) {
        [void] $ManagedPaths.Add([string] $File.path)
    }
    foreach ($File in [IO.Directory]::EnumerateFiles($RuntimeHome)) {
        $Name = [IO.Path]::GetFileName($File)
        if (
            $Name -cne 'sl-runtime.manifest.json' -and
            -not $ManagedPaths.Contains($Name) -and
            (
                $Name -cmatch '^SL\.Runtime\..+\.(?:ps1|psm1)$' -or
                $Name -cin @(
                    'sl.ps1',
                    'sl.sh',
                    'SL-conformance-vectors.json',
                    'sl-runtime-manifest.schema.json'
                )
            )
        ) {
            $Checks.Add([pscustomobject] @{
                status = 'error'
                code = 'runtime-mixed-version'
                message = "Runtime contract file is not declared by the manifest: $Name"
            })
        }
    }
    $BashPath = [IO.Path]::Combine($RuntimeHome, 'sl.sh')
    if ([IO.File]::Exists($BashPath)) {
        $Bash = [IO.File]::ReadAllText($BashPath)
        if (
            $Bash -notmatch 'exec pwsh' -or
            $Bash -match '\b(?:node|npm|npx)\b'
        ) {
            $Checks.Add([pscustomobject] @{
                status = 'error'
                code = 'runtime-bash-launcher'
                message = 'Bash launcher must delegate only to repository-local sl.ps1 through pwsh.'
            })
        }
        else {
            $Checks.Add([pscustomobject] @{
                status = 'ok'
                code = 'runtime-bash-launcher'
                message = 'Bash launcher delegates to pwsh without Node or a global SL CLI.'
            })
        }
    }
    return [pscustomobject] @{
        healthy = -not @($Checks | Where-Object status -ceq 'error').Count
        checks = $Checks.ToArray()
    }
}

# ////////////////////////////////////////////////////////////////////////////////
# Generated from SL.Runtime.Validation.ps1
# ////////////////////////////////////////////////////////////////////////////////

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
        [string] $Artifact.managedBy -ceq 'sl' -and
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
            foreach ($Path in @($Entry.registryPath, $Entry.indexPath, $Entry.projectionPath, $Entry.usageEventsPath, $Entry.resourceReceiptsPath, $Entry.resourceProjectionPath)) {
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
            $Issues.Add((New-SLValidationIssue error 'registry-schema' "Artifact $($Artifact.id) has invalid typed fields." $script:SLStateCatalogPath))
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
                        try {
                            $OwnedMarkdown = Read-SLOwnedMarkdown -Root $Root -Artifact $Artifact
                            if ($Artifact.classification -ceq 'promoted' -and $Artifact.artifactType -ceq 'skill') {
                                $SkillPath = if (Test-SLProperty $Artifact 'promotionTargetPath') {
                                    [string] $Artifact.promotionTargetPath
                                } else {
                                    $Normalized
                                }
                                $FolderName = $SkillPath.Split('/')[-2]
                                $ExpectedName = Get-SLSkillNameForArtifactId ([string] $Artifact.id)
                                if (
                                    -not (Test-SLSkillName $FolderName) -or
                                    $FolderName -cne $ExpectedName -or
                                    $SkillPath -cne ".github/skills/$FolderName/SKILL.md" -or
                                    (Get-SLProperty $OwnedMarkdown.frontmatter 'name') -cne $FolderName
                                ) {
                                    $Issues.Add((New-SLValidationIssue error 'skill-name' "Promoted skill path and frontmatter name must both use the deterministic lowercase kebab-case name $ExpectedName." $Normalized))
                                }
                            }
                        } catch {
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
        $Issues.Add((New-SLValidationIssue error 'usage-event-json' $_.Exception.Message $script:SLScopeRoot))
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
            [object[]] $Expected = @($ExpectedProjections | Where-Object { (Get-SLScopeKey $_.scope) -ceq (Get-SLScopeKey $Entry.scope) })
            if ($Expected.Count -eq 0) {
                continue
            }
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
    $ResourceReceipts = @()
    try { $ResourceReceipts = @(Get-SLResourceReceipts $Root) } catch {
        $Issues.Add((New-SLValidationIssue error 'resource-receipt-load' $_.Exception.Message $script:SLScopeRoot))
    }
    $ResourceIds = @{}
    $ResourceKeys = @{}
    $ResourceApplications = @{}
    foreach ($Receipt in $ResourceReceipts) {
        $ReceiptPath = Get-SLResourceReceiptPath $Receipt
        if ($ResourceIds.ContainsKey([string] $Receipt.receiptId)) {
            $Issues.Add((New-SLValidationIssue error 'resource-receipt-duplicate-id' "Resource receipt ID is already present at $($ResourceIds[[string] $Receipt.receiptId])." $ReceiptPath))
        }
        $ResourceIds[[string] $Receipt.receiptId] = $ReceiptPath
        if ($ResourceKeys.ContainsKey([string] $Receipt.idempotencyKey) -and $ResourceKeys[[string] $Receipt.idempotencyKey] -cne $ReceiptPath) {
            $Issues.Add((New-SLValidationIssue error 'resource-receipt-duplicate-idempotency' "Resource idempotency key is already present at $($ResourceKeys[[string] $Receipt.idempotencyKey])." $ReceiptPath))
        }
        $ResourceKeys[[string] $Receipt.idempotencyKey] = $ReceiptPath
        if (-not $CatalogKeys.ContainsKey((Get-SLScopeKey $Receipt.scope))) {
            $Issues.Add((New-SLValidationIssue error 'resource-receipt-scope' 'Resource receipt scope is not registered in the generated state catalog.' $ReceiptPath))
        }
        if ($Receipt.phase -ceq 'application') {
            if ($ResourceApplications.ContainsKey([string] $Receipt.applicationId)) {
                $Issues.Add((New-SLValidationIssue error 'resource-receipt-duplicate-application' "Application resource receipt is already present at $($ResourceApplications[[string] $Receipt.applicationId])." $ReceiptPath))
            }
            $ResourceApplications[[string] $Receipt.applicationId] = $ReceiptPath
            $UsageApplication = @($UsageEvents | Where-Object { $_.eventType -ceq 'usage' -and $_.applicationId -ceq $Receipt.applicationId })
            if ($UsageApplication.Count -eq 0 -or @($UsageApplication | Where-Object {
                $_.artifactId -cne $Receipt.artifactId -or
                $_.artifactVersion -cne $Receipt.artifactVersion -or
                $_.artifactContentHash -cne $Receipt.artifactContentHash -or
                $_.taskRunId -cne $Receipt.taskRunId -or
                (Get-SLScopeKey $_.scope) -cne (Get-SLScopeKey $Receipt.scope)
            }).Count -gt 0) {
                $Issues.Add((New-SLValidationIssue error 'resource-receipt-usage-correlation' 'Application resource receipt does not match an immutable usage lifecycle.' $ReceiptPath))
            }
        }
        elseif ($Receipt.phase -ceq 'generation') {
            if (@($Registry.artifacts | Where-Object {
                $_.id -ceq $Receipt.artifactId -and
                (Get-SLScopeKey $_.scope) -ceq (Get-SLScopeKey $Receipt.scope)
            }).Count -eq 0) {
                $Issues.Add((New-SLValidationIssue error 'resource-receipt-artifact' 'Generation resource receipt references an unknown artifact or owning scope.' $ReceiptPath))
            }
        }
    }
    foreach ($Entry in @($StateCatalog.scopes)) {
        $ResourceProjectionPath = [string] $Entry.resourceProjectionPath
        $AbsoluteProjectionPath = Resolve-SLContainedPath -Root $Root -RelativePath $ResourceProjectionPath
        [object[]] $ScopedReceipts = @($ResourceReceipts | Where-Object { (Get-SLScopeKey $_.scope) -ceq (Get-SLScopeKey $Entry.scope) })
        if (-not [IO.File]::Exists($AbsoluteProjectionPath)) {
            if ($ScopedReceipts.Count -eq 0) {
                continue
            }
            $Issues.Add((New-SLValidationIssue error 'missing-resource-projection' 'Generated scope resource projection is missing.' $ResourceProjectionPath))
            continue
        }
        try {
            $Actual = Read-SLJson -Root $Root -RelativePath $ResourceProjectionPath
            [object[]] $ExpectedResourceProjections = @(Get-SLResourceProjection $ScopedReceipts)
            [object[]] $ActualResourceProjections = @($Actual.projections | Where-Object { $null -ne $_ })
            if (
                $Actual.schemaVersion -ne 1 -or
                (Get-SLScopeKey $Actual.scope) -cne (Get-SLScopeKey $Entry.scope) -or
                (ConvertTo-SLCanonicalJson -Value (, $ActualResourceProjections)) -cne (ConvertTo-SLCanonicalJson -Value (, $ExpectedResourceProjections))
            ) {
                $Issues.Add((New-SLValidationIssue error 'resource-projection-drift' 'Generated scope resource projection is stale; run project.' $ResourceProjectionPath))
            }
        }
        catch {
            $Issues.Add((New-SLValidationIssue error 'resource-projection-schema' $_.Exception.Message $ResourceProjectionPath))
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
            $Issues.Add((New-SLValidationIssue error ([string] $Check.code) ([string] $Check.message) '.github/sl-learning/sl-runtime'))
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

function Get-SLRuntimeHelp {
    return [pscustomobject] @{
        name = 'SL'
        runtimeVersion = $script:SLRuntimeVersion
        usage = 'sl.ps1 [--json] [--dry-run] [--repo-root <path>] <command> [arguments] [options]'
        commands = @(
            [pscustomobject] @{ name = 'root'; description = 'Discover the repository root.' }
            [pscustomobject] @{ name = 'scope list|resolve|validate'; description = 'List, resolve, or validate hierarchical scopes.' }
            [pscustomobject] @{ name = 'retrieve'; description = 'Retrieve active guidance in deterministic precedence order.' }
            [pscustomobject] @{ name = 'capture'; description = 'Capture and register lesson evidence.' }
            [pscustomobject] @{ name = 'vote'; description = 'Record a verified useful/not-useful outcome.' }
            [pscustomobject] @{ name = 'use start|finish'; description = 'Record an application lifecycle.' }
            [pscustomobject] @{ name = 'resource import|record|baseline|stats'; description = 'Record and analyze provider-neutral resource receipts.' }
            [pscustomobject] @{ name = 'efficiency'; description = 'Show advisory efficiency metrics and promotion lineage.' }
            [pscustomobject] @{ name = 'project'; description = 'Rebuild state catalogs, registries, indexes, and usage/resource projections.' }
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

function Write-SLRuntimeReportOutput {
    param([Parameter(Mandatory)][AllowNull()][object] $Value)

    [Console]::Out.WriteLine((ConvertTo-SLReportJson -Value $Value))
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
        '--now', '--phase', '--generation-run-id', '--comparison-id',
        '--scenario-key', '--source', '--quality', '--provider', '--model',
        '--input-tokens', '--output-tokens', '--cache-read-tokens',
        '--cache-write-tokens', '--reasoning-tokens', '--wall-clock-ms',
        '--model-ms', '--tool-ms', '--attempts', '--timestamp',
        '--cost-amount', '--cost-currency'
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
        if ($Argument.StartsWith('-') -and $Argument -cne '-') {
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

function Get-SLIntegerOption {
    param([hashtable] $Flags, [string] $Name, [switch] $Required, [switch] $Positive)

    if (-not $Flags.ContainsKey($Name)) {
        if ($Required) { Throw-SLContractError -Code 'usage' -Message "$Name is required." }
        return $null
    }
    $Value = [string] $Flags[$Name]
    if ($Value -cnotmatch '^(0|[1-9][0-9]*)$') {
        Throw-SLContractError -Code 'usage' -Message "$Name must be a non-negative integer."
    }
    [long] $Parsed = 0
    if (-not [long]::TryParse($Value, [ref] $Parsed) -or $Parsed -gt 9007199254740991 -or ($Positive -and $Parsed -lt 1)) {
        Throw-SLContractError -Code 'usage' -Message "$Name must be a $(if ($Positive) { 'positive' } else { 'safe' }) integer."
    }
    return $Parsed
}

function New-SLResourceCliInput {
    param([hashtable] $Flags, [object] $Scope)

    $CostAmount = [string] (Get-SLFlag $Flags '--cost-amount' '')
    $CostCurrency = [string] (Get-SLFlag $Flags '--cost-currency' '')
    if ([bool] $CostAmount -ne [bool] $CostCurrency) {
        Throw-SLContractError -Code 'usage' -Message '--cost-amount and --cost-currency must be supplied together.'
    }
    $Tokens = [ordered] @{
        input = Get-SLIntegerOption $Flags '--input-tokens' -Required
        output = Get-SLIntegerOption $Flags '--output-tokens' -Required
    }
    foreach ($Pair in @(
        @('--cache-read-tokens', 'cacheRead'),
        @('--cache-write-tokens', 'cacheWrite'),
        @('--reasoning-tokens', 'reasoning')
    )) {
        $Value = Get-SLIntegerOption $Flags $Pair[0]
        if ($null -ne $Value) { $Tokens[$Pair[1]] = $Value }
    }
    $ReceiptInput = [ordered] @{
        idempotencyKey = [string] (Get-SLFlag $Flags '--idempotency-key' '')
        source = [string] (Get-SLFlag $Flags '--source' 'manual')
        quality = [string] (Get-SLFlag $Flags '--quality' 'measured')
        provider = [string] (Get-SLFlag $Flags '--provider' '')
        modelId = [string] (Get-SLFlag $Flags '--model' '')
        tokens = [pscustomobject] $Tokens
        wallClockDurationMs = Get-SLIntegerOption $Flags '--wall-clock-ms' -Required -Positive
        timestamp = Get-SLNormalizedTimestamp ([string] (Get-SLFlag $Flags '--timestamp' ''))
        scope = $Scope
    }
    foreach ($Pair in @(
        @('--model-ms', 'modelDurationMs'),
        @('--tool-ms', 'toolDurationMs'),
        @('--attempts', 'attemptCount')
    )) {
        $Value = Get-SLIntegerOption $Flags $Pair[0] -Positive:($Pair[0] -ceq '--attempts')
        if ($null -ne $Value) { $ReceiptInput[$Pair[1]] = $Value }
    }
    $Evidence = [string] (Get-SLFlag $Flags '--evidence-ref' '')
    if ($Evidence) { $ReceiptInput['evidenceRef'] = $Evidence }
    if ($CostAmount) {
        $ReceiptInput['reportedCost'] = [pscustomobject] @{
            amount = $CostAmount
            currency = $CostCurrency.ToUpperInvariant()
            basis = 'host-reported'
        }
    }
    return [pscustomobject] $ReceiptInput
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
        { $_ -cin @('vote', 'use-start', 'use-finish', 'evaluate', 'promotion-evaluate', 'promotion-approve', 'promotion-activate', 'forget', 'undo', 'resource-record') } {
            if ($Positionals.Count -gt 1) { $Positionals[1] } else { $null }
            break
        }
        'promotion-register' {
            if ($Positionals.Count -gt 2) { $Positionals[2] } else { $null }
            break
        }
        'resource-import' {
            if ($Positionals.Count -gt 1) { $Positionals[1] } else { $null }
            break
        }
        'resource-baseline' {
            if ($Positionals.Count -gt 0) { $Positionals[0] } else { $null }
            break
        }
        { $_ -cin @('resource-stats', 'efficiency') } {
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
        'resource-import' {
            if ($Positionals.Count -lt 1) { Throw-SLContractError -Code 'usage' -Message 'resource import requires a JSON input path or -.' }
            $InputText = if ($Positionals[0] -ceq '-') {
                [Console]::In.ReadToEnd()
            } else {
                $InputPath = [IO.Path]::GetFullPath([string] $Positionals[0], (Get-Location).Path)
                [IO.File]::ReadAllText($InputPath, [Text.UTF8Encoding]::new($false, $true))
            }
            if ($InputText.Length -gt 1048576) { Throw-SLContractError -Code 'resource-input' -Message 'Resource input must not exceed 1 MiB.' }
            try {
                $InputValue = if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) {
                    ConvertFrom-Json $InputText -Depth 100 -DateKind String
                } else { ConvertFrom-Json $InputText -Depth 100 }
            } catch { Throw-SLContractError -Code 'resource-input' -Message 'Resource input must be valid JSON.' }
            $Inputs = @(ConvertFrom-SLResourceInput $InputValue)
            Write-SLRuntimeOutput (Import-SLResourceReceipts -Root $Root -Inputs $Inputs -DryRun:$DryRun) -Json:$Json
        }
        'resource-record' {
            if ($Positionals.Count -lt 1) { Throw-SLContractError -Code 'usage' -Message 'resource record requires an artifact ID.' }
            $ArtifactId = [string] $Positionals[0]
            $Phase = [string] (Get-SLFlag $Flags '--phase' '')
            if ($Phase -cnotin @('generation', 'application')) { Throw-SLContractError -Code 'usage' -Message '--phase must be generation or application.' }
            $ComparisonId = [string] (Get-SLFlag $Flags '--comparison-id' '')
            $ScenarioKey = [string] (Get-SLFlag $Flags '--scenario-key' '')
            if ([bool] $ComparisonId -ne [bool] $ScenarioKey) { Throw-SLContractError -Code 'usage' -Message '--comparison-id and --scenario-key must be supplied together.' }
            if ($Phase -ceq 'generation') {
                $GenerationRunId = [string] (Get-SLFlag $Flags '--generation-run-id' '')
                if (-not $GenerationRunId) { Throw-SLContractError -Code 'usage' -Message '--generation-run-id is required for generation receipts.' }
                if ((Get-SLFlag $Flags '--application-id' '') -or $ComparisonId) { Throw-SLContractError -Code 'usage' -Message 'Generation receipts do not accept application or comparison options.' }
                $Registry = Get-SLRegistry $Root
                $Artifact = Find-SLArtifact $Registry $ArtifactId
                if (-not $Artifact.path) { Throw-SLContractError -Code 'resource-correlation' -Message "Generation resource receipt artifact has no active path: $ArtifactId." }
                $Hash = Get-SLArtifactUsageContentHash (Read-SLSafeText -Root $Root -RelativePath ([string] $Artifact.path))
                $ReceiptInput = New-SLResourceCliInput $Flags (Normalize-SLScope $Artifact.scope)
                Set-SLProperty $ReceiptInput 'phase' 'generation'; Set-SLProperty $ReceiptInput 'artifactId' $ArtifactId
                Set-SLProperty $ReceiptInput 'artifactContentHash' $Hash; Set-SLProperty $ReceiptInput 'generationRunId' $GenerationRunId
            } else {
                if (Get-SLFlag $Flags '--generation-run-id' '') { Throw-SLContractError -Code 'usage' -Message 'Application receipts do not accept --generation-run-id.' }
                $ApplicationId = [string] (Get-SLFlag $Flags '--application-id' '')
                if (-not $ApplicationId) { Throw-SLContractError -Code 'usage' -Message '--application-id is required for application receipts.' }
                $Events = @(Get-SLUsageEvents $Root | Where-Object { $_.eventType -ceq 'usage' -and $_.applicationId -ceq $ApplicationId })
                if ($Events.Count -eq 0) { Throw-SLContractError -Code 'resource-correlation' -Message "Application resource receipt has no usage lifecycle: $ApplicationId" }
                $First = $Events[0]
                if ($First.artifactId -cne $ArtifactId) { Throw-SLContractError -Code 'resource-correlation' -Message "Application $ApplicationId belongs to $($First.artifactId), not $ArtifactId." }
                $ReceiptInput = New-SLResourceCliInput $Flags (Normalize-SLScope $First.scope)
                Set-SLProperty $ReceiptInput 'phase' 'application'; Set-SLProperty $ReceiptInput 'artifactId' $ArtifactId
                Set-SLProperty $ReceiptInput 'artifactContentHash' $First.artifactContentHash
                Set-SLProperty $ReceiptInput 'taskRunId' $First.taskRunId; Set-SLProperty $ReceiptInput 'applicationId' $ApplicationId
                if ($ComparisonId) { Set-SLProperty $ReceiptInput 'comparison' ([pscustomobject] @{ comparisonId=$ComparisonId; scenarioKey=$ScenarioKey; role='treatment' }) }
            }
            Write-SLRuntimeOutput (Import-SLResourceReceipts -Root $Root -Inputs @($ReceiptInput) -DryRun:$DryRun) -Json:$Json
        }
        'resource-baseline' {
            $TaskRunId = [string] (Get-SLFlag $Flags '--task-run-id' '')
            $ComparisonId = [string] (Get-SLFlag $Flags '--comparison-id' '')
            $ScenarioKey = [string] (Get-SLFlag $Flags '--scenario-key' '')
            if (-not $TaskRunId -or -not $ComparisonId -or -not $ScenarioKey) { Throw-SLContractError -Code 'usage' -Message 'resource baseline requires --task-run-id, --comparison-id, and --scenario-key.' }
            $Scope = Get-SLApplicationScopeOption $Root $Flags
            if ($null -eq $Scope) { $Scope = (Resolve-SLScopeDescriptor -Root $Root -TargetPath '.').scope }
            $ReceiptInput = New-SLResourceCliInput $Flags $Scope
            Set-SLProperty $ReceiptInput 'phase' 'baseline'; Set-SLProperty $ReceiptInput 'taskRunId' $TaskRunId
            Set-SLProperty $ReceiptInput 'comparison' ([pscustomobject] @{ comparisonId=$ComparisonId; scenarioKey=$ScenarioKey; role='baseline' })
            Write-SLRuntimeOutput (Import-SLResourceReceipts -Root $Root -Inputs @($ReceiptInput) -DryRun:$DryRun) -Json:$Json
        }
        { $_ -cin @('resource-stats', 'efficiency') } {
            $ArtifactId = if ($Positionals.Count -gt 0 -and $Positionals[0].StartsWith('SL-')) { [string] $Positionals[0] } else { $null }
            $Report = Get-SLEfficiencyReport -Root $Root -ArtifactId $ArtifactId -ScopeId ([string] (Get-SLFlag $Flags '--scope' '')) -Provider ([string] (Get-SLFlag $Flags '--provider' '')) -ModelId ([string] (Get-SLFlag $Flags '--model' '')) -Quality ([string] (Get-SLFlag $Flags '--quality' ''))
            Write-SLRuntimeReportOutput $Report
        }
        { $_ -cin @('project', 'index') } {
            $Changes = [System.Collections.Generic.List[object]]::new()
            [void] (Invoke-SLWithMutationLock -Root $Root -DryRun:$DryRun -Operation {
                [void] (Sync-SLProjection -Root $Root -DryRun:$DryRun -Changes $Changes)
                Sync-SLResourceProjection -Root $Root -DryRun:$DryRun -Changes $Changes
            })
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
        elseif ($Command -ceq 'resource') {
            if ($Positionals.Count -eq 0) { Throw-SLContractError -Code 'usage' -Message 'resource requires import, record, baseline, or stats.' }
            $Subcommand = [string] $Positionals[0]
            $Positionals.RemoveAt(0)
            $Command = "resource-$Subcommand"
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
