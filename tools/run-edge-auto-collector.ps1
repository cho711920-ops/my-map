param(
  [switch]$Setup,
  [switch]$Force,
  [switch]$Debug
)

$ErrorActionPreference = 'Stop'
$edgeCandidates = @(@(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })

if (-not $edgeCandidates.Count) {
  throw 'Microsoft Edge를 찾지 못했습니다.'
}

$edgePath = $edgeCandidates | Select-Object -First 1
$automationRoot = Join-Path $env:LOCALAPPDATA 'JSMap\EdgeAutoCollector'
$extensionPath = Join-Path $automationRoot 'extension'
$profilePath = Join-Path $automationRoot 'profile'

if (-not (Test-Path -LiteralPath (Join-Path $extensionPath 'manifest.json'))) {
  throw 'JS 자동수집 확장 프로그램이 설치되지 않았습니다. install-edge-auto-collector.ps1을 먼저 실행해주세요.'
}

$arguments = @(
  "--user-data-dir=$profilePath",
  "--load-extension=$extensionPath",
  "--disable-extensions-except=$extensionPath",
  '--no-first-run',
  '--disable-features=msEdgeFirstRunExperience',
  '--remote-debugging-port=9223'
)

# Edge may ignore a new automation URL when the dedicated profile already has
# a minimized browser process. Restart only this dedicated profile before a
# scheduled/forced run. Extension storage and collector checkpoints live in
# the profile and D1, so an interrupted target resumes from its saved point.
if (-not $Setup) {
  $automationProcesses = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
    Where-Object { $_.CommandLine -like "*$profilePath*" })
  if ($automationProcesses.Count) {
    $automationProcesses |
      Sort-Object { if ($_.CommandLine -like '*--type=*') { 1 } else { 0 } } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $deadline = (Get-Date).AddSeconds(12)
    do {
      Start-Sleep -Milliseconds 250
      $stillRunning = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
        Where-Object { $_.CommandLine -like "*$profilePath*" })
    } while ($stillRunning.Count -and (Get-Date) -lt $deadline)
  }
}

if ($Setup) {
  $arguments += @(
    'https://js-map.com/collector-install?edge_auto_setup=1',
    'https://fin.land.naver.com/map',
    'https://realty.daangn.com',
    'https://www.gongsilbox.com/maps/sg?lat=36.36012050&lng=127.37906660&zoom=13'
  )
} else {
  $runToken = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $extensionStorageRoot = Join-Path $profilePath 'Default\Local Extension Settings'
  $extensionId = Get-ChildItem -LiteralPath $extensionStorageRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object {
      Get-ChildItem -LiteralPath $_.FullName -File -ErrorAction SilentlyContinue |
        Select-String -SimpleMatch 'jsAutoCollectorConfigV1' -Quiet -ErrorAction SilentlyContinue
    } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty Name
  if (-not $extensionId -or $extensionId -notmatch '^[a-p]{32}$') {
    throw 'JS 자동수집 확장 프로그램 ID를 찾지 못했습니다. 설치 화면을 한 번 열어주세요.'
  }
  $forceValue = if ($Force) { '1' } else { '0' }
  if (-not $Force) { $arguments += '--start-minimized' }
  $arguments += @('--new-tab', 'edge://newtab/')
}

if ($Setup) {
  Start-Process -FilePath $edgePath -ArgumentList $arguments
} else {
  if ($Force) {
    Start-Process -FilePath $edgePath -ArgumentList $arguments
  } else {
    Start-Process -FilePath $edgePath -ArgumentList $arguments -WindowStyle Hidden
  }
  $debugReady = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    try {
      Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/version' -TimeoutSec 1 | Out-Null
      $debugReady = $true
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $debugReady) {
    throw '전용 Edge 자동수집 실행기에 연결하지 못했습니다.'
  }
  $openAutorun = {
    param([long]$Token)
    $autorunUrl = "chrome-extension://$extensionId/autorun.html?force=$forceValue&run=$Token"
    $encodedUrl = [Uri]::EscapeDataString($autorunUrl)
    Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:9223/json/new?$encodedUrl" -TimeoutSec 5 | Out-Null
  }
  & $openAutorun $runToken
  # The first internal page reloads a stale MV3 service worker after an
  # extension upgrade. A second idempotent trigger starts the run with the
  # fresh worker, or simply observes the already active run on normal days.
  Start-Sleep -Seconds 4
  & $openAutorun ([DateTimeOffset]::Now.ToUnixTimeMilliseconds())
  Start-Sleep -Seconds 2
  # Keep the live per-district status page visible after the short autorun
  # trigger tabs close themselves. Reuse an existing status tab when Edge
  # restores the dedicated profile instead of opening duplicates.
  $statusUrl = "chrome-extension://$extensionId/options.html"
  $openPages = @(Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/list' -TimeoutSec 5)
  if (-not ($openPages | Where-Object { $_.type -eq 'page' -and $_.url -eq $statusUrl })) {
    $encodedStatusUrl = [Uri]::EscapeDataString($statusUrl)
    Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:9223/json/new?$encodedStatusUrl" -TimeoutSec 5 | Out-Null
  }
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class JSMapWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
    Where-Object { $_.CommandLine -like "*$profilePath*" -and $_.CommandLine -notlike '*--type=*' } |
    ForEach-Object {
      $edgeProcess = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
      if ($edgeProcess -and $edgeProcess.MainWindowHandle -ne 0) {
        $showMode = if ($Force) { 9 } else { 6 }
        [JSMapWindow]::ShowWindow($edgeProcess.MainWindowHandle, $showMode) | Out-Null
      }
    }
}
