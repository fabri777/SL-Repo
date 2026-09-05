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
        if ($Normalized -cne $File.path -or $File.path -ceq 'SL-runtime.manifest.json') {
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
}

function Test-SLRuntimeInstallation {
    param(
        [Parameter(Mandatory)]
        [string] $RuntimeHome,

        [Parameter(Mandatory)]
        [string] $ExpectedRuntimeVersion
    )

    $Checks = [System.Collections.Generic.List[object]]::new()
    $ManifestPath = [IO.Path]::Combine($RuntimeHome, 'SL-runtime.manifest.json')
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
            $Name -cne 'SL-runtime.manifest.json' -and
            -not $ManagedPaths.Contains($Name) -and
            (
                $Name -cmatch '^SL\.Runtime\..+\.(?:ps1|psm1)$' -or
                $Name -cin @(
                    'SL.ps1',
                    'SL.sh',
                    'SL-conformance-vectors.json',
                    'SL-runtime-manifest.schema.json'
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
    $BashPath = [IO.Path]::Combine($RuntimeHome, 'SL.sh')
    if ([IO.File]::Exists($BashPath)) {
        $Bash = [IO.File]::ReadAllText($BashPath)
        if (
            $Bash -notmatch 'exec pwsh' -or
            $Bash -match '\b(?:node|npm|npx|sl-repo)\b'
        ) {
            $Checks.Add([pscustomobject] @{
                status = 'error'
                code = 'runtime-bash-launcher'
                message = 'Bash launcher must delegate only to repository-local SL.ps1 through pwsh.'
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
