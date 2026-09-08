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
