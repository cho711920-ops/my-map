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
function Test-EdgeAutoTransientConnectionError {
  param([object]$Failure)
  $exception = $Failure.Exception
  while ($exception) {
    if ($exception -is [Net.WebException]) {
      if (-not $exception.Response) { return $true }
      return ([int]$exception.Response.StatusCode -in @(408,429,500,502,503,504))
    }
    if ($exception -is [IO.IOException] -or $exception -is [Net.Sockets.SocketException]) { return $true }
    $exception = $exception.InnerException
  }
  return $false
}
function Assert-EdgeAutoDebugOwner {
  param([string]$ProfilePath)
  $debugOwners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq 9223 } | Select-Object -ExpandProperty OwningProcess -Unique)
  if (-not $debugOwners.Count) {
    throw [Net.WebException]::new('전용 브라우저 연결 포트 대기 중', [Net.WebExceptionStatus]::ConnectFailure)
  }
  $ownedProcesses = @(Get-EdgeAutoProfileProcesses -ProfilePath $ProfilePath | Select-Object -ExpandProperty ProcessId)
  if ($debugOwners.Count -ne 1 -or $debugOwners[0] -notin $ownedProcesses) {
    throw '브라우저 연결 포트가 수집 전용 프로필 소유가 아니므로 실행 신호를 보내지 않았습니다.'
  }
}
function Invoke-EdgeAutoStartup {
  param([long]$Token,[string]$ExpectedVersion,[string]$ProfilePath,[string]$ForceValue,
    [double]$TimeoutSeconds = 45,[int]$PollMilliseconds = 500)
  $autorunUrl = "https://js-map.com/collector-install?js_auto_run=1&js_auto_force=$ForceValue&js_auto_token=$Token&js_auto_expected=$ExpectedVersion"
  foreach ($stage in @('debug-ready','open-request','acknowledgement')) {
    $script:edgeAutoStage = $stage
    Write-AutoCollectorLog 'INFO' ('시작 단계: ' + $stage)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $ready = $false
    $connectionFailures = 0
    $createIssued = $false
    do {
      $creating = $false
      try {
        # A missing listener may reconnect; another profile's owner is a fatal
        # error. Check again before every request, including after reconnection.
        if ($stage -ne 'debug-ready') { Assert-EdgeAutoDebugOwner -ProfilePath $ProfilePath }
        if ($stage -eq 'debug-ready') {
          Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/version' -TimeoutSec 2 | Out-Null
          $ready = $true
        } elseif ($stage -eq 'open-request') {
          # A PUT can succeed even when its response is lost. Recover the same
          # token's tab before considering a new request; never blindly resend.
          $trigger = @(Get-EdgeAutoDebugPages | Where-Object { $_.url -eq $autorunUrl }) | Select-Object -First 1
          if (-not $trigger -and -not $createIssued) {
            $encodedUrl = [Uri]::EscapeDataString($autorunUrl)
            $createIssued = $true
            $creating = $true
            $trigger = Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:9223/json/new?$encodedUrl" -TimeoutSec 5
            if (-not $trigger.id) { throw '실행 요청 페이지의 고유번호를 확인하지 못했습니다.' }
          }
          $ready = [bool]($trigger -and $trigger.id)
        } else {
          $page = @(Get-EdgeAutoDebugPages | Where-Object { $_.id -eq $trigger.id }) | Select-Object -First 1
          $acknowledgement = Get-EdgeAutoStartupAcknowledgement -Page $page -Token ([string]$Token) -ExpectedVersion $ExpectedVersion
          if ($acknowledgement -ne 'pending') {
            if ($acknowledgement -notin @('active','queued','skipped','busy')) {
              throw ('자동수집의 실제 응답을 확인하지 못했습니다 (' + $acknowledgement + '). 실행 성공으로 처리하지 않았습니다.')
            }
            $ready = $true
          }
        }
      } catch {
        if (-not (Test-EdgeAutoTransientConnectionError -Failure $_)) { throw }
        $connectionFailures++
        if ($connectionFailures -eq 1) { Write-AutoCollectorLog 'WARN' ('일시 연결 오류, 제한 시간 내 재연결: ' + $stage) }
        # ConnectFailure means the TCP connection never opened. For timeouts or
        # lost responses keep createIssued=true and only recover the existing tab.
        if ($creating -and $_.Exception -is [Net.WebException] -and
            $_.Exception.Status -eq [Net.WebExceptionStatus]::ConnectFailure) { $createIssued = $false }
      }
      if ($ready) { break }
      Start-Sleep -Milliseconds $PollMilliseconds
    } while ((Get-Date) -lt $deadline)
    if (-not $ready) { throw ('자동수집 시작 제한 시간 초과: ' + $stage + ' (연결 오류 ' + $connectionFailures + '회). 수집 성공으로 기록하지 않았습니다.') }
    if ($connectionFailures) { Write-AutoCollectorLog 'INFO' ('재연결 성공: ' + $stage + ' · 오류 ' + $connectionFailures + '회') }
  }
  return $acknowledgement
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
  Write-AutoCollectorLog 'ERROR' ('단계=' + $script:edgeAutoStage + ' · 줄=' + $_.InvocationInfo.ScriptLineNumber + ' · ' + $_.Exception.GetType().Name + ' · ' + [string]$_.Exception.Message)
  exit 1
}
$launchMessage = 'Windows 예약실행 시작'
if ($Setup) {
  $launchMessage = '자동수집 초기 설정 시작'
} elseif ($Force) {
  $launchMessage = '상가임대 수동 전체실행 시작 (매매 제외)'
}
Write-AutoCollectorLog 'INFO' $launchMessage
$script:edgeAutoStage = 'configuration'

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
  $script:edgeAutoStage = 'launch-browser'
  if ($Force) {
    Start-Process -FilePath $edgePath -ArgumentList $arguments
  } else {
    Start-Process -FilePath $edgePath -ArgumentList $arguments -WindowStyle Hidden
  }
  $expectedVersion = (Get-Content -LiteralPath (Join-Path $extensionPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $acknowledgement = Invoke-EdgeAutoStartup -Token $runToken -ExpectedVersion $expectedVersion -ProfilePath $profilePath -ForceValue $forceValue
  $script:edgeAutoStage = 'window-state'
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
