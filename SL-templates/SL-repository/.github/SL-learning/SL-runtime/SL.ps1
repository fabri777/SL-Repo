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
