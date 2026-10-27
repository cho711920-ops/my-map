param(
  [string]$Schedule = '11:00',
  [switch]$SkipSetup
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'edge-auto-profile.ps1')
if ($Schedule -notmatch '^([01]\d|2[0-3]):[0-5]\d$') {
  throw '실행 시간은 HH:mm 형식으로 입력해주세요. 예: 11:00'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceExtension = Join-Path $repoRoot 'edge-automation\extension'
$sourceLauncher = Join-Path $PSScriptRoot 'run-edge-auto-collector.ps1'
$automationRoot = Join-Path $env:LOCALAPPDATA 'JSMap\EdgeAutoCollector'
$installedExtension = Join-Path $automationRoot 'extension'
$installedCollectors = Join-Path $installedExtension 'collectors'
$installedLauncher = Join-Path $automationRoot 'run-edge-auto-collector.ps1'
$profilePath = Join-Path $automationRoot 'profile'
$taskName = 'JSMap Auto Collector'

if (-not (Test-Path -LiteralPath (Join-Path $sourceExtension 'manifest.json'))) {
  throw '확장 프로그램 원본을 찾지 못했습니다.'
}

New-Item -ItemType Directory -Force -Path $automationRoot | Out-Null
New-Item -ItemType Directory -Force -Path $installedExtension | Out-Null
New-Item -ItemType Directory -Force -Path $installedCollectors | Out-Null

# Unpacked Manifest V3 service workers can keep the previous background.js in
# memory even after files are replaced. Stop only the dedicated automation
# profile before copying so the next launch is guaranteed to load this build.
Get-EdgeAutoProfileProcesses -ProfilePath $profilePath |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$stopDeadline = (Get-Date).AddSeconds(12)
do {
  Start-Sleep -Milliseconds 250
  $stillRunning = @(Get-EdgeAutoProfileProcesses -ProfilePath $profilePath)
} while ($stillRunning.Count -and (Get-Date) -lt $stopDeadline)
if ($stillRunning.Count) { throw '전용 수집 브라우저가 종료되지 않아 코드 교체를 중단했습니다.' }

Copy-Item -Path (Join-Path $sourceExtension '*') -Destination $installedExtension -Recurse -Force
foreach ($collectorFile in @('naver-collector.js', 'daangn-collector.js', 'gongsil-collector.js')) {
  Copy-Item -LiteralPath (Join-Path $repoRoot "js\$collectorFile") -Destination (Join-Path $installedCollectors $collectorFile) -Force
}
Copy-Item -LiteralPath $sourceLauncher -Destination $installedLauncher -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'edge-auto-profile.ps1') -Destination (Join-Path $automationRoot 'edge-auto-profile.ps1') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'open-edge-auto-status.ps1') -Destination (Join-Path $automationRoot 'open-edge-auto-status.ps1') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'read-edge-auto-schedule.ps1') -Destination (Join-Path $automationRoot 'read-edge-auto-schedule.ps1') -Force

$powerShellPath = (Get-Command powershell.exe).Source
$taskArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$installedLauncher`""
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $taskArguments
$scheduleTime = [datetime]::ParseExact($Schedule, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$trigger = New-ScheduledTaskTrigger -Daily -At $scheduleTime
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'JS부동산 Edge 자동수집' -Force | Out-Null
. (Join-Path $PSScriptRoot 'read-edge-auto-schedule.ps1')
Write-EdgeAutoScheduleSnapshot -ExtensionPath $installedExtension

$summary = [pscustomobject]@{
  TaskName = $taskName
  Schedule = "$Schedule (매일 1회, 놓친 경우 다음 로그인 후 실행)"
  Extension = $installedExtension
  Profile = (Join-Path $automationRoot 'profile')
  Status = 'Installed'
}
$summary | Format-List

if (-not $SkipSetup) {
  & $installedLauncher -Setup
}
