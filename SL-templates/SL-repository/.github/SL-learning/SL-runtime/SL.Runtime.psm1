Set-StrictMode -Version Latest

$script:SLRuntimeVersion = '0.1.0'
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
. (Join-Path $PSScriptRoot 'SL.Runtime.Conformance.ps1')
. (Join-Path $PSScriptRoot 'SL.Runtime.Doctor.ps1')

function Get-SLRuntimeHelp {
    return [pscustomobject] @{
        name = 'SL'
        runtimeVersion = $script:SLRuntimeVersion
        usage = 'SL.ps1 [--json] [--dry-run] [--repo-root <path>] <command>'
        commands = @(
            [pscustomobject] @{ name = 'help'; description = 'Show the implemented runtime foundation commands.' }
            [pscustomobject] @{ name = 'version'; description = 'Show runtime and contract versions.' }
            [pscustomobject] @{ name = 'doctor'; description = 'Check repository discovery, runtime manifest, hashes, and launchers.' }
            [pscustomobject] @{ name = 'validate-runtime'; description = 'Validate the installed runtime without changing files.' }
            [pscustomobject] @{ name = 'conformance'; description = 'Run shared TypeScript/PowerShell contract vectors.' }
        )
        note = 'Lifecycle parity commands are intentionally not implemented by this foundation runtime.'
    }
}

function Write-SLRuntimeOutput {
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [object] $Value,

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
    if ($null -ne $Value.PSObject.Properties['usage']) {
        [Console]::Out.WriteLine($Value.usage)
        foreach ($Command in $Value.commands) {
            [Console]::Out.WriteLine("  $($Command.name) - $($Command.description)")
        }
        [Console]::Out.WriteLine($Value.note)
        return
    }
    if ($null -ne $Value.PSObject.Properties['checks']) {
        foreach ($Check in $Value.checks) {
            [Console]::Out.WriteLine("$($Check.status.ToUpperInvariant()) $($Check.code) - $($Check.message)")
        }
        return
    }
    [Console]::Out.WriteLine((ConvertTo-SLCanonicalJson -Value $Value))
}

function Write-SLRuntimeError {
    param(
        [Parameter(Mandatory)]
        [string] $Code,

        [Parameter(Mandatory)]
        [string] $Message,

        [switch] $Json
    )

    if ($Json) {
        [Console]::Error.WriteLine(
            (ConvertTo-SLCanonicalJson -Value ([pscustomobject] @{
                error = [pscustomobject] @{
                    code = $Code
                    message = $Message
                }
            }))
        )
    }
    else {
        [Console]::Error.WriteLine($Message)
    }
}

function Invoke-SLRuntime {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [string[]] $Arguments,

        [Parameter(Mandatory)]
        [string] $RuntimeHome
    )

    $Json = $false
    $DryRun = $false
    $RepoRootArgument = $null
    $Command = $null
    $CommandArguments = [System.Collections.Generic.List[string]]::new()
    :ArgumentLoop for ($Index = 0; $Index -lt $Arguments.Count; $Index += 1) {
        $Argument = $Arguments[$Index]
        switch -CaseSensitive ($Argument) {
            '--json' {
                $Json = $true
                continue ArgumentLoop
            }
            '--dry-run' {
                $DryRun = $true
                continue ArgumentLoop
            }
            '--repo-root' {
                if ($Index + 1 -ge $Arguments.Count) {
                    Write-SLRuntimeError -Code 'usage' -Message '--repo-root requires a path.' -Json:$Json
                    return $script:SLExitCodes.Usage
                }
                $Index += 1
                $RepoRootArgument = $Arguments[$Index]
                continue ArgumentLoop
            }
            '--help' {
                $Command = 'help'
                continue ArgumentLoop
            }
        }
        if ($Argument.StartsWith('-')) {
            Write-SLRuntimeError -Code 'usage' -Message "Unknown option: $Argument" -Json:$Json
            return $script:SLExitCodes.Usage
        }
        if ($null -eq $Command) {
            $Command = $Argument
        }
        else {
            $CommandArguments.Add($Argument)
        }
    }
    if ($null -eq $Command) {
        $Command = 'help'
    }
    if ($CommandArguments.Count -gt 0) {
        Write-SLRuntimeError -Code 'usage' -Message "Command '$Command' does not accept positional arguments." -Json:$Json
        return $script:SLExitCodes.Usage
    }
    if ($Command -in @('help', 'version')) {
        $Result = if ($Command -ceq 'help') {
            Get-SLRuntimeHelp
        }
        else {
            [pscustomobject] @{
                runtimeVersion = $script:SLRuntimeVersion
                schemaVersion = 1
                configContractVersion = 1
                conformanceVersion = 1
                minimumPowerShellVersion = '7.0.0'
                dryRun = $DryRun
            }
        }
        Write-SLRuntimeOutput -Value $Result -Json:$Json
        return $script:SLExitCodes.Success
    }
    if ($Command -notin @('doctor', 'validate-runtime', 'conformance')) {
        Write-SLRuntimeError -Code 'usage' -Message "Unknown or not-yet-implemented command: $Command" -Json:$Json
        return $script:SLExitCodes.Usage
    }

    try {
        $RepositoryRoot = if ($RepoRootArgument) {
            Get-SLRepositoryRoot -StartPath $RepoRootArgument
        }
        else {
            Get-SLRepositoryRoot -StartPath (Get-Location).Path
        }
    }
    catch {
        Write-SLRuntimeError -Code 'repository-root' -Message $_.Exception.Message -Json:$Json
        return $script:SLExitCodes.RepositoryRoot
    }

    try {
        if ($Command -ceq 'conformance') {
            $Integrity = Test-SLRuntimeInstallation `
                -RuntimeHome $RuntimeHome `
                -ExpectedRuntimeVersion $script:SLRuntimeVersion
            if (-not $Integrity.healthy) {
                $Output = [pscustomobject] @{
                    command = $Command
                    repositoryRoot = $RepositoryRoot
                    dryRun = $DryRun
                    healthy = $false
                    checks = $Integrity.checks
                }
                Write-SLRuntimeOutput -Value $Output -Json:$Json
                if (@($Integrity.checks | Where-Object code -ceq 'runtime-mixed-version').Count) {
                    return $script:SLExitCodes.MixedVersion
                }
                return $script:SLExitCodes.Integrity
            }
            $Result = Invoke-SLRuntimeConformance -RuntimeHome $RuntimeHome
            $Output = [pscustomobject] @{
                command = $Command
                repositoryRoot = $RepositoryRoot
                dryRun = $DryRun
                result = $Result
            }
            Write-SLRuntimeOutput -Value $Output -Json:$Json
            return $(if ($Result.failed -eq 0) {
                $script:SLExitCodes.Success
            }
            else {
                $script:SLExitCodes.Validation
            })
        }

        $Result = Test-SLRuntimeInstallation `
            -RuntimeHome $RuntimeHome `
            -ExpectedRuntimeVersion $script:SLRuntimeVersion
        $Output = [pscustomobject] @{
            command = $Command
            repositoryRoot = $RepositoryRoot
            dryRun = $DryRun
            healthy = $Result.healthy
            checks = $Result.checks
        }
        Write-SLRuntimeOutput -Value $Output -Json:$Json
        if ($Result.healthy) {
            return $script:SLExitCodes.Success
        }
        if (@($Result.checks | Where-Object code -ceq 'runtime-manifest-missing').Count) {
            return $script:SLExitCodes.Manifest
        }
        if (@($Result.checks | Where-Object code -ceq 'runtime-mixed-version').Count) {
            return $script:SLExitCodes.MixedVersion
        }
        return $script:SLExitCodes.Integrity
    }
    catch {
        Write-SLRuntimeError -Code 'runtime-internal' -Message $_.Exception.Message -Json:$Json
        $Code = [string] $_.Exception.Data['SLCode']
        if ($Code.StartsWith('manifest-')) {
            return $script:SLExitCodes.Manifest
        }
        return $script:SLExitCodes.Internal
    }
}

Export-ModuleMember -Function 'Invoke-SLRuntime'
