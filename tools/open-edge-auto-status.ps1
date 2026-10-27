# Open the extension's options through its own API. Direct browser navigation
# to an extension-internal URL can be rejected by Edge (ERR_BLOCKED_BY_CLIENT).
function Open-EdgeAutoStatusPage {
  param([string]$ProfilePath,[string]$ExtensionId,[int]$TimeoutSeconds = 8)
  if ($ExtensionId -notmatch '^[a-p]{32}$') { throw '수집기 확장 ID가 올바르지 않습니다.' }
  Assert-EdgeAutoDebugOwner -ProfilePath $ProfilePath
  $targets = Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/list' -TimeoutSec 3
  $workerUrl = 'chrome-extension://' + $ExtensionId + '/background.js'
  $worker = @($targets | Where-Object { $_.type -eq 'service_worker' -and $_.url -ceq $workerUrl }) | Select-Object -First 1
  if (-not $worker) { throw '수집 목록을 열 확장 실행 컨텍스트를 찾지 못했습니다.' }
  $socketUri = $null
  if (-not [Uri]::TryCreate([string]$worker.webSocketDebuggerUrl,[UriKind]::Absolute,[ref]$socketUri) -or
      $socketUri.Scheme -ne 'ws' -or $socketUri.Host -ne '127.0.0.1' -or $socketUri.Port -ne 9223 -or
      $socketUri.AbsolutePath -notlike '/devtools/page/*' -or $socketUri.UserInfo) {
    throw '수집기 전용 로컬 연결 주소가 올바르지 않습니다.'
  }
  $socket = [Net.WebSockets.ClientWebSocket]::new()
  $cancel = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($TimeoutSeconds))
  try {
    $socket.ConnectAsync($socketUri,$cancel.Token).GetAwaiter().GetResult() | Out-Null
    # No storage, credentials, provider page or collection mutation is accessed.
    # openOptionsPage reuses an existing options tab instead of creating copies.
    $expression = '(async () => { if (chrome.runtime.id !== "' + $ExtensionId + '") throw new Error("wrong extension"); await chrome.runtime.openOptionsPage(); return true; })()'
    $command = @{id=1;method='Runtime.evaluate';params=@{expression=$expression;awaitPromise=$true;returnByValue=$true;timeout=5000}} | ConvertTo-Json -Depth 4 -Compress
    $payload = [Text.Encoding]::UTF8.GetBytes($command)
    $socket.SendAsync([ArraySegment[byte]]::new($payload),[Net.WebSockets.WebSocketMessageType]::Text,$true,$cancel.Token).GetAwaiter().GetResult() | Out-Null
    $buffer = [byte[]]::new(4096)
    do {
      $message = [IO.MemoryStream]::new()
      try {
        do {
          $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),$cancel.Token).GetAwaiter().GetResult()
          if ($received.MessageType -ne [Net.WebSockets.WebSocketMessageType]::Text) { throw '수집 목록 열기 연결이 종료됐습니다.' }
          $message.Write($buffer,0,$received.Count)
          if ($message.Length -gt 65536) { throw '수집 목록 열기 응답이 너무 큽니다.' }
        } while (-not $received.EndOfMessage)
        $reply = [Text.Encoding]::UTF8.GetString($message.ToArray()) | ConvertFrom-Json
      } finally { $message.Dispose() }
    } while ($reply.id -ne 1)
    if ($reply.error -or $reply.result.exceptionDetails -or $reply.result.result.value -ne $true) {
      throw '확장에서 수집 목록 창을 열지 못했습니다.'
    }
  } finally {
    $socket.Dispose()
    $cancel.Dispose()
  }
  $optionsUrl = 'chrome-extension://' + $ExtensionId + '/options.html'
  $deadline = (Get-Date).AddSeconds(3)
  do {
    $statusPage = @(Get-EdgeAutoDebugPages | Where-Object { $_.url -ceq $optionsUrl }) | Select-Object -First 1
    if ($statusPage) { return $true }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw '수집 목록 창의 실제 열림을 확인하지 못했습니다.'
}
