function Write-EdgeAutoScheduleSnapshot {
  param([Parameter(Mandatory = $true)][string]$ExtensionPath)
  # Reads only this application's scheduled task. No account, command line or
  # filesystem paths are included in the extension's operational snapshot.
  $snapshot = @{ checkedAt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); schedule = ''; nextRunAt = $null; taskState = 'Unknown' }
  try {
    $collectorTask = Get-ScheduledTask -TaskName 'JSMap Auto Collector' -ErrorAction Stop
    $collectorInfo = Get-ScheduledTaskInfo -TaskName 'JSMap Auto Collector' -ErrorAction Stop
    $boundaries = @($collectorTask.Triggers | Where-Object { $_.StartBoundary })
    if ($boundaries.Count -eq 1) { $snapshot.schedule = ([datetime]::Parse($boundaries[0].StartBoundary)).ToString('HH:mm') }
    $snapshot.taskState = [string]$collectorTask.State
    if ($collectorInfo.NextRunTime -and $collectorInfo.NextRunTime.Year -ge 2020) {
      $snapshot.nextRunAt = ([DateTimeOffset]$collectorInfo.NextRunTime).ToUnixTimeMilliseconds()
    }
  } catch { }
  $snapshotPath = Join-Path $ExtensionPath 'windows-schedule.json'
  $expectedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'JSMap\EdgeAutoCollector\extension'))
  if ([IO.Path]::GetFullPath($ExtensionPath).TrimEnd('\') -ne $expectedRoot.TrimEnd('\')) { throw '예약 상태 저장 경로를 확인해 주세요.' }
  $snapshot | ConvertTo-Json -Compress | Set-Content -LiteralPath $snapshotPath -Encoding UTF8
}
