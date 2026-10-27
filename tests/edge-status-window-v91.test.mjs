import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const helper=fs.readFileSync('tools/open-edge-auto-status.ps1','utf8');
test('status opener rejects wrong extension contexts, owners and remote websocket addresses before connecting',{skip:process.platform!=='win32'},()=>{
  const script=`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
${helper}
function Assert-EdgeAutoDebugOwner { if ($script:scenario -eq 'wrong-owner') { throw 'wrong owner' } }
function Invoke-RestMethod {
  $script:reads++
  $id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  $url='chrome-extension://'+$id+'/background.js'
  $socket='ws://127.0.0.1:9223/devtools/page/fixture'
  $type='service_worker'
  switch($script:scenario) {
    'wrong-extension' {$url='chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/background.js'}
    'wrong-type' {$type='page'}
    'remote-socket' {$socket='ws://example.com:9223/devtools/page/fixture'}
    'wrong-port' {$socket='ws://127.0.0.1:9224/devtools/page/fixture'}
    'wrong-scheme' {$socket='wss://127.0.0.1:9223/devtools/page/fixture'}
    'wrong-path' {$socket='ws://127.0.0.1:9223/other/fixture'}
    'userinfo' {$socket='ws://user@127.0.0.1:9223/devtools/page/fixture'}
  }
  return ,@([pscustomobject]@{type=$type;url=$url;webSocketDebuggerUrl=$socket})
}
$rows=@(foreach($scenario in @('invalid-id','wrong-owner','wrong-extension','wrong-type','remote-socket','wrong-port','wrong-scheme','wrong-path','userinfo')) {
  $script:scenario=$scenario; $script:reads=0
  $id=if($scenario -eq 'invalid-id') {'bad-id'} else {'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}
  $errorMessage=''
  try { Open-EdgeAutoStatusPage -ProfilePath 'fixture' -ExtensionId $id } catch { $errorMessage=$_.Exception.Message }
  [pscustomobject]@{scenario=$scenario;error=$errorMessage;reads=$script:reads}
})
ConvertTo-Json -InputObject $rows -Compress`;
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(r.status,0,r.stderr||r.error?.message||r.stdout);
  const rows=JSON.parse(r.stdout.trim());
  assert.equal(rows.length,9);
  for(const row of rows) {
    assert.ok(row.error,row.scenario);
    assert.equal(row.reads,['invalid-id','wrong-owner'].includes(row.scenario)?0:1,row.scenario);
  }
});

test('status display follows real startup acknowledgement and cannot restart collection on a display failure',()=>{
  const launcher=fs.readFileSync('tools/run-edge-auto-collector.ps1','utf8');
  assert.ok(launcher.indexOf('$acknowledgement = Invoke-EdgeAutoStartup')<launcher.indexOf('Open-EdgeAutoStatusPage -ProfilePath'));
  assert.match(launcher,/Write-AutoCollectorLog 'WARN' \('수집은 유지합니다/);
  assert.match(helper,/await chrome\.runtime\.openOptionsPage\(\)/);
  assert.doesNotMatch(helper,/chrome\.storage|JS_AUTO_RUN_REQUEST|runtime\.reload|Stop-Process|\/json\/new/);
  assert.match(fs.readFileSync('tools/install-edge-auto-collector.ps1','utf8'),/Copy-Item[^\r\n]*open-edge-auto-status\.ps1/);
});
