param(
  [switch]$Setup,
  [switch]$Force,
  [switch]$Debug
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'edge-auto-profile.ps1')
function Get-EdgeAutoDebugPages {
  # Windows PowerShell passes an Invoke-RestMethod JSON array to a pipeline
  # as one object. Enumerate explicitly before inspecting individual tabs.
  $debugTargets = Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/list' -TimeoutSec 5
  foreach ($debugTarget in $debugTargets) {
    if ($debugTarget.type -eq 'page') { $debugTarget }
  }
}
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
$logPath = Join-Path $automationRoot 'logs'
New-Item -ItemType Directory -Path $logPath -Force | Out-Null
$dailyLog = Join-Path $logPath ((Get-Date).ToString('yyyy-MM-dd') + '.log')
function Write-AutoCollectorLog([string]$Level, [string]$Message) {
  $line = '{0} [{1}] {2}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff'), $Level, $Message
  Add-Content -LiteralPath $dailyLog -Value $line -Encoding UTF8
}
trap {
  Write-AutoCollectorLog 'ERROR' ([string]$_.Exception.Message)
  exit 1
}
$launchMessage = 'Windows 예약실행 시작'
if ($Setup) {
  $launchMessage = '자동수집 초기 설정 시작'
} elseif ($Force) {
  $launchMessage = '상가임대 수동 전체실행 시작 (매매 제외)'
}
Write-AutoCollectorLog 'INFO' $launchMessage

if (-not (Test-Path -LiteralPath (Join-Path $extensionPath 'manifest.json'))) {
  throw 'JS 자동수집 확장 프로그램이 설치되지 않았습니다. install-edge-auto-collector.ps1을 먼저 실행해주세요.'
}
$scheduleReader = Join-Path $PSScriptRoot 'read-edge-auto-schedule.ps1'
if (Test-Path -LiteralPath $scheduleReader) {
  . $scheduleReader
  Write-EdgeAutoScheduleSnapshot -ExtensionPath $extensionPath
}

$arguments = @(
  "--user-data-dir=`"$profilePath`"",
  "--load-extension=`"$extensionPath`"",
  "--disable-extensions-except=`"$extensionPath`"",
  '--no-first-run',
  '--disable-features=msEdgeFirstRunExperience',
  # Only the dedicated collection profile uses these scheduling switches.
  # Minimized/background pages otherwise stretch short polling timers to a
  # minute, even while the server has already finished the requested work.
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--remote-debugging-port=9223'
)

# Edge may ignore a new automation URL when the dedicated profile already has
# a minimized browser process. Restart only this dedicated profile before a
# scheduled/forced run. Extension storage and collector checkpoints live in
# the profile and D1, so an interrupted target resumes from its saved point.
if (-not $Setup) {
  $automationProcesses = @(Get-EdgeAutoProfileProcesses -ProfilePath $profilePath)
  if ($automationProcesses.Count) {
    $automationProcesses |
      Sort-Object { if ($_.CommandLine -like '*--type=*') { 1 } else { 0 } } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $deadline = (Get-Date).AddSeconds(12)
    do {
      Start-Sleep -Milliseconds 250
      $stillRunning = @(Get-EdgeAutoProfileProcesses -ProfilePath $profilePath)
    } while ($stillRunning.Count -and (Get-Date) -lt $deadline)
    if ($stillRunning.Count) { throw '전용 수집 브라우저 종료를 확인하지 못해 새 실행을 중단했습니다.' }
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
      # -Quiet emits one boolean per file; a nonempty array of only $false is
      # truthy in Windows PowerShell. Require an actual matching file instead.
      $configMatches = @(Get-ChildItem -LiteralPath $_.FullName -File -ErrorAction SilentlyContinue |
        Select-String -SimpleMatch 'jsAutoCollectorConfigV1' -Quiet -ErrorAction SilentlyContinue)
      $configMatches -contains $true
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
  $debugDeadline = (Get-Date).AddSeconds(45)
  do {
    try {
      Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/version' -TimeoutSec 2 | Out-Null
      $debugReady = $true
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  } while ((Get-Date) -lt $debugDeadline)
  if (-not $debugReady) {
    throw '전용 Edge 자동수집 실행기에 연결하지 못했습니다.'
  }
  $openAutorun = {
    param([long]$Token)
    $autorunUrl = "chrome-extension://$extensionId/autorun.html?force=$forceValue&run=$Token"
    $encodedUrl = [Uri]::EscapeDataString($autorunUrl)
    Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:9223/json/new?$encodedUrl" -TimeoutSec 5 | Out-Null
    return $autorunUrl
  }
  $firstTriggerUrl = & $openAutorun $runToken
  # Startup already recovers persisted work. Normally a single trigger closes
  # after its acknowledgement; only a still-pending page needs one follow-up.
  $triggerDeadline = (Get-Date).AddSeconds(25)
  do {
    Start-Sleep -Milliseconds 500
    $triggerPages = @(Get-EdgeAutoDebugPages |
      Where-Object { $_.url -eq $firstTriggerUrl })
  } while ($triggerPages.Count -and (Get-Date) -lt $triggerDeadline)
  if ($triggerPages.Count) {
    Write-AutoCollectorLog 'WARN' '첫 실행 신호 페이지가 남아 있어 업데이트된 실행기로 한 번만 재전송합니다.'
    $followupUrl = & $openAutorun ([DateTimeOffset]::Now.ToUnixTimeMilliseconds())
    $followupDeadline = (Get-Date).AddSeconds(10)
    do {
      Start-Sleep -Milliseconds 500
      $followupPages = @(Get-EdgeAutoDebugPages |
        Where-Object { $_.url -eq $followupUrl })
    } while ($followupPages.Count -and (Get-Date) -lt $followupDeadline)
  }
  # Keep the live per-district status page visible after the short autorun
  # trigger tabs close themselves. Reuse an existing status tab when Edge
  # restores the dedicated profile instead of opening duplicates.
  $statusUrl = "chrome-extension://$extensionId/options.html"
  $openPages = @(Get-EdgeAutoDebugPages)
  if (-not ($openPages | Where-Object { $_.url -eq $statusUrl })) {
    $encodedStatusUrl = [Uri]::EscapeDataString($statusUrl)
    Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:9223/json/new?$encodedStatusUrl" -TimeoutSec 5 | Out-Null
  }
  # Leave exactly one status page and the single provider collection tab.
  $cleanupPages = @(Get-EdgeAutoDebugPages |
    Where-Object { $_.url -like 'edge://newtab*' -or $_.url -like "chrome-extension://$extensionId/autorun.html*" })
  foreach ($page in $cleanupPages) {
    try { Invoke-RestMethod -Uri ("http://127.0.0.1:9223/json/close/" + $page.id) -TimeoutSec 3 | Out-Null } catch {}
  }
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class JSMapWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@
  Get-EdgeAutoProfileProcesses -ProfilePath $profilePath |
    Where-Object { $_.CommandLine -notlike '*--type=*' } |
    ForEach-Object {
      $edgeProcess = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
      if ($edgeProcess -and $edgeProcess.MainWindowHandle -ne 0) {
        $showMode = if ($Force) { 9 } else { 6 }
        [JSMapWindow]::ShowWindow($edgeProcess.MainWindowHandle, $showMode) | Out-Null
      }
    }
  Write-AutoCollectorLog 'INFO' 'Edge 연결 및 자동수집 실행 신호 전달 완료'
}
