import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const source=fs.readFileSync('tools/run-edge-auto-collector.ps1','utf8');
// Execute only the real read-only selection expression, never the launcher.
const selection=source.match(/[ ]{2}\$extensionId = Get-ChildItem -LiteralPath \$extensionStorageRoot -Directory[^]*?Select-Object -First 1 -ExpandProperty Name/);
assert.ok(selection,'the launcher extension-ID selection must remain independently testable');

test('extension-ID candidates require at least one true content match, not a truthy array of false results',()=>{
  assert.match(selection[0],/\$configMatches = @\(/);
  assert.match(selection[0],/\$configMatches -contains \$true/);
  assert.match(selection[0],/Sort-Object LastWriteTime -Descending/);
});

test('Windows PowerShell 5.1 selects real mixed matches and rejects newer all-false, empty and absent directories',{
  skip:process.platform!=='win32'
},t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jsmap-extension-id-test-'));
  t.after(()=>{
    const resolved=path.resolve(directory),parent=path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved),parent);
    assert.ok(path.basename(resolved).startsWith('jsmap-extension-id-test-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  const create=(scenario,id,contents,time)=>{
    const location=path.join(directory,scenario,id);fs.mkdirSync(location,{recursive:true});
    contents.forEach((value,index)=>fs.writeFileSync(path.join(location,index+'.fixture'),value));
    fs.utimesSync(location,new Date(time),new Date(time));return id;
  };
  const expected=create('mixed','a'.repeat(32),['unrelated','jsAutoCollectorConfigV1','other'],'2026-01-01T00:00:00Z');
  create('mixed','b'.repeat(32),['false-one','false-two','false-three'],'2026-02-01T00:00:00Z');
  create('no-match','c'.repeat(32),['unrelated','still unrelated'],'2026-02-01T00:00:00Z');
  create('empty','d'.repeat(32),[],'2026-02-01T00:00:00Z');
  create('latest-match','e'.repeat(32),['jsAutoCollectorConfigV1'],'2026-01-01T00:00:00Z');
  const latest=create('latest-match','f'.repeat(32),['other','jsAutoCollectorConfigV1'],'2026-02-01T00:00:00Z');
  const rootLiteral=directory.replaceAll("'","''");
  const script=`$ErrorActionPreference='Stop'
function Get-TestSelectedExtensionId {
  param([string]$extensionStorageRoot)
${selection[0]}
  return $extensionId
}
$testRoot='${rootLiteral}'
$result=[ordered]@{
  Major=$PSVersionTable.PSVersion.Major
  Minor=$PSVersionTable.PSVersion.Minor
  Mixed=(Get-TestSelectedExtensionId (Join-Path $testRoot 'mixed'))
  NoMatchSelected=[bool](Get-TestSelectedExtensionId (Join-Path $testRoot 'no-match'))
  EmptySelected=[bool](Get-TestSelectedExtensionId (Join-Path $testRoot 'empty'))
  MissingSelected=[bool](Get-TestSelectedExtensionId (Join-Path $testRoot 'missing'))
  Latest=(Get-TestSelectedExtensionId (Join-Path $testRoot 'latest-match'))
}
$result | ConvertTo-Json -Compress`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden',
    '-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
    encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024*1024
  });
  assert.equal(result.error,undefined,String(result.error));
  assert.equal(result.status,0,result.stderr);
  const actual=JSON.parse(result.stdout.trim());
  assert.equal(actual.Major,5);assert.equal(actual.Minor,1);
  assert.equal(actual.Mixed,expected,'a newer all-false folder must not replace a genuine match');
  assert.equal(actual.NoMatchSelected,false);assert.equal(actual.EmptySelected,false);assert.equal(actual.MissingSelected,false);
  assert.equal(actual.Latest,latest,'latest genuine config match retains existing selection policy');
});
