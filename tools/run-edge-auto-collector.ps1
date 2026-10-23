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
function Get-EdgeAutoStartupAcknowledgement {
  param([object]$Page,[string]$Token,[string]$ExpectedVersion)
  if (-not $Page) { return 'pending' }
  if ([string]$Page.url -like 'chrome-error:*' -or [string]$Page.title -match 'ERR_BLOCKED_BY_CLIENT') { return 'blocked' }
  $pageUri = $null
  if (-not [Uri]::TryCreate([string]$Page.url,[UriKind]::Absolute,[ref]$pageUri) -or
      $pageUri.Scheme -ne 'https' -or $pageUri.Host -notin @('js-map.com','www.js-map.com') -or
      $pageUri.AbsolutePath -notin @('/collector-install','/collector-install/','/collector-install.html')) { return 'blocked' }
  $prefix = 'JS_AUTO_ACK_V79:' + $Token + ':' + $ExpectedVersion + ':'
  if (-not ([string]$Page.title).StartsWith($prefix,[StringComparison]::Ordinal)) { return 'pending' }
  $result = ([string]$Page.title).Substring($prefix.Length)
  if ($result -in @('active','queued','skipped','busy','idle','unavailable','update-required','failed','unconfirmed')) { return $result }
  return 'pending'
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

# Reuse the dedicated profile. A new scheduled signal must never terminate
# an overnight sale, lease collection, or an uncertain in-flight save.

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
  $debugOwners = @(Get-NetTCPConnection -LocalPort 9223 -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
  $ownedProcesses = @(Get-EdgeAutoProfileProcesses -ProfilePath $profilePath | Select-Object -ExpandProperty ProcessId)
  if ($debugOwners.Count -ne 1 -or $debugOwners[0] -notin $ownedProcesses) {
    throw '브라우저 연결 포트가 수집 전용 프로필 소유가 아니므로 실행 신호를 보내지 않았습니다.'
  }
  $openAutorun = {
    param([long]$Token)
    # The existing permitted HTTPS content bridge wakes the same extension.
    # Do not infer success from navigating to an extension-internal page:
    # Edge can replace it with ERR_BLOCKED_BY_CLIENT and change its URL.
    $autorunUrl = "https://js-map.com/collector-install?js_auto_run=1&js_auto_force=$forceValue&js_auto_token=$Token&js_auto_expected=$expectedVersion"
    $encodedUrl = [Uri]::EscapeDataString($autorunUrl)
    $created = Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:9223/json/new?$encodedUrl" -TimeoutSec 5
    if (-not $created.id) { throw '실행 요청 페이지의 고유번호를 확인하지 못했습니다.' }
    return $created
  }
  $expectedVersion = (Get-Content -LiteralPath (Join-Path $extensionPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $trigger = & $openAutorun $runToken
  $triggerDeadline = (Get-Date).AddSeconds(45)
  $acknowledgement = 'pending'
  do {
    Start-Sleep -Milliseconds 500
    $page = @(Get-EdgeAutoDebugPages | Where-Object { $_.id -eq $trigger.id }) | Select-Object -First 1
    $acknowledgement = Get-EdgeAutoStartupAcknowledgement -Page $page -Token ([string]$runToken) -ExpectedVersion $expectedVersion
  } while ($acknowledgement -eq 'pending' -and (Get-Date) -lt $triggerDeadline)
  if ($acknowledgement -notin @('active','queued','skipped','busy')) {
    throw ('자동수집의 실제 응답을 확인하지 못했습니다 (' + $acknowledgement + '). 차단·미연결을 실행 성공으로 처리하지 않았습니다. 확장 관리 화면의 다시 로드 후 상태를 확인해 주세요.')
  }
  # Keep the acknowledged HTTPS status page. No provider/failed tab is closed.
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
  $ackMessage = switch ($acknowledgement) {
    'active' { '자동수집 실제 실행 확인' }
    'queued' { '예약 요청 접수 확인: 현재 수집 종료 후 대기 실행' }
    'skipped' { '예약 조건 확인: 오늘 실행 중복 또는 미실행 조건으로 새 수집을 시작하지 않음' }
    'busy' { '기존 매매 수집 진행 확인: 상가임대 시작 완료로 기록하지 않음' }
  }
  Write-AutoCollectorLog 'INFO' ($ackMessage + ' · 실행기 ' + $expectedVersion)
}
