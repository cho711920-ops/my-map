$ErrorActionPreference = 'Stop'
$taskName = 'JSMap Auto Collector'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Write-Output 'JSMap Auto Collector 예약 작업을 제거했습니다. 로그인 프로필과 실행 기록은 복구를 위해 보존했습니다.'
