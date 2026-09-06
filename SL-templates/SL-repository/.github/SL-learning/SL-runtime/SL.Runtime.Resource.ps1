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
        "SL-baselines/$(Get-SLArtifactShardName $BaselineId)"
    }
    else {
        Get-SLArtifactShardName ([string] $Receipt.artifactId)
    }
    return "$($Entry.resourceReceiptsPath)/$Owner/$Month/SL-resource-$(([string] $Receipt.receiptId).Substring(12)).json"
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
                $Relative.StartsWith("$script:SLResourceRoot/") -or
                $Relative -match '^\.github/SL-learning/SL-scopes/[^/]+/SL-resource-receipts/'
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
