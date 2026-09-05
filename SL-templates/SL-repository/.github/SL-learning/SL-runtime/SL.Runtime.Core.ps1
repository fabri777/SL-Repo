Set-StrictMode -Version Latest

$script:SLActiveMutationLockPath = $null

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
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Target)) | Out-Null
        [IO.File]::Move($Source, $Target)
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
        [IO.File]::Delete($Path)
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
    $RelativeLock = '.github/SL-learning/.SL-repository-mutation.lock'
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
        return & $Operation
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
