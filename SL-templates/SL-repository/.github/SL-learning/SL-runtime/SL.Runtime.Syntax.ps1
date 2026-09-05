Set-StrictMode -Version Latest

function ConvertFrom-SLDoubleQuotedValue {
    param([string] $Value, [int] $LineNumber)

    if ($Value -cnotmatch '^"(?:[^"\\\r\n]|\\["\\nrt])*"$') {
        Throw-SLContractError -Code 'yaml-string' -Message "Unsupported double-quoted string at line $LineNumber."
    }
    return ConvertFrom-Json -InputObject $Value
}

function ConvertFrom-SLSingleQuotedValue {
    param([string] $Value, [int] $LineNumber)

    if ($Value -cnotmatch "^'(?:[^'\r\n]|'')*'$") {
        Throw-SLContractError -Code 'yaml-string' -Message "Unsupported single-quoted string at line $LineNumber."
    }
    return $Value.Substring(1, $Value.Length - 2).Replace("''", "'")
}

function Split-SLInlineList {
    param([string] $Value, [int] $LineNumber)

    $Result = [System.Collections.Generic.List[string]]::new()
    $Builder = [Text.StringBuilder]::new()
    [char] $Quote = [char] 0
    $Escaped = $false
    for ($Index = 0; $Index -lt $Value.Length; $Index += 1) {
        $Character = $Value[$Index]
        if ($Quote -ceq '"') {
            [void] $Builder.Append($Character)
            if ($Escaped) {
                $Escaped = $false
            }
            elseif ($Character -ceq '\') {
                $Escaped = $true
            }
            elseif ($Character -ceq $Quote) {
                $Quote = [char] 0
            }
            continue
        }
        if ($Quote -ceq "'") {
            [void] $Builder.Append($Character)
            if ($Character -ceq $Quote) {
                if ($Index + 1 -lt $Value.Length -and $Value[$Index + 1] -ceq "'") {
                    [void] $Builder.Append($Value[$Index + 1])
                    $Index += 1
                }
                else {
                    $Quote = [char] 0
                }
            }
            continue
        }
        if ($Character -ceq "'" -or $Character -ceq '"') {
            $Quote = $Character
            [void] $Builder.Append($Character)
        }
        elseif ($Character -ceq ',') {
            $Item = $Builder.ToString().Trim()
            if (-not $Item) {
                Throw-SLContractError -Code 'yaml-list' -Message "Empty inline-list item at line $LineNumber."
            }
            $Result.Add($Item)
            [void] $Builder.Clear()
        }
        else {
            [void] $Builder.Append($Character)
        }
    }
    if ($Quote -ne [char] 0) {
        Throw-SLContractError -Code 'yaml-string' -Message "Unterminated quoted string at line $LineNumber."
    }
    $Final = $Builder.ToString().Trim()
    if ($Final) {
        $Result.Add($Final)
    }
    elseif ($Value.Trim()) {
        Throw-SLContractError -Code 'yaml-list' -Message "Empty inline-list item at line $LineNumber."
    }
    return $Result.ToArray()
}

function ConvertFrom-SLYamlScalar {
    param([string] $Value, [int] $LineNumber)

    $Trimmed = $Value.Trim()
    if (-not $Trimmed) {
        Throw-SLContractError -Code 'yaml-value' -Message "Missing YAML value at line $LineNumber."
    }
    if ($Trimmed -ceq '[]') {
        return ,@()
    }
    if ($Trimmed -ceq '{}') {
        return @{}
    }
    if ($Trimmed.StartsWith('[') -or $Trimmed.EndsWith(']')) {
        if (-not ($Trimmed.StartsWith('[') -and $Trimmed.EndsWith(']'))) {
            Throw-SLContractError -Code 'yaml-list' -Message "Malformed inline list at line $LineNumber."
        }
        $Inner = $Trimmed.Substring(1, $Trimmed.Length - 2).Trim()
        if (-not $Inner) {
            return ,@()
        }
        $Items = @(
            Split-SLInlineList -Value $Inner -LineNumber $LineNumber |
                ForEach-Object { ConvertFrom-SLYamlScalar -Value $_ -LineNumber $LineNumber }
        )
        return ,$Items
    }
    if ($Trimmed.StartsWith('"')) {
        return ConvertFrom-SLDoubleQuotedValue -Value $Trimmed -LineNumber $LineNumber
    }
    if ($Trimmed.StartsWith("'")) {
        return ConvertFrom-SLSingleQuotedValue -Value $Trimmed -LineNumber $LineNumber
    }
    if ($Trimmed -ceq 'true') {
        return $true
    }
    if ($Trimmed -ceq 'false') {
        return $false
    }
    if ($Trimmed -ceq 'null') {
        return $null
    }
    if ($Trimmed -cmatch '^-?(?:0|[1-9][0-9]*)$') {
        [long] $Parsed = 0
        if (-not [long]::TryParse(
            $Trimmed,
            [Globalization.NumberStyles]::AllowLeadingSign,
            [Globalization.CultureInfo]::InvariantCulture,
            [ref] $Parsed
        ) -or $Parsed -lt -9007199254740991 -or $Parsed -gt 9007199254740991) {
            Throw-SLContractError -Code 'yaml-integer' -Message "YAML integer is outside the safe range at line $LineNumber."
        }
        return $Parsed
    }
    if (
        $Trimmed -cmatch '^[&*!>|%@`]' -or
        $Trimmed -match '^(?:yes|no|on|off|~)$' -or
        $Trimmed -match ':\s' -or
        $Trimmed -match '\s#'
    ) {
        Throw-SLContractError -Code 'yaml-syntax' -Message "Unsupported YAML syntax at line $LineNumber."
    }
    return $Trimmed
}

function ConvertFrom-SLYamlKey {
    param([string] $Content, [int] $LineNumber)

    if ($Content -cnotmatch '^([A-Za-z][A-Za-z0-9_-]*):(.*)$') {
        Throw-SLContractError -Code 'yaml-key' -Message "Invalid YAML mapping key at line $LineNumber."
    }
    $Suffix = $Matches[2]
    if ($Suffix -and -not $Suffix.StartsWith(' ')) {
        Throw-SLContractError -Code 'yaml-spacing' -Message "A YAML mapping colon must be followed by a space at line $LineNumber."
    }
    return [pscustomobject] @{
        Key = $Matches[1]
        ValueText = $Suffix.TrimStart()
    }
}

function ConvertFrom-SLYamlMapping {
    param([object[]] $Lines, [int] $StartIndex, [int] $Indent)

    $Value = @{}
    $Index = $StartIndex
    while ($Index -lt $Lines.Count) {
        $Line = $Lines[$Index]
        if ($Line.Indent -lt $Indent) {
            break
        }
        if ($Line.Indent -gt $Indent) {
            Throw-SLContractError -Code 'yaml-indent' -Message "Unexpected indentation at line $($Line.LineNumber)."
        }
        if ($Line.Content.StartsWith('-')) {
            break
        }
        $Entry = ConvertFrom-SLYamlKey -Content $Line.Content -LineNumber $Line.LineNumber
        if ($Value.ContainsKey($Entry.Key)) {
            Throw-SLContractError -Code 'yaml-duplicate-key' -Message "Duplicate YAML key '$($Entry.Key)' at line $($Line.LineNumber)."
        }
        $Index += 1
        if ($Entry.ValueText) {
            $Value[$Entry.Key] = ConvertFrom-SLYamlScalar -Value $Entry.ValueText -LineNumber $Line.LineNumber
            continue
        }
        if ($Index -ge $Lines.Count -or $Lines[$Index].Indent -le $Indent) {
            Throw-SLContractError -Code 'yaml-value' -Message "Missing nested YAML value for '$($Entry.Key)' at line $($Line.LineNumber)."
        }
        if ($Lines[$Index].Indent -ne ($Indent + 2)) {
            Throw-SLContractError -Code 'yaml-indent' -Message "Nested YAML must use two-space indentation at line $($Lines[$Index].LineNumber)."
        }
        $Nested = ConvertFrom-SLYamlBlock -Lines $Lines -StartIndex $Index -Indent ($Indent + 2)
        $Value[$Entry.Key] = $Nested.Value
        $Index = $Nested.NextIndex
    }
    return [pscustomobject] @{ Value = $Value; NextIndex = $Index }
}

function ConvertFrom-SLYamlSequence {
    param([object[]] $Lines, [int] $StartIndex, [int] $Indent)

    $Value = [System.Collections.Generic.List[object]]::new()
    $Index = $StartIndex
    while ($Index -lt $Lines.Count) {
        $Line = $Lines[$Index]
        if ($Line.Indent -lt $Indent) {
            break
        }
        if ($Line.Indent -ne $Indent -or -not $Line.Content.StartsWith('-')) {
            break
        }
        if ($Line.Content -cne '-' -and -not $Line.Content.StartsWith('- ')) {
            Throw-SLContractError -Code 'yaml-sequence' -Message "A YAML sequence marker must be followed by a space at line $($Line.LineNumber)."
        }
        $ItemText = $Line.Content.Substring(1).TrimStart()
        $Index += 1
        if (-not $ItemText) {
            if ($Index -ge $Lines.Count -or $Lines[$Index].Indent -ne ($Indent + 2)) {
                Throw-SLContractError -Code 'yaml-indent' -Message "Nested YAML sequence values must use two-space indentation at line $($Line.LineNumber)."
            }
            $Nested = ConvertFrom-SLYamlBlock -Lines $Lines -StartIndex $Index -Indent ($Indent + 2)
            $Value.Add($Nested.Value)
            $Index = $Nested.NextIndex
            continue
        }
        if ($ItemText -cmatch '^[A-Za-z][A-Za-z0-9_-]*:') {
            $First = ConvertFrom-SLYamlKey -Content $ItemText -LineNumber $Line.LineNumber
            $ObjectValue = @{}
            if ($First.ValueText) {
                $ObjectValue[$First.Key] = ConvertFrom-SLYamlScalar -Value $First.ValueText -LineNumber $Line.LineNumber
            }
            else {
                if ($Index -ge $Lines.Count -or $Lines[$Index].Indent -ne ($Indent + 2)) {
                    Throw-SLContractError -Code 'yaml-indent' -Message "Nested YAML values must use two-space indentation at line $($Line.LineNumber)."
                }
                $Nested = ConvertFrom-SLYamlBlock -Lines $Lines -StartIndex $Index -Indent ($Indent + 2)
                $ObjectValue[$First.Key] = $Nested.Value
                $Index = $Nested.NextIndex
            }
            if (
                $Index -lt $Lines.Count -and
                $Lines[$Index].Indent -eq ($Indent + 2) -and
                -not $Lines[$Index].Content.StartsWith('-')
            ) {
                $Continuation = ConvertFrom-SLYamlMapping -Lines $Lines -StartIndex $Index -Indent ($Indent + 2)
                foreach ($Key in $Continuation.Value.Keys) {
                    if ($ObjectValue.ContainsKey($Key)) {
                        Throw-SLContractError -Code 'yaml-duplicate-key' -Message "Duplicate YAML key '$Key' at line $($Lines[$Index].LineNumber)."
                    }
                    $ObjectValue[$Key] = $Continuation.Value[$Key]
                }
                $Index = $Continuation.NextIndex
            }
            $Value.Add($ObjectValue)
            continue
        }
        $Value.Add((ConvertFrom-SLYamlScalar -Value $ItemText -LineNumber $Line.LineNumber))
    }
    return [pscustomobject] @{ Value = $Value.ToArray(); NextIndex = $Index }
}

function ConvertFrom-SLYamlBlock {
    param([object[]] $Lines, [int] $StartIndex, [int] $Indent)

    if ($StartIndex -ge $Lines.Count -or $Lines[$StartIndex].Indent -ne $Indent) {
        $LineNumber = if ($StartIndex -lt $Lines.Count) { $Lines[$StartIndex].LineNumber } else { 1 }
        Throw-SLContractError -Code 'yaml-indent' -Message "Invalid YAML indentation at line $LineNumber."
    }
    if ($Lines[$StartIndex].Content.StartsWith('-')) {
        return ConvertFrom-SLYamlSequence -Lines $Lines -StartIndex $StartIndex -Indent $Indent
    }
    return ConvertFrom-SLYamlMapping -Lines $Lines -StartIndex $StartIndex -Indent $Indent
}

function ConvertFrom-SLYaml {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Content
    )

    $Normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    if ($Normalized.Contains("`t")) {
        Throw-SLContractError -Code 'yaml-tab' -Message 'YAML tabs are not supported.'
    }
    $Lines = @()
    $SourceLines = $Normalized.Split("`n")
    for ($Index = 0; $Index -lt $SourceLines.Count; $Index += 1) {
        $Source = $SourceLines[$Index]
        $Trimmed = $Source.TrimStart()
        if (-not $Trimmed -or $Trimmed.StartsWith('#')) {
            continue
        }
        $Indent = $Source.Length - $Trimmed.Length
        if (($Indent % 2) -ne 0) {
            Throw-SLContractError -Code 'yaml-indent' -Message "YAML indentation must use multiples of two spaces at line $($Index + 1)."
        }
        if ($Trimmed -ceq '---' -or $Trimmed -ceq '...') {
            Throw-SLContractError -Code 'yaml-document' -Message "YAML document markers are not supported at line $($Index + 1)."
        }
        $Lines += [pscustomobject] @{
            Indent = $Indent
            Content = $Trimmed
            LineNumber = $Index + 1
        }
    }
    if ($Lines.Count -eq 0) {
        Throw-SLContractError -Code 'yaml-empty' -Message 'YAML content cannot be empty.'
    }
    if ($Lines[0].Indent -ne 0) {
        Throw-SLContractError -Code 'yaml-indent' -Message 'The YAML document must start at indentation zero.'
    }
    $Parsed = ConvertFrom-SLYamlBlock -Lines $Lines -StartIndex 0 -Indent 0
    if ($Parsed.NextIndex -ne $Lines.Count) {
        Throw-SLContractError -Code 'yaml-structure' -Message "Unexpected YAML content at line $($Lines[$Parsed.NextIndex].LineNumber)."
    }
    if ($Parsed.Value -isnot [System.Collections.IDictionary]) {
        Throw-SLContractError -Code 'yaml-root' -Message 'The YAML document root must be a mapping.'
    }
    return $Parsed.Value
}

function ConvertFrom-SLFrontmatter {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Content
    )

    $Normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    $Lines = $Normalized.Split("`n")
    if ($Lines.Count -eq 0 -or $Lines[0] -cne '---') {
        Throw-SLContractError -Code 'frontmatter-open' -Message 'Markdown must start with a YAML frontmatter delimiter.'
    }
    $ClosingIndex = -1
    for ($Index = 1; $Index -lt $Lines.Count; $Index += 1) {
        if ($Lines[$Index] -ceq '---') {
            $ClosingIndex = $Index
            break
        }
    }
    if ($ClosingIndex -lt 0) {
        Throw-SLContractError -Code 'frontmatter-close' -Message 'Markdown frontmatter is missing its closing delimiter.'
    }
    $Yaml = $Lines[1..($ClosingIndex - 1)] -join "`n"
    $Body = if ($ClosingIndex + 1 -lt $Lines.Count) {
        $Lines[($ClosingIndex + 1)..($Lines.Count - 1)] -join "`n"
    }
    else {
        ''
    }
    return [pscustomobject] @{
        frontmatter = ConvertFrom-SLYaml -Content $Yaml
        body = $Body
    }
}

function Assert-SLTypedValue {
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [object] $Value,

        [Parameter(Mandatory)]
        [pscustomobject] $Contract,

        [string] $Path = '$'
    )

    $SupportedKeywords = @(
        'additionalProperties',
        'const',
        'enum',
        'items',
        'minItems',
        'minLength',
        'minimum',
        'pattern',
        'properties',
        'required',
        'type'
    )
    foreach ($Keyword in $Contract.PSObject.Properties.Name) {
        if ($Keyword -cnotin $SupportedKeywords) {
            Throw-SLContractError -Code 'validation-keyword' -Message "Unsupported validation keyword '$Keyword' at $Path."
        }
    }
    if ($Contract.type -isnot [string]) {
        Throw-SLContractError -Code 'validation-contract' -Message "Validation contract type is required at $Path."
    }
    $ValidType = switch -CaseSensitive ($Contract.type) {
        'object' {
            $Value -is [pscustomobject] -or $Value -is [System.Collections.IDictionary]
            break
        }
        'array' {
            $Value -is [array]
            break
        }
        'string' {
            $Value -is [string]
            break
        }
        'integer' {
            $IsInteger = $Value -is [byte] -or
            $Value -is [sbyte] -or
            $Value -is [int16] -or
            $Value -is [uint16] -or
            $Value -is [int32] -or
            $Value -is [uint32] -or
            $Value -is [int64]
            $IsInteger -and
            [decimal] $Value -ge -9007199254740991 -and
            [decimal] $Value -le 9007199254740991
            break
        }
        'boolean' {
            $Value -is [bool]
            break
        }
        'null' {
            $null -eq $Value
            break
        }
        default {
            Throw-SLContractError -Code 'validation-type-contract' -Message "Unsupported validation type '$($Contract.type)' at $Path."
        }
    }
    if (-not $ValidType) {
        Throw-SLContractError -Code 'validation-type' -Message "Expected $($Contract.type) at $Path."
    }
    if ($null -ne $Contract.PSObject.Properties['const']) {
        if (
            (ConvertTo-SLCanonicalJson -Value $Value) -cne
            (ConvertTo-SLCanonicalJson -Value $Contract.const)
        ) {
            Throw-SLContractError -Code 'validation-const' -Message "Value does not match const at $Path."
        }
    }
    if ($null -ne $Contract.PSObject.Properties['enum']) {
        if ($Contract.enum -isnot [array]) {
            Throw-SLContractError -Code 'validation-contract' -Message "enum must be an array at $Path."
        }
        $ActualJson = ConvertTo-SLCanonicalJson -Value $Value
        $Matched = @(
            $Contract.enum |
                Where-Object { (ConvertTo-SLCanonicalJson -Value $_) -ceq $ActualJson }
        ).Count -gt 0
        if (-not $Matched) {
            Throw-SLContractError -Code 'validation-enum' -Message "Value is not in enum at $Path."
        }
    }
    if ($Value -is [string]) {
        if ($null -ne $Contract.PSObject.Properties['minLength']) {
            if ($Contract.minLength -isnot [long] -or $Contract.minLength -lt 0) {
                Throw-SLContractError -Code 'validation-contract' -Message "minLength must be a non-negative integer at $Path."
            }
            if ($Value.Length -lt $Contract.minLength) {
                Throw-SLContractError -Code 'validation-min-length' -Message "String is shorter than minLength at $Path."
            }
        }
        if ($null -ne $Contract.PSObject.Properties['pattern']) {
            if ($Contract.pattern -isnot [string]) {
                Throw-SLContractError -Code 'validation-contract' -Message "pattern must be a string at $Path."
            }
            if (
                $Contract.pattern -match '\(\?' -or
                $Contract.pattern -match '\\(?:[1-9k]|[pP]\{)'
            ) {
                Throw-SLContractError -Code 'validation-pattern-contract' -Message "pattern uses syntax outside the cross-runtime subset at $Path."
            }
            try {
                $Expression = [Regex]::new(
                    $Contract.pattern,
                    [Text.RegularExpressions.RegexOptions]::CultureInvariant
                )
            }
            catch {
                Throw-SLContractError -Code 'validation-contract' -Message "pattern is invalid at $Path."
            }
            if (-not $Expression.IsMatch($Value)) {
                Throw-SLContractError -Code 'validation-pattern' -Message "String does not match pattern at $Path."
            }
        }
    }
    if (
        $Contract.type -ceq 'integer' -and
        $null -ne $Contract.PSObject.Properties['minimum']
    ) {
        if ($Contract.minimum -isnot [long]) {
            Throw-SLContractError -Code 'validation-contract' -Message "minimum must be a safe integer at $Path."
        }
        if ([long] $Value -lt $Contract.minimum) {
            Throw-SLContractError -Code 'validation-minimum' -Message "Integer is below minimum at $Path."
        }
    }
    if ($Value -is [array]) {
        if ($null -ne $Contract.PSObject.Properties['minItems']) {
            if ($Contract.minItems -isnot [long] -or $Contract.minItems -lt 0) {
                Throw-SLContractError -Code 'validation-contract' -Message "minItems must be a non-negative integer at $Path."
            }
            if ($Value.Count -lt $Contract.minItems) {
                Throw-SLContractError -Code 'validation-min-items' -Message "Array is shorter than minItems at $Path."
            }
        }
        if ($null -ne $Contract.PSObject.Properties['items']) {
            for ($Index = 0; $Index -lt $Value.Count; $Index += 1) {
                Assert-SLTypedValue -Value $Value[$Index] -Contract $Contract.items -Path "$Path[$Index]"
            }
        }
    }
    if ($Contract.type -ceq 'object') {
        $Names = if ($Value -is [System.Collections.IDictionary]) {
            @($Value.Keys | ForEach-Object { [string] $_ })
        }
        else {
            @($Value.PSObject.Properties.Name)
        }
        $Required = if ($null -ne $Contract.PSObject.Properties['required']) {
            @($Contract.required)
        }
        else {
            @()
        }
        if (@($Required | Where-Object { $_ -isnot [string] }).Count -gt 0) {
            Throw-SLContractError -Code 'validation-contract' -Message "required must be an array of strings at $Path."
        }
        foreach ($Name in $Required) {
            if ($Name -cnotin $Names) {
                Throw-SLContractError -Code 'validation-required' -Message "Missing required property '$Name' at $Path."
            }
        }
        $Properties = if ($null -ne $Contract.PSObject.Properties['properties']) {
            $Contract.properties
        }
        else {
            [pscustomobject] @{}
        }
        if ($Properties -isnot [pscustomobject]) {
            Throw-SLContractError -Code 'validation-contract' -Message "properties must be an object at $Path."
        }
        foreach ($Property in $Properties.PSObject.Properties) {
            if ($Property.Name -cin $Names) {
                $Child = $null
                if ($Value -is [System.Collections.IDictionary]) {
                    $Child = $Value[$Property.Name]
                }
                else {
                    $Child = $Value.($Property.Name)
                }
                Assert-SLTypedValue -Value $Child -Contract $Property.Value -Path "$Path.$($Property.Name)"
            }
        }
        if ($Contract.additionalProperties -eq $false) {
            foreach ($Name in $Names) {
                if ($Name -cnotin $Properties.PSObject.Properties.Name) {
                    Throw-SLContractError -Code 'validation-additional-property' -Message "Unexpected property '$Name' at $Path."
                }
            }
        }
        elseif (
            $null -ne $Contract.PSObject.Properties['additionalProperties'] -and
            $Contract.additionalProperties -ne $true
        ) {
            Throw-SLContractError -Code 'validation-contract' -Message "additionalProperties must be a boolean at $Path."
        }
    }
}

function ConvertTo-SLNormalizedGlob {
    param([Parameter(Mandatory)][string] $Pattern)

    $Normalized = $Pattern.Trim().Replace('\', '/')
    while ($Normalized.Contains('//')) {
        $Normalized = $Normalized.Replace('//', '/')
    }
    if (
        -not $Normalized -or
        $Normalized.StartsWith('/') -or
        $Normalized -match '^[A-Za-z]:' -or
        $Normalized.StartsWith('!') -or
        $Normalized.StartsWith('#') -or
        $Normalized.EndsWith('/') -or
        @($Normalized.Split('/') | Where-Object { $_ -ceq '..' -or $_ -ceq '.' }).Count -gt 0
    ) {
        Throw-SLContractError -Code 'glob-path' -Message "Glob must be a normalized repository-relative pattern: $Pattern"
    }
    if ($Normalized -match '[\[\]{}()|+@]' -or $Normalized.Contains('***')) {
        Throw-SLContractError -Code 'glob-syntax' -Message "Unsupported glob syntax: $Pattern"
    }
    return $Normalized
}

function Test-SLGlob {
    param(
        [Parameter(Mandatory)]
        [string] $Pattern,

        [Parameter(Mandatory)]
        [string] $Path
    )

    $NormalizedPattern = ConvertTo-SLNormalizedGlob -Pattern $Pattern
    $NormalizedPath = ConvertTo-SLNormalizedPath -Path $Path
    if ($NormalizedPath -ceq '.') {
        return $NormalizedPattern -ceq '**'
    }
    $Expression = '^'
    $Index = 0
    $TrailingGlobstar = $NormalizedPattern.EndsWith('/**')
    $ScanLimit = if ($TrailingGlobstar) {
        $NormalizedPattern.Length - 3
    }
    else {
        $NormalizedPattern.Length
    }
    while ($Index -lt $ScanLimit) {
        if (
            $Index + 3 -le $ScanLimit -and
            $NormalizedPattern.Substring($Index, 3) -ceq '**/'
        ) {
            $Expression += '(?:.*/)?'
            $Index += 3
            continue
        }
        $Character = $NormalizedPattern[$Index]
        if ($Character -ceq '*') {
            if (
                $Index + 1 -lt $ScanLimit -and
                $NormalizedPattern[$Index + 1] -ceq '*'
            ) {
                $Expression += '.*'
                $Index += 2
            }
            else {
                $Expression += '[^/]*'
                $Index += 1
            }
        }
        elseif ($Character -ceq '?') {
            $Expression += '[^/]'
            $Index += 1
        }
        else {
            $Expression += [Regex]::Escape([string] $Character)
            $Index += 1
        }
    }
    if ($TrailingGlobstar) {
        $Expression += '(?:/.*)?'
    }
    $Expression += '$'
    return [Regex]::IsMatch($NormalizedPath, $Expression, [Text.RegularExpressions.RegexOptions]::CultureInvariant)
}
