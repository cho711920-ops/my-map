import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {snapshotTransfer} from '../cloudflare/src/snapshot-transfer.js';
const source=fs.readFileSync('cloudflare/src/worker.js','utf8');
function fn(name,async=true){const start=source.indexOf((async?'async ':'')+'function '+name+'(');assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2);}
for(const action of ['sheet','unifiedListings'])for(const scope of ['lease','all'])test('authenticated pinned ranges skip live revision work: '+action+'/'+scope,async()=>{
  let authenticated=false,reads=0,revisionReads=0,denied=false;
  const context=vm.createContext({Response,URL,Date,Promise,console,Number,Set,
    LEASE_SHEET_CACHE_KEY:'lease-csv',D1_SHEET_CACHE_KEY:'csv',LEASE_UNIFIED_CACHE_KEY:'lease-originals',UNIFIED_LISTINGS_CACHE_KEY:'originals',
    GEOCODE_CACHE_KEY:'geo',OPERATIONS_DASHBOARD_CACHE_KEY:'ops',QUEUE_CLIENT_VERSION:'fixture',
    requireSession:async()=>{if(denied)throw Error('auth denied');authenticated=true;return {};},
    requireExpectedAccount(){},handleOperationsQualityGet:async()=>null,handleCollectorAdminGet:async()=>null,
    readDataRevision:async()=>{revisionReads++;throw Error('manifest must check current revision');},snapshotTransfer});
  vm.runInContext(fn('handleSheet')+'\n'+fn('handleDataApi'),context);
  const bytes=new Uint8Array([1,2,3]),key=scope==='lease'?'lease-':'';
  const env={DB:{},MEDIA:{async head(){throw Error('range must not need a head');},async get(actual,options){
    assert.ok(authenticated);assert.equal(actual,key+(action==='sheet'?'csv':'originals'));reads++;
    if(options.onlyIf.etagMatches!=='pinned')return {body:null,httpEtag:'"other"'};
    return {httpEtag:'"pinned"',range:options.range,body:new Response(bytes).body};
  }}};
  const headers={'x-js-listings-scope':scope,'x-js-snapshot-mode':'chunk-v128','x-js-snapshot-etag':'"pinned"',
    'x-js-snapshot-offset':'0','x-js-snapshot-length':'3'};
  const request=()=>new Request('https://fixture.invalid/api/'+(action==='sheet'?'sheet':'data?action=unifiedListings'),{headers});
  const run=()=>context[action==='sheet'?'handleSheet':'handleDataApi'](request(),env);
  assert.deepEqual(new Uint8Array(await (await run()).arrayBuffer()),bytes);assert.equal(revisionReads,0);
  headers['x-js-snapshot-etag']='"changed"';assert.equal((await run()).status,409);assert.equal(revisionReads,0);
  headers['x-js-snapshot-length']='1048577';assert.equal((await run()).status,400);assert.equal(reads,2);
  headers['x-js-snapshot-mode']='manifest-v128';await assert.rejects(run,/manifest must check current revision/);assert.equal(revisionReads,1);
  denied=true;headers['x-js-snapshot-mode']='chunk-v128';await assert.rejects(run,/auth denied/);assert.equal(reads,2);
});
