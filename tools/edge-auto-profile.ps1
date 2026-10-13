# Compare the parsed user-data-dir argument, never an arbitrary path substring.
# Edge child processes can spell separators and quotes with extra backslashes.
function ConvertTo-EdgeAutoCanonicalProfilePath {
  param([AllowEmptyString()][string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  $normalized = $Value.Trim().Replace('/', '\')
  $isUnc = $normalized.StartsWith('\\')
  $normalized = [regex]::Replace($normalized, '\\{2,}', '\')
  if ($isUnc) { $normalized = '\' + $normalized }
  if ($normalized -notmatch '^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+)') { return '' }
  try { return [IO.Path]::GetFullPath($normalized).TrimEnd('\') } catch { return '' }
}

function Get-EdgeAutoCommandProfilePath {
  param([AllowEmptyString()][string]$CommandLine)
  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return '' }
  $decoded = [regex]::Replace($CommandLine, '\\+"', '"')
  $argumentMatches = [regex]::Matches($decoded, '(?i)(?:^|\s)(?<outer>")?--user-data-dir(?:=|\s+)(?<inner>")?')
  $profile = ''
  foreach ($match in $argumentMatches) {
    # Do not recognize a switch mentioned inside a quoted URL or other value.
    if (([regex]::Matches($decoded.Substring(0, $match.Index), '"').Count % 2) -ne 0) { continue }
    $tail = $decoded.Substring($match.Index + $match.Length)
    $quoted = $match.Groups['outer'].Success -or $match.Groups['inner'].Success
    $value = if ($quoted) { [regex]::Match($tail, '^(?<path>[^"\r\n]*)"') } else { [regex]::Match($tail, '^(?<path>[^\s"]+)') }
    $profile = if ($value.Success) { ConvertTo-EdgeAutoCanonicalProfilePath $value.Groups['path'].Value } else { '' }
  }
  return $profile
}

function Test-EdgeAutoProfileCommandLine {
  param([AllowEmptyString()][string]$CommandLine, [Parameter(Mandatory = $true)][string]$ProfilePath)
  $expected = ConvertTo-EdgeAutoCanonicalProfilePath $ProfilePath
  $actual = Get-EdgeAutoCommandProfilePath $CommandLine
  return $expected -and $actual -and [StringComparer]::OrdinalIgnoreCase.Equals($expected, $actual)
}

function Get-EdgeAutoProfileProcesses {
  param([Parameter(Mandatory = $true)][string]$ProfilePath, [object[]]$Processes)
  if (-not (ConvertTo-EdgeAutoCanonicalProfilePath $ProfilePath)) { throw 'An absolute collector profile path is required.' }
  if (-not $PSBoundParameters.ContainsKey('Processes')) {
    $Processes = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction Stop)
  }
  $Processes | Where-Object {
    $_.Name -eq 'msedge.exe' -and (Test-EdgeAutoProfileCommandLine -CommandLine $_.CommandLine -ProfilePath $ProfilePath)
  }
}
