import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recoveryPlan,verifyBackup} from '../tools/web-recovery.mjs';
const manifest={schema:1,worker:'js-map',account:'9304fc3fc06d5491683e5a30fb15e25d',
  workerVersion:'a81ba6ad-2480-43b9-aad6-580129597df9',databaseBookmark:'fixture-bookmark'};
test('one-click rollback pins the immutable web version and never rewinds new user data',()=>{
  const plan=recoveryPlan(manifest,{versions:[{version_id:'new-version',percentage:100}]});
  assert.equal(plan.version,manifest.workerVersion);assert.equal(plan.databaseRestore,false);assert.equal(plan.preservesData,true);
  assert.equal(plan.alreadyRestored,false);
  assert.equal(recoveryPlan(manifest,{versions:[{version_id:manifest.workerVersion,percentage:100}]}).alreadyRestored,true);
  assert.equal(recoveryPlan(manifest,{versions:[{version_id:manifest.workerVersion,percentage:50},{version_id:'new',percentage:50}]}).alreadyRestored,false);
  assert.throws(()=>recoveryPlan({...manifest,worker:'another-site'},null));
});
test('damaged or escaping backup files stop recovery before any deployment command',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'js-web-recovery-'));
  try {
    const hash=createHash('sha256').update('fixture').digest('hex');
    const valid={...manifest,sha256:{'source.zip':hash,'web-recovery.mjs':hash}};
    for(const file of Object.keys(valid.sha256))await writeFile(join(dir,file),'fixture');
    await writeFile(join(dir,'manifest.json'),JSON.stringify(valid));
    assert.equal((await verifyBackup(dir)).workerVersion,manifest.workerVersion);
    await writeFile(join(dir,'source.zip'),'damaged');
    await assert.rejects(verifyBackup(dir),/검증 실패/);
    await writeFile(join(dir,'manifest.json'),JSON.stringify({...valid,sha256:{'../escape':hash}}));
    await assert.rejects(verifyBackup(dir),/경로/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
