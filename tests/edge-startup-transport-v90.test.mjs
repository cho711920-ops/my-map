import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const launcher = fs.readFileSync('tools/run-edge-auto-collector.ps1', 'utf8');
const functions = launcher.slice(launcher.indexOf('function Get-EdgeAutoDebugPages'), launcher.indexOf('$edgeCandidates'));

test('PowerShell launcher recovers transport failures without duplicate triggers or false success', {skip: process.platform !== 'win32'}, () => {
  const script = `$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
${functions}
function Write-AutoCollectorLog { param($Level,$Message) $script:messages += ($Level+':'+$Message) }
function Get-NetTCPConnection {
  if ($script:scenario -eq 'port-restart' -and $script:lists -eq 1 -and -not $script:portLost) { $script:portLost=$true; return }
  [pscustomobject]@{LocalPort=9223;OwningProcess=$(if($script:scenario -eq 'wrong-owner' -or ($script:scenario -eq 'owner-changed' -and $script:puts)) {999} else {123})}
}
function Get-EdgeAutoProfileProcesses { [pscustomobject]@{ProcessId=123} }
function Fail-Connection { param($Status='ConnectFailure') throw [Net.WebException]::new('fixture transport error',[Net.WebExceptionStatus]::$Status) }
function Invoke-RestMethod {
  param($Uri,$Method,$TimeoutSec)
  if ($Uri -like '*/json/version') {
    $script:versions++
    if ($script:scenario -eq 'cold-start' -and $script:versions -lt 3) { Fail-Connection }
    if ($script:scenario -eq 'offline') { Fail-Connection }
    return @{Browser='fixture'}
  }
  if ($Uri -like '*/json/new?*') {
    $script:puts++
    if ($script:scenario -eq 'put-refused' -and $script:puts -eq 1) { Fail-Connection }
    if ($script:scenario -ne 'put-unknown') {
      $script:page=[pscustomobject]@{id='trigger';type='page';url=[Uri]::UnescapeDataString($Uri.Split('?')[1]);title='loading'}
    }
    if ($script:scenario -in @('put-lost','put-unknown','put-lost-then-list-lost')) { Fail-Connection 'Timeout' }
    return $script:page
  }
  if ($Uri -like '*/json/list') {
    $script:lists++
    if ($script:scenario -eq 'list-lost' -and $script:page -and -not $script:listLost) { $script:listLost=$true; Fail-Connection }
    if ($script:scenario -eq 'put-lost-then-list-lost' -and $script:puts -and -not $script:listLost) { $script:listLost=$true; Fail-Connection }
    if ($script:scenario -eq 'invalid-response') { throw 'fixture invalid protocol response' }
    if ($script:page) {
      $state=if($script:scenario -eq 'busy') {'busy'} elseif($script:scenario -eq 'blocked') {'failed'} elseif($script:scenario -eq 'no-ack') {'pending'} else {'active'}
      $script:page.title='JS_AUTO_ACK_V79:1793066400000:1.1.26:'+$state
      return ,@($script:page)
    }
    return ,@()
  }
  throw 'Unexpected endpoint'
}
$rows=@(foreach($scenario in @('cold-start','list-lost','put-refused','put-lost','put-lost-then-list-lost','port-restart','busy','wrong-owner','owner-changed','offline','put-unknown','blocked','no-ack','invalid-response')) {
  $script:scenario=$scenario; $script:messages=@(); $script:versions=0; $script:lists=0; $script:puts=0; $script:page=$null; $script:listLost=$false; $script:portLost=$false
  $result=''; $failure=''
  try { $result=Invoke-EdgeAutoStartup -Token 1793066400000 -ExpectedVersion '1.1.26' -ProfilePath 'fixture' -ForceValue '0' -TimeoutSeconds .2 -PollMilliseconds 1 } catch { $failure=$_.Exception.Message }
  [pscustomobject]@{scenario=$scenario;result=$result;failure=$failure;puts=$script:puts;versions=$script:versions;lists=$script:lists;messages=$script:messages}
})
ConvertTo-Json -InputObject $rows -Depth 4 -Compress`;
  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script,'utf16le').toString('base64')], {encoding:'utf8', windowsHide:true, timeout:20000});
  assert.equal(run.status, 0, run.stderr || run.error?.message || run.stdout);
  const rows = Object.fromEntries(JSON.parse(run.stdout.trim()).map(row => [row.scenario,row]));
  for (const name of ['cold-start','list-lost','put-refused','put-lost','put-lost-then-list-lost','port-restart']) {
    assert.equal(rows[name].result, 'active', JSON.stringify(rows[name]));
    assert.equal(rows[name].failure, '');
    assert.equal(rows[name].puts, name === 'put-refused' ? 2 : 1, name);
    assert.ok(rows[name].messages.some(line => line.includes('재연결 성공')), name);
  }
  assert.equal(rows['cold-start'].versions,3);
  assert.equal(rows.busy.result,'busy');
  assert.equal(rows.busy.puts,1);
  for (const name of ['wrong-owner','owner-changed','offline','put-unknown','blocked','no-ack','invalid-response']) {
    assert.equal(rows[name].result,'',name);
    assert.ok(rows[name].failure,name);
  }
  assert.equal(rows['wrong-owner'].puts,0);
  assert.equal(rows['owner-changed'].puts,1);
  assert.equal(rows.offline.puts,0);
  assert.equal(rows['put-unknown'].puts,1,'uncertain PUT must not be repeated');
  assert.match(rows['put-unknown'].failure,/open-request/);
  assert.match(rows['no-ack'].failure,/acknowledgement/);
  assert.equal(rows['invalid-response'].lists,1,'protocol errors do not become transport retries');
  assert.doesNotMatch(launcher,/Stop-Process|\/json\/close|runtime\.reload/);
});

test('scheduled failures receive bounded OS retries and retain single-instance protection', () => {
  const installer=fs.readFileSync('tools/install-edge-auto-collector.ps1','utf8');
  assert.match(installer,/-MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(launcher,/단계=.*edgeAutoStage.*줄=.*ScriptLineNumber/);
});
