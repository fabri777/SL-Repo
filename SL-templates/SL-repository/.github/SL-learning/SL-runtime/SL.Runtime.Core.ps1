Set-StrictMode -Version Latest

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
        $Names = [string[]] @($Value.PSObject.Properties.Name)
        [Array]::Sort($Names, [StringComparer]::Ordinal)
        $Parts = foreach ($Name in $Names) {
            "$(ConvertTo-SLJsonString -Value $Name):$(ConvertTo-SLCanonicalJson -Value $Value.$Name)"
        }
        return "{$($Parts -join ',')}"
    }
    Throw-SLContractError -Code 'canonical-json-type' -Message "Canonical JSON does not support $($Value.GetType().FullName)."
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

    $Path = Resolve-SLContainedPath -Root $Root -RelativePath $RelativePath
    $Normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    if ($DryRun) {
        return [pscustomobject] @{ action = 'planned'; path = (ConvertTo-SLNormalizedPath $RelativePath) }
    }
    $Directory = [IO.Path]::GetDirectoryName($Path)
    [IO.Directory]::CreateDirectory($Directory) | Out-Null
    $TemporaryPath = "$Path.SL-tmp-$([Guid]::NewGuid().ToString('N'))"
    try {
        [IO.File]::WriteAllText($TemporaryPath, $Normalized, [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($TemporaryPath, $Path, $true)
    }
    finally {
        if ([IO.File]::Exists($TemporaryPath)) {
            [IO.File]::Delete($TemporaryPath)
        }
    }
    return [pscustomobject] @{ action = 'written'; path = (ConvertTo-SLNormalizedPath $RelativePath) }
}
