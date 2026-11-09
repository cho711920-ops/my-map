import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, cp, readdir, stat} from 'node:fs/promises';
import {resolve, join, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const WORKER = 'js-map';
const DATABASE = 'e5b41e5f-8929-4c10-948e-178a17ee5f18';
const ACCOUNT = '9304fc3fc06d5491683e5a30fb15e25d';
const sha = value => createHash('sha256').update(value).digest('hex');
function command(binary, args, cwd) {
  const r = spawnSync(binary, args, {cwd, encoding:'utf8', windowsHide:true});
  if (r.status !== 0) throw new Error('명령 실패: ' + binary + ' ' + args[0] + '\n' + (r.stderr || r.stdout));
  return r.stdout;
}
async function client(checkout) {
  const wrangler = join(checkout,'node_modules/wrangler/bin/wrangler.js');
  const auth = JSON.parse(command(process.execPath,[wrangler,'auth','token','--json'],checkout));
  const headers = {authorization:'Bearer '+auth.token,'content-type':'application/json'};
  const api = async path => {
    const response = await fetch('https://api.cloudflare.com/client/v4'+path,{headers,signal:AbortSignal.timeout(30000)});
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error('Cloudflare 읽기 검증 실패: '+path+' '+JSON.stringify(payload.errors));
    return payload.result;
  };
  const accounts = await api('/accounts');
  if (!accounts.some(a=>a.id===ACCOUNT)) throw new Error('복구 대상 계정을 확인하지 못했습니다.');
  const base = '/accounts/'+ACCOUNT;
  return {api,base,wrangler,deployments:async()=> {
    const d = await api(base+'/workers/scripts/'+WORKER+'/deployments');
    return d.deployments || d;
  }};
}
async function files(directory) {
  const result=[];
  for (const name of await readdir(directory)) {
    const path=join(directory,name);
    if ((await stat(path)).isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result;
}
export function recoveryPlan(manifest, deployment) {
  if (manifest.schema!==1 || manifest.worker!==WORKER || manifest.account!==ACCOUNT ||
      !/^[a-f0-9-]{36}$/.test(manifest.workerVersion || '') || !manifest.databaseBookmark) {
    throw new Error('복구 지점의 식별 정보가 올바르지 않습니다.');
  }
  const versions=deployment?.versions || [];
  return {worker:WORKER, version:manifest.workerVersion,
    alreadyRestored:versions.length===1 && versions[0].version_id===manifest.workerVersion && versions[0].percentage===100,
    preservesData:true, databaseRestore:false};
}
export async function verifyBackup(directory) {
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  for(const [name,digest] of Object.entries(manifest.sha256 || {})) {
    const path=resolve(directory,name);
    const rel=relative(resolve(directory),path);
    if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||resolve(directory)===path) throw new Error('잘못된 백업 경로');
    if(sha(await readFile(path))!==digest) throw new Error('백업 파일 검증 실패: '+name);
  }
  if (!manifest.sha256?.['source.zip'] || !manifest.sha256?.['web-recovery.mjs']) throw new Error('필수 복구 파일 누락');
  recoveryPlan(manifest,null);
  return manifest;
}
export async function backup(checkout,directory) {
  await mkdir(directory,{recursive:false});
  const head=command('git',['rev-parse','HEAD'],checkout).trim();
  const status=command('git',['status','--porcelain'],checkout);
  if (status.split(/\r?\n/).some(line=>line && !line.startsWith('?? '))) throw new Error('미커밋 수정이 있어 HEAD만 백업할 수 없습니다.');
  const c=await client(checkout);
  const deployment=(await c.deployments())[0];
  const version=deployment?.versions?.length===1 && deployment.versions[0].percentage===100 && deployment.versions[0].version_id;
  if(!version) throw new Error('단일 100% 운영 버전이 아닙니다.');
  await c.api(c.base+'/workers/scripts/'+WORKER+'/versions/'+version);
  const bookmark=await c.api(c.base+'/d1/database/'+DATABASE+'/time_travel/bookmark');
  if(!bookmark.bookmark) throw new Error('D1 복구 시점 조회 실패');
  command('git',['archive','--format=zip','--output='+join(directory,'source.zip'),head],checkout);
  await cp(join(checkout,'.cloudflare-assets'),join(directory,'assets'),{recursive:true});
  await cp(join(checkout,'wrangler.toml'),join(directory,'wrangler.toml'));
  await cp(fileURLToPath(import.meta.url),join(directory,'web-recovery.mjs'));
  await writeFile(join(directory,'deployment.json'),JSON.stringify(deployment,null,2));
  await writeFile(join(directory,'database-bookmark.json'),JSON.stringify({checkedAt:new Date().toISOString(),database:DATABASE,...bookmark},null,2));
  await writeFile(join(directory,'git-status.txt'),status);
  const manifest={schema:1,createdAt:new Date().toISOString(),checkout,head,worker:WORKER,account:ACCOUNT,
    workerVersion:version,database:DATABASE,databaseBookmark:bookmark.bookmark,
    dataRecovery:'D1 Time Travel bookmark; NOT an independent SQL export. Default rollback never restores data.',sha256:{}};
  for(const path of await files(directory)) manifest.sha256[relative(directory,path).replaceAll('\\','/')]=sha(await readFile(path));
  await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
  await verifyBackup(directory);
  return {directory,head,workerVersion:version,fileCount:Object.keys(manifest.sha256).length,databaseBookmarkVerified:true};
}
export async function restore(directory,execute=false) {
  const manifest=await verifyBackup(directory);
  const c=await client(manifest.checkout);
  // Verify the pinned immutable version still exists before changing traffic.
  await c.api(c.base+'/workers/scripts/'+WORKER+'/versions/'+manifest.workerVersion);
  const plan=recoveryPlan(manifest,(await c.deployments())[0]);
  if (!execute || plan.alreadyRestored) return {...plan,executed:false,verified:true};
  command(process.execPath,[c.wrangler,'rollback',plan.version,'--name',WORKER,'--config',join(directory,'wrangler.toml'),
    '--message','User requested one-click recovery '+manifest.createdAt,'--yes'],manifest.checkout);
  for(let attempt=0;attempt<12;attempt++) {
    if(recoveryPlan(manifest,(await c.deployments())[0]).alreadyRestored) return {...plan,executed:true,verified:true};
    await new Promise(r=>setTimeout(r,2000));
  }
  throw new Error('복구 명령 후 운영 100% 적용 확인 실패. 성공으로 처리하지 않았습니다.');
}
async function main() {
  const [mode,directory,flag]=process.argv.slice(2);
  if(!directory || !['backup','inspect','restore'].includes(mode)) throw new Error('사용법: web-recovery.mjs backup|inspect|restore 절대경로 [--execute]');
  const result=mode==='backup'?await backup(process.cwd(),resolve(directory)):await restore(resolve(directory),mode==='restore'&&flag==='--execute');
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.message);process.exitCode=1;});
