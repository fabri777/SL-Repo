#!/usr/bin/env pwsh

param(
    [Parameter(Position = 0)]
    [string]$Command = "help",

    [Parameter(Position = 1)]
    [string]$RepoPath,

    [string]$Release = "v0.6.0",

    [string]$Repository = "fabri777/SL-Repo",

    [ValidateSet("none", "github", "azure", "all")]
    [string]$Automation,

    [string]$AssetDirectory,

    [switch]$Yes
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$SL_VERSION = "0.6.0"
$SL_RELEASE_MANIFEST = "sl-release-manifest.json"
$SL_CHECKSUMS = "sl-checksums.txt"

function Test-SLWindows {
    return [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
        [System.Runtime.InteropServices.OSPlatform]::Windows
    )
}

function Get-SLPlatform {
    if (Test-SLWindows) {
        return "windows"
    }
    if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
        [System.Runtime.InteropServices.OSPlatform]::Linux
    )) {
        return "linux"
    }
    if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
        [System.Runtime.InteropServices.OSPlatform]::OSX
    )) {
        return "darwin"
    }
    throw "Unsupported operating system."
}

function Get-SLArchitecture {
    switch (
        [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    ) {
        "X64" { return "x64" }
        "Arm64" { return "arm64" }
        default {
            throw "Unsupported architecture: $(
                [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
            )"
        }
    }
}

function Get-SLFileSha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $Stream = [System.IO.File]::OpenRead($Path)
    $Algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $Hash = $Algorithm.ComputeHash($Stream)
        return [Convert]::ToHexString($Hash).ToLowerInvariant()
    }
    finally {
        $Algorithm.Dispose()
        $Stream.Dispose()
    }
}

function Assert-SLRegularFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $Item = Get-Item -LiteralPath $Path -Force
    if (
        $Item.PSIsContainer -or
        ($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
        -not [string]::IsNullOrWhiteSpace([string]$Item.LinkType)
    ) {
        throw "$Description must be a regular file and cannot be a symlink or reparse point."
    }
}

function Get-SLInstallDestination {
    if (Test-SLWindows) {
        if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
            throw "LOCALAPPDATA is required on Windows."
        }
        return Join-Path $env:LOCALAPPDATA "sl\bin\sl.ps1"
    }

    if ([string]::IsNullOrWhiteSpace($HOME)) {
        throw "HOME is required on Unix."
    }
    return Join-Path $HOME ".local/bin/sl"
}

function Test-SLPathContains {
    param(
        [AllowEmptyString()]
        [string]$PathValue,

        [Parameter(Mandatory = $true)]
        [string]$Directory
    )

    $Comparison = if (Test-SLWindows) {
        [StringComparison]::OrdinalIgnoreCase
    }
    else {
        [StringComparison]::Ordinal
    }
    $Expected = [System.IO.Path]::GetFullPath($Directory).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    foreach ($Entry in @($PathValue -split [System.IO.Path]::PathSeparator)) {
        if ([string]::IsNullOrWhiteSpace($Entry)) {
            continue
        }
        $Expanded = [Environment]::ExpandEnvironmentVariables(
            $Entry.Trim().Trim('"')
        )
        try {
            $Candidate = [System.IO.Path]::GetFullPath($Expanded).TrimEnd(
                [System.IO.Path]::DirectorySeparatorChar,
                [System.IO.Path]::AltDirectorySeparatorChar
            )
        }
        catch {
            continue
        }
        if ($Candidate.Equals($Expected, $Comparison)) {
            return $true
        }
    }
    return $false
}

function Add-SLProcessPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Directory
    )

    if (-not (Test-SLPathContains -PathValue $env:PATH -Directory $Directory)) {
        $env:PATH = "$Directory$([System.IO.Path]::PathSeparator)$env:PATH"
    }
}

function Add-SLUnixProfilePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Directory
    )

    $ShellName = [System.IO.Path]::GetFileName([string]$env:SHELL)
    if ($ShellName -ceq "fish") {
        $ProfilePath = Join-Path $HOME ".config/fish/conf.d/sl.fish"
        $ProfileLine = 'fish_add_path "$HOME/.local/bin"'
    }
    elseif ($ShellName -ceq "zsh") {
        $ProfilePath = Join-Path $HOME ".zprofile"
        $ProfileLine = 'export PATH="$HOME/.local/bin:$PATH" # Added by sl'
    }
    elseif (
        $ShellName -ceq "bash" -and
        (Test-Path -LiteralPath (Join-Path $HOME ".bash_profile") -PathType Leaf)
    ) {
        $ProfilePath = Join-Path $HOME ".bash_profile"
        $ProfileLine = 'export PATH="$HOME/.local/bin:$PATH" # Added by sl'
    }
    else {
        $ProfilePath = Join-Path $HOME ".profile"
        $ProfileLine = 'export PATH="$HOME/.local/bin:$PATH" # Added by sl'
    }

    $ProfileDirectory = Split-Path -Parent $ProfilePath
    New-Item -ItemType Directory -Path $ProfileDirectory -Force | Out-Null
    $ExistingLines = if (Test-Path -LiteralPath $ProfilePath -PathType Leaf) {
        [System.IO.File]::ReadAllLines($ProfilePath)
    }
    else {
        [string[]]@()
    }
    if ($ProfileLine -cnotin $ExistingLines) {
        $Prefix = if (
            $ExistingLines.Count -eq 0 -or
            [string]::IsNullOrEmpty($ExistingLines[-1])
        ) {
            ""
        }
        else {
            [Environment]::NewLine
        }
        [System.IO.File]::AppendAllText(
            $ProfilePath,
            "$Prefix$ProfileLine$([Environment]::NewLine)",
            [System.Text.UTF8Encoding]::new($false)
        )
        Write-Output "Added '$Directory' to user PATH in '$ProfilePath'."
    }
    else {
        Write-Output "Confirmed '$Directory' in user PATH configuration '$ProfilePath'."
    }
}

function Confirm-SLUserPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Directory
    )

    if (Test-SLWindows) {
        $UserPath = [Environment]::GetEnvironmentVariable(
            "Path",
            [EnvironmentVariableTarget]::User
        )
        if (-not (Test-SLPathContains -PathValue $UserPath -Directory $Directory)) {
            $NewUserPath = if ([string]::IsNullOrWhiteSpace($UserPath)) {
                $Directory
            }
            else {
                "$UserPath$([System.IO.Path]::PathSeparator)$Directory"
            }
            [Environment]::SetEnvironmentVariable(
                "Path",
                $NewUserPath,
                [EnvironmentVariableTarget]::User
            )
            $ConfirmedPath = [Environment]::GetEnvironmentVariable(
                "Path",
                [EnvironmentVariableTarget]::User
            )
            if (-not (
                Test-SLPathContains `
                    -PathValue $ConfirmedPath `
                    -Directory $Directory
            )) {
                throw "Failed to add '$Directory' to the user PATH."
            }
            Write-Output "Added '$Directory' to the user PATH."
            Write-Output "Open a new terminal to use the updated user PATH."
        }
        else {
            Write-Output "Confirmed '$Directory' is already on the user PATH."
        }
    }
    elseif (Test-SLPathContains -PathValue $env:PATH -Directory $Directory) {
        Write-Output "Confirmed '$Directory' is already on PATH."
    }
    else {
        Add-SLUnixProfilePath -Directory $Directory
        Write-Output "Open a new terminal to use the updated PATH configuration."
    }

    Add-SLProcessPath -Directory $Directory
}

function Get-SLExactChild {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Parent,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [ValidateSet("Any", "File", "Directory")]
        [string]$Kind = "Any"
    )

    if (-not (Test-Path -LiteralPath $Parent -PathType Container)) {
        return $null
    }

    foreach ($Child in Get-ChildItem -LiteralPath $Parent -Force) {
        if ($Child.Name -cne $Name) {
            continue
        }
        if ($Kind -eq "File" -and -not $Child.PSIsContainer) {
            return $Child.FullName
        }
        if ($Kind -eq "Directory" -and $Child.PSIsContainer) {
            return $Child.FullName
        }
        if ($Kind -eq "Any") {
            return $Child.FullName
        }
    }

    return $null
}

function Resolve-SLRepositoryPath {
    param(
        [AllowEmptyString()]
        [string]$Path
    )

    $Candidate = if ([string]::IsNullOrWhiteSpace($Path)) {
        (Get-Location).Path
    }
    else {
        $Path
    }
    if (-not (Test-Path -LiteralPath $Candidate -PathType Container)) {
        throw "Repository path is not a directory: $Candidate"
    }

    $Resolved = (Resolve-Path -LiteralPath $Candidate).ProviderPath
    if (-not (Test-Path -LiteralPath (Join-Path $Resolved ".git"))) {
        throw "The target is not a Git repository: $Resolved"
    }
    return $Resolved
}

function Assert-SLLearningPathCasing {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot
    )

    $GitHubRoot = Join-Path $RepositoryRoot ".github"
    if (-not (Test-Path -LiteralPath $GitHubRoot -PathType Container)) {
        return
    }

    foreach ($Child in Get-ChildItem -LiteralPath $GitHubRoot -Force -Directory) {
        if ($Child.Name -ceq "SL-learning") {
            throw "Unsupported path '.github/SL-learning' is present. Remove or resolve it manually before using initrepo."
        }
        if ($Child.Name -ieq "sl-learning" -and $Child.Name -cne "sl-learning") {
            throw "The SL learning directory must use exact lowercase casing: '.github/sl-learning'."
        }
    }
}

function Get-SLLearningRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot
    )

    $GitHubRoot = Get-SLExactChild `
        -Parent $RepositoryRoot `
        -Name ".github" `
        -Kind Directory
    if (-not $GitHubRoot) {
        return $null
    }
    return Get-SLExactChild `
        -Parent $GitHubRoot `
        -Name "sl-learning" `
        -Kind Directory
}

function Get-SLRepositoryRuntime {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot
    )

    Assert-SLLearningPathCasing -RepositoryRoot $RepositoryRoot
    $LearningRoot = Get-SLLearningRoot -RepositoryRoot $RepositoryRoot
    if (-not $LearningRoot) {
        throw "SL is not initialized at '$RepositoryRoot'. Expected '.github/sl-learning'."
    }

    $RuntimeRoot = Get-SLExactChild `
        -Parent $LearningRoot `
        -Name "sl-runtime" `
        -Kind Directory
    if (-not $RuntimeRoot) {
        throw "SL runtime directory is missing: '.github/sl-learning/sl-runtime'."
    }

    $RuntimePath = Get-SLExactChild `
        -Parent $RuntimeRoot `
        -Name "sl.ps1" `
        -Kind File
    if (-not $RuntimePath) {
        throw "SL runtime entry point is missing: '.github/sl-learning/sl-runtime/sl.ps1'."
    }
    return $RuntimePath
}

function Invoke-SLRepositoryRuntime {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot,

        [Parameter(Mandatory = $true)]
        [ValidateSet("doctor", "project", "validate")]
        [string]$RuntimeCommand
    )

    $RuntimePath = Get-SLRepositoryRuntime -RepositoryRoot $RepositoryRoot
    $PowerShell = Get-Command pwsh -CommandType Application -ErrorAction SilentlyContinue
    if (-not $PowerShell) {
        throw "PowerShell 7 is required."
    }

    & $PowerShell.Source `
        -NoLogo `
        -NoProfile `
        -File $RuntimePath `
        $RuntimeCommand `
        --repo-root $RepositoryRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Repository-local SL runtime command '$RuntimeCommand' failed with exit code $LASTEXITCODE."
    }
}

function Copy-SLReleaseAsset {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$DestinationDirectory,

        [AllowEmptyString()]
        [string]$LocalAssetDirectory
    )

    if (-not [string]::IsNullOrWhiteSpace($LocalAssetDirectory)) {
        $ResolvedAssetDirectory = (
            Resolve-Path -LiteralPath $LocalAssetDirectory
        ).ProviderPath
        $Source = Get-SLExactChild `
            -Parent $ResolvedAssetDirectory `
            -Name $Name `
            -Kind File
        if (-not $Source) {
            throw "Missing lowercase local release asset: $Name"
        }
        [System.IO.File]::Copy(
            $Source,
            (Join-Path $DestinationDirectory $Name),
            $false
        )
        return
    }

    $GitHub = Get-Command gh -CommandType Application -ErrorAction SilentlyContinue
    if (-not $GitHub) {
        throw "GitHub CLI is required. Authenticate with 'gh auth login', or use -AssetDirectory."
    }
    & $GitHub.Source release download $Release `
        --repo $Repository `
        --pattern $Name `
        --dir $DestinationDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to download release asset '$Name'."
    }
}

function Assert-SLReleaseSelection {
    if ($Release -cnotmatch "^v?[0-9A-Za-z][0-9A-Za-z._-]*$") {
        throw "Invalid release tag."
    }
    if ($Repository -cnotmatch "^[0-9A-Za-z_.-]+/[0-9A-Za-z_.-]+$") {
        throw "Repository must use the 'owner/name' form."
    }
    if (
        -not [string]::IsNullOrWhiteSpace($AssetDirectory) -and
        -not (Test-Path -LiteralPath $AssetDirectory -PathType Container)
    ) {
        throw "Asset directory is not a directory: $AssetDirectory"
    }
}

function Get-SLPublishedChecksum {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ChecksumsPath,

        [Parameter(Mandatory = $true)]
        [string]$AssetName
    )

    $ChecksumMatches = [System.Collections.Generic.List[string]]::new()
    foreach ($Line in [System.IO.File]::ReadAllLines($ChecksumsPath)) {
        if (
            $Line -cmatch "^([0-9a-fA-F]{64})  (.+)$" -and
            $Matches[2] -ceq $AssetName
        ) {
            $ChecksumMatches.Add($Matches[1].ToLowerInvariant())
        }
    }
    if ($ChecksumMatches.Count -ne 1) {
        throw "Expected exactly one checksum for '$AssetName'."
    }
    return $ChecksumMatches[0]
}

function Assert-SLPowerShellScript {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    Assert-SLRegularFile -Path $Path -Description "Downloaded sl.ps1"
    $Bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($Bytes.Length -lt 2 -or $Bytes[0] -ne 35 -or $Bytes[1] -ne 33) {
        throw "Downloaded sl.ps1 does not start with a shebang."
    }

    $Tokens = $null
    $ParseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile(
        $Path,
        [ref]$Tokens,
        [ref]$ParseErrors
    )
    if ($ParseErrors.Count -ne 0) {
        throw "Downloaded sl.ps1 is not valid PowerShell."
    }
}

function Read-SLJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $Encoding = [System.Text.UTF8Encoding]::new($false, $true)
    $Content = [System.IO.File]::ReadAllText($Path, $Encoding)
    return ConvertFrom-Json -InputObject $Content -Depth 100
}

function Assert-SLArchiveEntries {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ArchivePath,

        [Parameter(Mandatory = $true)]
        [string]$RootDirectory
    )

    $Entries = @(& tar -tzf $ArchivePath 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to inspect the portable archive."
    }
    if ($Entries.Count -eq 0) {
        throw "The portable archive is empty."
    }

    foreach ($RawEntry in $Entries) {
        $Entry = ([string]$RawEntry).Replace("\", "/")
        while ($Entry.StartsWith("./", [StringComparison]::Ordinal)) {
            $Entry = $Entry.Substring(2)
        }
        if ([string]::IsNullOrWhiteSpace($Entry)) {
            continue
        }
        if (
            $Entry.StartsWith("/", [StringComparison]::Ordinal) -or
            $Entry -cmatch "^[A-Za-z]:" -or
            @($Entry.Split("/") | Where-Object { $_ -ceq ".." }).Count -gt 0
        ) {
            throw "The portable archive contains an unsafe path."
        }
        $FirstSegment = $Entry.Split("/")[0]
        if ($FirstSegment -cne $RootDirectory) {
            throw "The portable archive contains content outside its declared root."
        }
    }
}

function Get-SLVerifiedPortableRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DownloadRoot,

        [Parameter(Mandatory = $true)]
        [string]$ExtractRoot,

        [Parameter(Mandatory = $true)]
        [string]$Version,

        [Parameter(Mandatory = $true)]
        [string]$Platform,

        [Parameter(Mandatory = $true)]
        [string]$Architecture,

        [Parameter(Mandatory = $true)]
        [string]$AssetName
    )

    $ManifestPath = Join-Path $DownloadRoot $SL_RELEASE_MANIFEST
    $ChecksumsPath = Join-Path $DownloadRoot $SL_CHECKSUMS
    $ArchivePath = Join-Path $DownloadRoot $AssetName
    $Manifest = Read-SLJson -Path $ManifestPath
    $ManifestAssets = @($Manifest.assets | Where-Object {
        $_.platform -ceq $Platform -and
        $_.architecture -ceq $Architecture -and
        $_.fileName -ceq $AssetName
    })

    if (
        $Manifest.schemaVersion -ne 1 -or
        [string]$Manifest.version -cne $Version -or
        [string]$Manifest.sourceCommit -cnotmatch "^[0-9a-f]{40}$" -or
        [string]$Manifest.nodeVersion -cnotmatch "^v[0-9]+\.[0-9]+\.[0-9]+$" -or
        $ManifestAssets.Count -ne 1
    ) {
        throw "Release manifest does not match release '$Release' for $Platform-$Architecture."
    }

    $Asset = $ManifestAssets[0]
    $RootDirectory = [string]$Asset.rootDirectory
    [long]$ExpectedSize = 0
    if (
        [string]$Asset.sha256 -cnotmatch "^[0-9a-f]{64}$" -or
        -not [long]::TryParse([string]$Asset.size, [ref]$ExpectedSize) -or
        $ExpectedSize -le 0 -or
        $RootDirectory -cnotmatch "^[0-9A-Za-z][0-9A-Za-z._-]*$"
    ) {
        throw "Release manifest contains invalid integrity metadata for '$AssetName'."
    }

    $ExpectedHash = Get-SLPublishedChecksum `
        -ChecksumsPath $ChecksumsPath `
        -AssetName $AssetName
    $ArchiveInfo = Get-Item -LiteralPath $ArchivePath
    if ($ArchiveInfo.Length -ne $ExpectedSize) {
        throw "Archive size verification failed for '$AssetName'."
    }
    $ActualHash = Get-SLFileSha256 -Path $ArchivePath
    if (
        $ActualHash -cne $ExpectedHash -or
        [string]$Asset.sha256 -cne $ExpectedHash
    ) {
        throw "SHA-256 verification failed for '$AssetName'."
    }

    Assert-SLArchiveEntries `
        -ArchivePath $ArchivePath `
        -RootDirectory $RootDirectory
    & tar -xzf $ArchivePath -C $ExtractRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to extract '$AssetName'."
    }

    $PortableRoot = Join-Path $ExtractRoot $RootDirectory
    if (-not (Test-Path -LiteralPath $PortableRoot -PathType Container)) {
        throw "Portable archive is missing its declared root directory."
    }

    $UppercaseMetadata = Get-SLExactChild `
        -Parent $PortableRoot `
        -Name "SL-release.json" `
        -Kind File
    if ($UppercaseMetadata) {
        throw "Portable archive contains rejected uppercase metadata 'SL-release.json'."
    }
    $MetadataPath = Get-SLExactChild `
        -Parent $PortableRoot `
        -Name "sl-release.json" `
        -Kind File
    if (-not $MetadataPath) {
        throw "Portable archive is missing lowercase metadata 'sl-release.json'."
    }
    $Descriptor = Read-SLJson -Path $MetadataPath
    if (
        $Descriptor.schemaVersion -ne 1 -or
        [string]$Descriptor.version -cne [string]$Manifest.version -or
        [string]$Descriptor.sourceCommit -cne [string]$Manifest.sourceCommit -or
        [string]$Descriptor.nodeVersion -cne [string]$Manifest.nodeVersion -or
        [string]$Descriptor.platform -cne $Platform -or
        [string]$Descriptor.architecture -cne $Architecture -or
        [string]$Descriptor.fileName -cne $AssetName -or
        [string]$Descriptor.rootDirectory -cne $RootDirectory
    ) {
        throw "Portable archive metadata does not match the release manifest."
    }

    return $PortableRoot
}

function Invoke-SLPortableLauncher {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PortableRoot,

        [Parameter(Mandatory = $true)]
        [string]$Mode,

        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot,

        [switch]$DryRun
    )

    $LauncherRelativePath = if (Test-SLWindows) {
        Join-Path "bin" "sl.cmd"
    }
    else {
        Join-Path "bin" "sl"
    }
    $LauncherPath = Join-Path $PortableRoot $LauncherRelativePath
    if (-not (Test-Path -LiteralPath $LauncherPath -PathType Leaf)) {
        throw "Portable archive is missing internal launcher '$LauncherRelativePath'."
    }
    if (-not (Test-SLWindows)) {
        & chmod 755 $LauncherPath
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to make the internal launcher executable."
        }
    }

    $LauncherArguments = [System.Collections.Generic.List[string]]::new()
    $LauncherArguments.Add($Mode)
    $LauncherArguments.Add($RepositoryRoot)
    if ($DryRun) {
        $LauncherArguments.Add("--dry-run")
    }
    if (-not [string]::IsNullOrWhiteSpace($Automation)) {
        $LauncherArguments.Add("--automation")
        $LauncherArguments.Add($Automation)
    }

    [string[]]$InvocationArguments = $LauncherArguments.ToArray()
    & $LauncherPath @InvocationArguments
    if ($LASTEXITCODE -ne 0) {
        throw "SL '$Mode' command failed with exit code $LASTEXITCODE."
    }
}

function Install-SLCommand {
    if (-not [string]::IsNullOrWhiteSpace($RepoPath)) {
        throw "The install command does not accept a repository path."
    }

    Assert-SLRegularFile `
        -Path $PSCommandPath `
        -Description "Install source"
    $Destination = Get-SLInstallDestination
    if (Test-Path -LiteralPath $Destination) {
        Assert-SLRegularFile `
            -Path $Destination `
            -Description "Installed command"
    }

    $DestinationDirectory = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
    $TemporaryPath = Join-Path `
        $DestinationDirectory `
        ".sl-install-$([Guid]::NewGuid().ToString("N"))"
    try {
        [System.IO.File]::Copy($PSCommandPath, $TemporaryPath, $false)
        if (
            (Get-SLFileSha256 -Path $TemporaryPath) -cne
            (Get-SLFileSha256 -Path $PSCommandPath)
        ) {
            throw "Installed script verification failed."
        }
        if (-not (Test-SLWindows)) {
            & chmod 755 $TemporaryPath
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to make the installed script executable."
            }
        }
        [System.IO.File]::Move($TemporaryPath, $Destination, $true)
    }
    finally {
        Remove-Item -LiteralPath $TemporaryPath -Force -ErrorAction SilentlyContinue
    }

    Write-Output "Installed sl $SL_VERSION to '$Destination'."
    Confirm-SLUserPath -Directory $DestinationDirectory
    Write-Output "No wrapper was created."
}

function Update-SLCommand {
    if (-not [string]::IsNullOrWhiteSpace($RepoPath)) {
        throw "The self-update command does not accept a repository path."
    }
    Assert-SLReleaseSelection

    $Destination = Get-SLInstallDestination
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
        throw "Installed sl command was not found at '$Destination'. Run 'sl install' first."
    }
    Assert-SLRegularFile `
        -Path $Destination `
        -Description "Installed command"

    $DestinationDirectory = Split-Path -Parent $Destination
    $TemporaryRoot = Join-Path `
        $DestinationDirectory `
        ".sl-update-$([Guid]::NewGuid().ToString("N"))"
    try {
        New-Item -ItemType Directory -Path $TemporaryRoot | Out-Null
        Copy-SLReleaseAsset `
            -Name "sl.ps1" `
            -DestinationDirectory $TemporaryRoot `
            -LocalAssetDirectory $AssetDirectory
        Copy-SLReleaseAsset `
            -Name $SL_CHECKSUMS `
            -DestinationDirectory $TemporaryRoot `
            -LocalAssetDirectory $AssetDirectory

        $CandidatePath = Join-Path $TemporaryRoot "sl.ps1"
        $ChecksumsPath = Join-Path $TemporaryRoot $SL_CHECKSUMS
        $ExpectedHash = Get-SLPublishedChecksum `
            -ChecksumsPath $ChecksumsPath `
            -AssetName "sl.ps1"
        $ActualHash = Get-SLFileSha256 -Path $CandidatePath
        if ($ActualHash -cne $ExpectedHash) {
            throw "SHA-256 verification failed for 'sl.ps1'."
        }
        Assert-SLPowerShellScript -Path $CandidatePath

        if (-not (Test-SLWindows)) {
            & chmod 755 $CandidatePath
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to make the updated command executable."
            }
        }
        [System.IO.File]::Move($CandidatePath, $Destination, $true)
        if ((Get-SLFileSha256 -Path $Destination) -cne $ExpectedHash) {
            throw "Updated command verification failed."
        }
    }
    finally {
        Remove-Item `
            -LiteralPath $TemporaryRoot `
            -Recurse `
            -Force `
            -ErrorAction SilentlyContinue
    }
    Write-Output "Updated sl from release '$Release' at '$Destination'."
}

function Test-SLInteractiveInput {
    if ([Console]::IsInputRedirected) {
        return $false
    }
    if (
        [Environment]::CommandLine -imatch
        "(?:^|\s)-(?:NonInteractive|Noni)(?:\s|$)"
    ) {
        return $false
    }
    try {
        return $null -ne $Host.UI -and $null -ne $Host.UI.RawUI
    }
    catch {
        return $false
    }
}

function Initialize-SLRepository {
    $RepositoryRoot = Resolve-SLRepositoryPath -Path $RepoPath
    Assert-SLLearningPathCasing -RepositoryRoot $RepositoryRoot

    Assert-SLReleaseSelection

    $Version = if ($Release.StartsWith("v", [StringComparison]::Ordinal)) {
        $Release.Substring(1)
    }
    else {
        $Release
    }
    $Platform = Get-SLPlatform
    $Architecture = Get-SLArchitecture
    $AssetName = "sl-$Version-$Platform-$Architecture.tar.gz"
    $ParentRoot = Split-Path -Parent $RepositoryRoot
    if ([string]::IsNullOrWhiteSpace($ParentRoot)) {
        $ParentRoot = $RepositoryRoot
    }
    $TemporaryRoot = Join-Path `
        $ParentRoot `
        ".sl-init-$([Guid]::NewGuid().ToString("N"))"
    $DownloadRoot = Join-Path $TemporaryRoot "download"
    $ExtractRoot = Join-Path $TemporaryRoot "extract"

    try {
        New-Item -ItemType Directory -Path $DownloadRoot, $ExtractRoot | Out-Null
        Copy-SLReleaseAsset `
            -Name $SL_RELEASE_MANIFEST `
            -DestinationDirectory $DownloadRoot `
            -LocalAssetDirectory $AssetDirectory
        Copy-SLReleaseAsset `
            -Name $SL_CHECKSUMS `
            -DestinationDirectory $DownloadRoot `
            -LocalAssetDirectory $AssetDirectory
        Copy-SLReleaseAsset `
            -Name $AssetName `
            -DestinationDirectory $DownloadRoot `
            -LocalAssetDirectory $AssetDirectory

        $PortableRoot = Get-SLVerifiedPortableRoot `
            -DownloadRoot $DownloadRoot `
            -ExtractRoot $ExtractRoot `
            -Version $Version `
            -Platform $Platform `
            -Architecture $Architecture `
            -AssetName $AssetName
        $Mode = if (Get-SLLearningRoot -RepositoryRoot $RepositoryRoot) {
            "update"
        }
        else {
            "init"
        }

        Write-Output "Plan for SL $Mode in '$RepositoryRoot':"
        Invoke-SLPortableLauncher `
            -PortableRoot $PortableRoot `
            -Mode $Mode `
            -RepositoryRoot $RepositoryRoot `
            -DryRun

        if (-not $Yes) {
            if (-not (Test-SLInteractiveInput)) {
                throw "Confirmation requires interactive input. Re-run with -Yes to apply the displayed plan."
            }
            $Answer = Read-Host "Apply this plan? [y/N]"
            if ($Answer -inotmatch "^(y|yes)$") {
                Write-Output "No changes applied."
                return
            }
        }

        Write-Output "Applying SL ${Mode}:"
        Invoke-SLPortableLauncher `
            -PortableRoot $PortableRoot `
            -Mode $Mode `
            -RepositoryRoot $RepositoryRoot

        foreach ($RuntimeCommand in @("doctor", "project", "validate")) {
            Write-Output "Running repository-local SL ${RuntimeCommand}:"
            Invoke-SLRepositoryRuntime `
                -RepositoryRoot $RepositoryRoot `
                -RuntimeCommand $RuntimeCommand
        }
    }
    finally {
        Remove-Item `
            -LiteralPath $TemporaryRoot `
            -Recurse `
            -Force `
            -ErrorAction SilentlyContinue
    }
}

function Show-SLHelp {
    @"
sl - repository-local self-learning bootstrap

Usage:
  sl install
  sl self-update [-Release <tag>] [-AssetDirectory <path>]
  sl initrepo [repo-path] [-Release <tag>] [-Repository <owner/name>]
      [-Automation none|github|azure|all] [-AssetDirectory <path>] [-Yes]
  sl doctor [repo-path]
  sl project [repo-path]
  sl validate [repo-path]
  sl help
  sl version

Defaults:
  repo-path   Current directory
  release     v0.6.0
  repository  fabri777/SL-Repo
"@
}

function Invoke-SLMain {
    if ($PSVersionTable.PSVersion.Major -lt 7) {
        throw "sl requires PowerShell 7 or newer."
    }

    switch ($Command.ToLowerInvariant()) {
        "install" {
            Install-SLCommand
        }
        "self-update" {
            Update-SLCommand
        }
        "initrepo" {
            Initialize-SLRepository
        }
        "doctor" {
            $RepositoryRoot = Resolve-SLRepositoryPath -Path $RepoPath
            Invoke-SLRepositoryRuntime `
                -RepositoryRoot $RepositoryRoot `
                -RuntimeCommand "doctor"
        }
        "project" {
            $RepositoryRoot = Resolve-SLRepositoryPath -Path $RepoPath
            Invoke-SLRepositoryRuntime `
                -RepositoryRoot $RepositoryRoot `
                -RuntimeCommand "project"
        }
        "validate" {
            $RepositoryRoot = Resolve-SLRepositoryPath -Path $RepoPath
            Invoke-SLRepositoryRuntime `
                -RepositoryRoot $RepositoryRoot `
                -RuntimeCommand "validate"
        }
        "help" {
            Show-SLHelp
        }
        "version" {
            Write-Output "sl v$SL_VERSION"
        }
        default {
            throw "Unknown command '$Command'. Run 'sl help'."
        }
    }
}

try {
    Invoke-SLMain
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
