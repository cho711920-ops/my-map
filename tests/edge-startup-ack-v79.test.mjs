import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';

const content=fs.readFileSync('edge-automation/extension/content.js','utf8');
const bridge=content.slice(content.indexOf('async function acknowledgeWindowsStartup('),content.indexOf('\nif (/^https:',content.indexOf('async function acknowledgeWindowsStartup(')));
const launcher=fs.readFileSync('tools/run-edge-auto-collector.ps1','utf8');
const token='1792710000000';
const webCode=fs.readFileSync('js/collector-startup-status.js','utf8');
function webStatus(query,reply,override={},beforeReply=0) {
  const events={},messages=[],timers=[],status={setAttribute(){}};
  const ctx=vm.createContext({URLSearchParams,location:{search:query,origin:'https://js-map.com'},
    document:{title:'install',createElement:()=>status,querySelector:()=>({prepend(){}})},
    window:{addEventListener:(name,fn)=>{events[name]=fn;},postMessage:(data)=>messages.push(data)},
    setTimeout:fn=>timers.push(fn),...override});
  vm.runInContext(webCode,ctx);
  for(let i=0;i<beforeReply;i++)timers.shift()?.();
  if(reply && events.message) events.message({source:ctx.window,data:{type:'JS_AUTO_COLLECTOR_STATE_RESULT',requestId:messages[0].requestId,ok:true,state:reply}});
  return {title:ctx.document.title,status,messages,timers};
}
test('a deployed page can acknowledge the legacy installed extension using only its existing read-only state bridge',()=>{
  const q='?js_auto_token='+token+'&js_auto_expected=1.1.26';
  const r=webStatus(q,{version:'1.1.26',runState:{active:true,market:'lease'}});
  assert.equal(r.title,'JS_AUTO_ACK_V79:'+token+':1.1.26:active');
  assert.ok(r.messages.every(m=>m.type==='JS_AUTO_COLLECTOR_STATE_REQUEST'));
  assert.equal(webStatus(q,{version:'1.1.26',runState:{active:true,market:'sale'}}).title,'JS_AUTO_ACK_V79:'+token+':1.1.26:busy');
  for(const reply of [{version:'1.1.25',runState:{active:true}},{version:'1.1.26',runState:{active:false}}])assert.equal(webStatus(q,reply).title,'install');
  assert.equal(webStatus('',null).messages.length,0);
  assert.equal(webStatus(q,{version:'1.1.26',runState:{active:true,market:'lease'}},{},2).title,'JS_AUTO_ACK_V79:'+token+':1.1.26:active','a late valid response survives subsequent polling requests');
});
async function acknowledge(responses,query='js_auto_run=1&js_auto_token='+token,version='1.1.26'){
  const messages=[],status={};
  const ctx=vm.createContext({URLSearchParams,document:{title:'installer',createElement:()=>status,querySelector:()=>({prepend(){}})},
    chrome:{runtime:{getManifest:()=>({version})}},delay:async()=>{},
    sendRuntimeMessage:async message=>{messages.push(message);return responses.length>1?responses.shift():responses[0];}});
  const result=await vm.runInContext(bridge+'\nacknowledgeWindowsStartup(new URLSearchParams('+JSON.stringify(query)+'))',ctx);
  return {result,title:ctx.document.title,message:status.textContent,messages};
}
const state=active=>({ok:true,backgroundBuild:'1.1.26',runState:{active}});

test('HTTPS startup acknowledges the current token/build only after the real worker reports active',async()=>{
  const r=await acknowledge([state(false),{ok:true,started:true},state(true)]);
  assert.equal(r.title,'JS_AUTO_ACK_V79:'+token+':1.1.26:active');
  assert.deepEqual(r.messages.map(m=>m.type),['JS_AUTO_GET_STATE','JS_AUTO_RUN_REQUEST','JS_AUTO_GET_STATE']);
  assert.equal(r.messages[1].forceRun,false);assert.match(r.message,/실제 실행/);
});
test('already-run and queued requests are distinguished from an actual start without forcing a second run',async()=>{
  for(const kind of ['skipped','queued']){
    const r=await acknowledge([state(false),{ok:true,[kind]:true},state(false)]);
    assert.equal(r.title,'JS_AUTO_ACK_V79:'+token+':1.1.26:'+kind);
    assert.equal(r.messages.filter(m=>m.type==='JS_AUTO_RUN_REQUEST').length,1);
  }
});
test('no worker, failed request, stale build and unconfirmed state never become a successful start',async()=>{
  const cases=[[[{ok:false}],'unavailable'],[[state(false),{ok:false}],'failed'],
    [[{ok:true,backgroundBuild:'1.1.25'}],'update-required'],[[state(false),{ok:true},state(false)],'unconfirmed']];
  for(const [responses,expected] of cases){
    const r=await acknowledge(responses);assert.equal(r.title,'JS_AUTO_ACK_V79:'+token+':1.1.26:'+expected);
    if(['unavailable','update-required'].includes(expected))assert.ok(r.messages.every(m=>m.type==='JS_AUTO_GET_STATE'));
  }
});
test('read-only status and malformed startup tokens cannot trigger collection',async()=>{
  const r=await acknowledge([state(false)],'js_auto_token='+token);
  assert.ok(r.title.endsWith(':idle'));assert.ok(r.messages.every(m=>m.type==='JS_AUTO_GET_STATE'));
  for(const value of ['', 'invalid', '1'.repeat(50)]){
    const bad=await acknowledge([state(false)],'js_auto_run=1&js_auto_token='+value);
    assert.equal(bad.result,false);assert.equal(bad.messages.length,0);
  }
});

test('Windows acknowledgement rejects blocked, closed, stale-token, stale-version and unknown-title pages',{skip:process.platform!=='win32'},()=>{
  const helper=launcher.match(/function Get-EdgeAutoStartupAcknowledgement \{[\s\S]*?\r?\n\}/)?.[0];assert.ok(helper);
  const script=helper+`\n$rows=@(
    @{url='chrome-error://chromewebdata/';title='blocked'},
    @{url='https://js-map.com/collector-install';title='JS_AUTO_ACK_V79:${token}:1.1.26:active'},
    @{url='https://js-map.com/collector-install';title='JS_AUTO_ACK_V79:0000000000000:1.1.26:active'},
    @{url='https://js-map.com/collector-install';title='JS_AUTO_ACK_V79:${token}:1.1.25:active'},
    @{url='https://js-map.com/collector-install';title='JS_AUTO_ACK_V79:${token}:1.1.26:unexpected'},
    @{url='https://other.example/collector-install';title='JS_AUTO_ACK_V79:${token}:1.1.26:active'},
    $null
  )
  @($rows|ForEach-Object {Get-EdgeAutoStartupAcknowledgement -Page $_ -Token '${token}' -ExpectedVersion '1.1.26'})|ConvertTo-Json -Compress`;
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout.trim()),['blocked','active','pending','pending','pending','blocked','pending']);
});
