param([switch]$ValidateOnly)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'edge-auto-profile.ps1')
$automationRoot = Join-Path $env:LOCALAPPDATA 'JSMap\EdgeAutoCollector'
$profilePath = Join-Path $automationRoot 'profile'
$extensionPath = Join-Path $automationRoot 'extension'
$logDirectory = Join-Path $automationRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logFile = Join-Path $logDirectory 'open-settings.log'

try {
  $manifest = Get-Content -LiteralPath (Join-Path $extensionPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.options_page -ne 'options.html') { throw '설치된 자동수집 설정 화면을 확인하지 못했습니다.' }
  $extensionIds = @()
  foreach ($file in @('Secure Preferences', 'Preferences')) {
    $preferencePath = Join-Path $profilePath ('Default\' + $file)
    if (-not (Test-Path -LiteralPath $preferencePath)) { continue }
    $preferences = Get-Content -LiteralPath $preferencePath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($entry in $preferences.extensions.settings.PSObject.Properties) {
      if ($entry.Name -match '^[a-p]{32}$' -and
          [StringComparer]::OrdinalIgnoreCase.Equals([string]$entry.Value.path, $extensionPath)) {
        $extensionIds += $entry.Name
      }
    }
  }
  $extensionIds = @($extensionIds | Select-Object -Unique)
  if ($extensionIds.Count -ne 1) { throw '전용 프로필에 설치된 자동수집 확장 ID를 확인하지 못했습니다.' }
  $settingsUrl = 'chrome-extension://' + $extensionIds[0] + '/options.html'
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
  )
  $edgePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $edgePath) { throw 'Microsoft Edge를 찾지 못했습니다.' }
  if ($ValidateOnly) {
    [pscustomobject]@{ EdgeExists = $true; ExtensionVersion = $manifest.version; SettingsUrl = $settingsUrl; Profile = $profilePath }
    return
  }

  # A command-line extension URL can be blocked before the extension is ready.
  # Bootstrap the existing dedicated profile with an ordinary new tab first.
  # Never terminate a browser or send a scheduled/forced collection trigger.
  $arguments = @(
    "--user-data-dir=`"$profilePath`"", "--load-extension=`"$extensionPath`"",
    "--disable-extensions-except=`"$extensionPath`"", '--no-first-run',
    '--disable-features=msEdgeFirstRunExperience', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--remote-debugging-port=9223', '--new-window', 'edge://newtab/'
  )
  Start-Process -FilePath $edgePath -ArgumentList $arguments -WindowStyle Normal
  $deadline = (Get-Date).AddSeconds(30)
  $ready = $false
  do {
    try {
      Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/version' -TimeoutSec 2 | Out-Null
      $ready = $true
      break
    } catch { Start-Sleep -Milliseconds 500 }
  } while ((Get-Date) -lt $deadline)
  if (-not $ready) { throw '자동수집 전용 브라우저가 준비되지 않았습니다.' }
  if (-not @(Get-EdgeAutoProfileProcesses -ProfilePath $profilePath).Count) {
    throw '전용 프로필을 확인하지 못해 다른 브라우저에는 연결하지 않았습니다.'
  }
  $encoded = [Uri]::EscapeDataString($settingsUrl)
  Invoke-RestMethod -Method Put -Uri ('http://127.0.0.1:9223/json/new?' + $encoded) -TimeoutSec 5 | Out-Null
  Add-Content -LiteralPath $logFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' 설정 화면 열기 완료') -Encoding UTF8
} catch {
  Add-Content -LiteralPath $logFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ERROR ' + $_.Exception.Message) -Encoding UTF8
  throw
}
