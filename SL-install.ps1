[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Release,

    [string]$Repository = "ffishkel_microsoft/SL",

    [string]$InstallRoot = $(if ($env:LOCALAPPDATA) {
        Join-Path $env:LOCALAPPDATA "SL-Repo"
    } else {
        Join-Path $HOME ".sl-repo"
    }),

    [string]$AssetDirectory,

    [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-SLArchitecture {
    switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
        "X64" { return "x64" }
        "Arm64" { return "arm64" }
        default { throw "Unsupported Windows architecture: $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)" }
    }
}

function Get-SLFileSha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $stream = [System.IO.File]::OpenRead($Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $algorithm.ComputeHash($stream)
        return ([System.BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
    } finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

function Copy-SLAsset {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    if ($AssetDirectory) {
        $source = Join-Path $AssetDirectory $Name
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Missing local release asset: $source"
        }
        Copy-Item -LiteralPath $source -Destination $Destination
        return
    }

    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw "GitHub CLI is required for private release downloads. Authenticate with 'gh auth login', or use -AssetDirectory."
    }
    & gh release download $Release --repo $Repository --pattern $Name --dir $Destination --clobber
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to download $Name from $Repository release $Release."
    }
}

$version = $Release.TrimStart("v")
if ($version -notmatch "^[0-9A-Za-z][0-9A-Za-z._-]*$") {
    throw "Invalid release version: $Release"
}

$platform = "windows"
$architecture = Get-SLArchitecture
$assetName = "sl-repo-$version-$platform-$architecture.tar.gz"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "SL-install-$([guid]::NewGuid())"
$downloadRoot = Join-Path $temporaryRoot "download"
$extractRoot = Join-Path $temporaryRoot "extract"

try {
    New-Item -ItemType Directory -Path $downloadRoot, $extractRoot -Force | Out-Null
    Copy-SLAsset -Name "SL-release-manifest.json" -Destination $downloadRoot
    Copy-SLAsset -Name "SL-checksums.txt" -Destination $downloadRoot
    Copy-SLAsset -Name $assetName -Destination $downloadRoot

    $manifestPath = Join-Path $downloadRoot "SL-release-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifestAsset = @(
        $manifest.assets | Where-Object {
            $_.platform -eq $platform -and
            $_.architecture -eq $architecture -and
            $_.fileName -eq $assetName
        }
    )
    if (
        $manifest.schemaVersion -ne 1 -or
        $manifest.version -ne $version -or
        $manifest.sourceCommit -notmatch "^[0-9a-f]{40}$" -or
        $manifestAsset.Count -ne 1
    ) {
        throw "Release manifest does not match $Release for $platform-$architecture."
    }

    $checksumPath = Join-Path $downloadRoot "SL-checksums.txt"
    $archivePath = Join-Path $downloadRoot $assetName
    $checksumLine = Get-Content -LiteralPath $checksumPath |
        Where-Object { $_ -match "^[0-9a-fA-F]{64}\s\s$([regex]::Escape($assetName))$" } |
        Select-Object -First 1
    if (-not $checksumLine) {
        throw "No checksum was published for $assetName."
    }
    $expectedHash = ($checksumLine -split "\s+")[0].ToLowerInvariant()
    $actualHash = Get-SLFileSha256 -Path $archivePath
    if ($actualHash -ne $expectedHash) {
        throw "SHA-256 verification failed for $assetName."
    }
    if (
        $manifestAsset[0].sha256 -ne $expectedHash -or
        $manifestAsset[0].size -ne (Get-Item -LiteralPath $archivePath).Length
    ) {
        throw "Release manifest integrity metadata does not match $assetName."
    }

    if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
        throw "The Windows tar utility is required to extract the portable archive."
    }
    & tar -xzf $archivePath -C $extractRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to extract $assetName."
    }

    $rootDirectory = "sl-repo-$version-$platform-$architecture"
    $stagedRoot = Join-Path $extractRoot $rootDirectory
    $releaseMetadata = Join-Path $stagedRoot "SL-release.json"
    $portableLauncher = Join-Path $stagedRoot "bin\sl-repo.cmd"
    if (
        -not (Test-Path -LiteralPath $releaseMetadata -PathType Leaf) -or
        -not (Test-Path -LiteralPath $portableLauncher -PathType Leaf)
    ) {
        throw "Portable archive does not contain the expected SL Repo layout."
    }
    $releaseDescriptor = Get-Content -LiteralPath $releaseMetadata -Raw | ConvertFrom-Json
    if (
        $releaseDescriptor.version -ne $manifest.version -or
        $releaseDescriptor.sourceCommit -ne $manifest.sourceCommit -or
        $releaseDescriptor.nodeVersion -ne $manifest.nodeVersion -or
        $releaseDescriptor.platform -ne $platform -or
        $releaseDescriptor.architecture -ne $architecture -or
        $releaseDescriptor.fileName -ne $assetName
    ) {
        throw "Portable archive metadata does not match the release manifest."
    }

    $destinationRelative = "versions\$version\$platform-$architecture"
    $destinationRoot = Join-Path $InstallRoot $destinationRelative
    New-Item -ItemType Directory -Path (Split-Path $destinationRoot -Parent) -Force | Out-Null
    if ((Test-Path -LiteralPath $destinationRoot) -and -not $Force) {
        throw "SL Repo $version is already installed at $destinationRoot. Use -Force to replace it."
    }

    $backupRoot = "$destinationRoot.SL-backup-$([guid]::NewGuid())"
    $hasBackup = $false
    if (Test-Path -LiteralPath $destinationRoot) {
        Move-Item -LiteralPath $destinationRoot -Destination $backupRoot
        $hasBackup = $true
    }
    try {
        Move-Item -LiteralPath $stagedRoot -Destination $destinationRoot
    } catch {
        if ($hasBackup -and -not (Test-Path -LiteralPath $destinationRoot)) {
            Move-Item -LiteralPath $backupRoot -Destination $destinationRoot
        }
        throw
    }
    if ($hasBackup) {
        Remove-Item -LiteralPath $backupRoot -Recurse -Force
    }

    $binRoot = Join-Path $InstallRoot "bin"
    New-Item -ItemType Directory -Path $binRoot -Force | Out-Null
    $wrapperPath = Join-Path $binRoot "sl-repo.cmd"
    $wrapperTemporaryPath = "$wrapperPath.SL-tmp-$([guid]::NewGuid())"
    @(
        "@echo off"
        "setlocal"
        "set /p SL_CURRENT=<`"%~dp0..\current`""
        "call `"%~dp0..\%SL_CURRENT%\bin\sl-repo.cmd`" %*"
        ""
    ) -join "`n" | Set-Content -LiteralPath $wrapperTemporaryPath -Encoding Ascii -NoNewline
    Move-Item -LiteralPath $wrapperTemporaryPath -Destination $wrapperPath -Force

    $currentPath = Join-Path $InstallRoot "current"
    $currentTemporaryPath = "$currentPath.SL-tmp-$([guid]::NewGuid())"
    Set-Content -LiteralPath $currentTemporaryPath -Value $destinationRelative -Encoding Ascii -NoNewline
    Move-Item -LiteralPath $currentTemporaryPath -Destination $currentPath -Force

    Write-Output "Installed SL Repo $version to $destinationRoot"
    Write-Output "Add '$binRoot' to PATH, then run:"
    Write-Output "  sl-repo init C:\path\to\repository --dry-run"
    Write-Output "  sl-repo init C:\path\to\repository"
    Write-Output "  sl-repo doctor C:\path\to\repository"
    Write-Output "  sl-repo validate C:\path\to\repository"
} finally {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
