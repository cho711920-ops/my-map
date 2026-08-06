param(
  [string]$Schedule = '06:00',
  [switch]$SkipSetup
)

$ErrorActionPreference = 'Stop'
if ($Schedule -notmatch '^([01]\d|2[0-3]):[0-5]\d$') {
  throw '실행 시간은 HH:mm 형식으로 입력해주세요. 예: 06:00'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceExtension = Join-Path $repoRoot 'edge-automation\extension'
$sourceLauncher = Join-Path $PSScriptRoot 'run-edge-auto-collector.ps1'
$automationRoot = Join-Path $env:LOCALAPPDATA 'JSMap\EdgeAutoCollector'
$installedExtension = Join-Path $automationRoot 'extension'
$installedLauncher = Join-Path $automationRoot 'run-edge-auto-collector.ps1'
$taskName = 'JSMap Auto Collector'

if (-not (Test-Path -LiteralPath (Join-Path $sourceExtension 'manifest.json'))) {
  throw '확장 프로그램 원본을 찾지 못했습니다.'
}

New-Item -ItemType Directory -Force -Path $automationRoot | Out-Null
New-Item -ItemType Directory -Force -Path $installedExtension | Out-Null
Copy-Item -Path (Join-Path $sourceExtension '*') -Destination $installedExtension -Recurse -Force
Copy-Item -LiteralPath $sourceLauncher -Destination $installedLauncher -Force

$powerShellPath = (Get-Command powershell.exe).Source
$taskArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$installedLauncher`""
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $taskArguments
$trigger = New-ScheduledTaskTrigger -Once -At ([datetime]::Today) `
  -RepetitionInterval (New-TimeSpan -Minutes 30) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'JS부동산 Edge 자동수집' -Force | Out-Null

$summary = [pscustomobject]@{
  TaskName = $taskName
  Schedule = "$Schedule (Windows 확인 주기 30분)"
  Extension = $installedExtension
  Profile = (Join-Path $automationRoot 'profile')
  Status = 'Installed'
}
$summary | Format-List

if (-not $SkipSetup) {
  & $installedLauncher -Setup
}
