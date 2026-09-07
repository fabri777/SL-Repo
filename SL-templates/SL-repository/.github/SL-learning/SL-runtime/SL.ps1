$JsonRequested = @($args | Where-Object { $_ -ceq '--json' }).Count -gt 0
if ($PSVersionTable.PSVersion.Major -lt 7) {
    if ($JsonRequested) {
        [Console]::Error.WriteLine('{"error":{"code":"powershell-version","message":"SL requires PowerShell 7.0.0 or newer."}}')
    }
    else {
        [Console]::Error.WriteLine('SL requires PowerShell 7.0.0 or newer.')
    }
    exit 3
}

$RuntimeHome = Split-Path -Parent $PSCommandPath
$ExpectedRuntimeVersion = '0.5.0'
$ExpectedPayloadFiles = [string[]] @(
    'SL-conformance-vectors.json',
    'SL-runtime-manifest.schema.json',
    'SL.Runtime.Artifacts.ps1',
    'SL.Runtime.Conformance.ps1',
    'SL.Runtime.Core.ps1',
    'SL.Runtime.Doctor.ps1',
    'SL.Runtime.Lifecycle.ps1',
    'SL.Runtime.Promotion.ps1',
    'SL.Runtime.Resource.ps1',
    'SL.Runtime.State.ps1',
    'SL.Runtime.Syntax.ps1',
    'SL.Runtime.Validation.ps1',
    'SL.Runtime.psm1',
    'SL.ps1',
    'SL.sh'
)

function Write-SLBootstrapFailure {
    param(
        [Parameter(Mandatory)][string] $Code,
        [Parameter(Mandatory)][string] $Message,
        [Parameter(Mandatory)][int] $ExitCode
    )

    if ($JsonRequested) {
        [Console]::Out.WriteLine((ConvertTo-Json ([ordered] @{
            command = 'bootstrap'
            healthy = $false
            checks = @([ordered] @{
                status = 'error'
                code = $Code
                message = $Message
            })
        }) -Depth 10 -Compress))
    }
    else {
        [Console]::Error.WriteLine($Message)
    }
    exit $ExitCode
}

function Get-SLBootstrapFileHash {
    param([Parameter(Mandatory)][string] $Path)

    $Content = [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false, $true))
    $Normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    $Bytes = [Text.Encoding]::UTF8.GetBytes($Normalized)
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()
}

$ManifestPath = Join-Path $RuntimeHome 'SL-runtime.manifest.json'
if (-not [IO.File]::Exists($ManifestPath)) {
    Write-SLBootstrapFailure -Code 'runtime-manifest-missing' -Message 'SL runtime manifest is missing.' -ExitCode 5
}

try {
    $Manifest = ConvertFrom-Json -InputObject (
        [IO.File]::ReadAllText($ManifestPath, [Text.UTF8Encoding]::new($false, $true))
    ) -Depth 100
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
    if (
        ($ActualProperties -join ',') -cne ($ExpectedProperties -join ',') -or
        $Manifest.schemaVersion -ne 1 -or
        [string] $Manifest.runtimeVersion -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
        [string] $Manifest.sourceReleaseCommit -cnotmatch '^(?:[0-9a-f]{40}|__SL_SOURCE_RELEASE_COMMIT__)$' -or
        $Manifest.configContractVersion -isnot [long] -or
        $Manifest.configContractVersion -lt 1 -or
        $Manifest.conformanceVersion -isnot [long] -or
        $Manifest.conformanceVersion -lt 1 -or
        [string] $Manifest.minimumPowerShellVersion -cne '7.0.0' -or
        $Manifest.files -isnot [array]
    ) {
        throw 'Runtime manifest does not match the bootstrap contract.'
    }
    if ([string] $Manifest.runtimeVersion -cne $ExpectedRuntimeVersion) {
        Write-SLBootstrapFailure -Code 'runtime-mixed-version' -Message (
            "Bootstrap runtime $ExpectedRuntimeVersion does not match manifest $($Manifest.runtimeVersion)."
        ) -ExitCode 7
    }
    $ActualPayloadFiles = [string[]] @($Manifest.files | ForEach-Object { [string] $_.path })
    if (
        $ActualPayloadFiles.Count -ne $ExpectedPayloadFiles.Count -or
        [string]::Join([char] 0, $ActualPayloadFiles) -cne [string]::Join([char] 0, $ExpectedPayloadFiles)
    ) {
        throw 'Runtime manifest payload inventory does not match the bootstrap contract.'
    }
    foreach ($File in $Manifest.files) {
        $Properties = [string[]] @($File.PSObject.Properties.Name)
        [Array]::Sort($Properties, [StringComparer]::Ordinal)
        if (
            ($Properties -join ',') -cne 'path,sha256' -or
            $File.path -isnot [string] -or
            $File.sha256 -isnot [string] -or
            $File.sha256 -cnotmatch '^[0-9a-f]{64}$'
        ) {
            throw 'Runtime manifest contains an invalid payload entry.'
        }
        $PayloadPath = Join-Path $RuntimeHome $File.path
        if (-not [IO.File]::Exists($PayloadPath)) {
            Write-SLBootstrapFailure -Code 'runtime-file-missing' -Message "Runtime file is missing: $($File.path)" -ExitCode 6
        }
        if ((Get-SLBootstrapFileHash -Path $PayloadPath) -cne $File.sha256) {
            Write-SLBootstrapFailure -Code 'runtime-hash-drift' -Message "Runtime file hash drift: $($File.path)" -ExitCode 6
        }
    }
}
catch {
    Write-SLBootstrapFailure -Code 'runtime-manifest-invalid' -Message $_.Exception.Message -ExitCode 5
}

try {
    Import-Module (Join-Path $RuntimeHome 'SL.Runtime.psm1') -Force -DisableNameChecking -ErrorAction Stop
    exit (Invoke-SLRuntime -Arguments $args -RuntimeHome $RuntimeHome)
}
catch {
    if ($JsonRequested) {
        $Message = $_.Exception.Message.Replace('\', '\\').Replace('"', '\"')
        [Console]::Error.WriteLine("{`"error`":{`"code`":`"runtime-internal`",`"message`":`"$Message`"}}")
    }
    else {
        [Console]::Error.WriteLine($_.Exception.Message)
    }
    exit 10
}
