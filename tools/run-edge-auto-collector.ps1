param(
  [switch]$Setup
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
  '--disable-features=msEdgeFirstRunExperience'
)

if ($Setup) {
  $arguments += @(
    'https://js-map.com/collector-install?edge_auto_setup=1',
    'https://fin.land.naver.com/map',
    'https://realty.daangn.com',
    'https://www.gongsilbox.com/maps/sg?lat=36.36012050&lng=127.37906660&zoom=13'
  )
} else {
  $arguments += @(
    '--start-minimized',
    'https://js-map.com/collector-install?js_auto_run=1'
  )
}

if ($Setup) {
  Start-Process -FilePath $edgePath -ArgumentList $arguments
} else {
  Start-Process -FilePath $edgePath -ArgumentList $arguments -WindowStyle Hidden
}
