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

    $VectorPath = [IO.Path]::Combine($RuntimeHome, 'SL-conformance-vectors.json')
    $Suite = ConvertFrom-Json -InputObject (
        [IO.File]::ReadAllText($VectorPath, [Text.UTF8Encoding]::new($false, $true))
    ) -Depth 100
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
