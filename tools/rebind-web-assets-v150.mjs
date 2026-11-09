import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {readFile,readdir,mkdir,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,sep,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyWebReleaseV150} from './verify-web-release.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const ACCOUNT='9304fc3fc06d5491683e5a30fb15e25d',WORKER='js-map';
const DATABASE='e5b41e5f-8929-4c10-948e-178a17ee5f18',BUCKET='js-map-media';

export function rebindMetadataV150(settings,jwt,headers) {
  const bindings=settings.bindings || [],db=bindings.find(b=>b.name==='DB'),media=bindings.find(b=>b.name==='MEDIA');
  if (!jwt || db?.type!=='d1' || (db.id || db.database_id)!==DATABASE ||
      media?.type!=='r2_bucket' || media.bucket_name!==BUCKET ||
      !bindings.some(b=>b.name==='ASSETS' && b.type==='assets')) throw new Error('Unexpected release target or incomplete assets');
  // Inherit every existing binding, including secrets, rather than reading,
  // printing or replacing credentials. Only ASSETS receives the new manifest.
  return {main_module:'worker.js',
    bindings:bindings.map(b=>b.type==='assets'?{name:b.name,type:'assets'}:{name:b.name,type:'inherit'}),
    compatibility_date:settings.compatibility_date,compatibility_flags:settings.compatibility_flags,
    limits:settings.limits,placement:settings.placement,observability:settings.observability,
    logpush:settings.logpush,tail_consumers:settings.tail_consumers,
    assets:{jwt,config:{html_handling:'auto-trailing-slash',not_found_handling:'none',run_worker_first:['/*'],_headers:headers}},
    annotations:{'workers/message':'Verified JS-map static asset rebind v150'}};
}

export async function assetManifestV150(directory,hash) {
  const manifest={};
  for (const file of await readdir(directory,{recursive:true,withFileTypes:true})) {
    if (!file.isFile()) continue;
    const absolute=join(file.parentPath,file.name),name=relative(resolve(directory),absolute).split(sep).join('/');
    if (['_headers','_redirects','.assetsignore'].includes(name) || name.split('/').some(p=>p.startsWith('.'))) continue;
    const bytes=await readFile(absolute);
    if (bytes.length>25*1024*1024) throw new Error('Asset exceeds the Worker limit: '+name);
    manifest['/'+name]={hash:hash(bytes.toString('base64')+extname(name).slice(1)),size:bytes.length};
  }
  return manifest;
}

async function run() {
  const execute=process.argv.includes('--execute'),bundleArg=process.argv.indexOf('--bundle');
  if (execute && (bundleArg<0 || !process.argv[bundleArg+1])) throw new Error('--execute requires the reviewed Wrangler --dry-run --outdir bundle via --bundle');
  let bundle;
  if (bundleArg>=0) {
    const target=await realpath(resolve(ROOT,process.argv[bundleArg+1]));
    if (!relative(ROOT,target).toLowerCase().startsWith('outputs'+sep)) throw new Error('Bundle must be inside this checkout outputs directory');
    bundle=await readFile(target);
  }
  const wrangler=resolve(ROOT,'node_modules/wrangler/bin/wrangler.js');
  const token=spawnSync(process.execPath,[wrangler,'auth','token','--json'],{cwd:ROOT,encoding:'utf8',windowsHide:true});
  if (token.status!==0) throw new Error('Existing Cloudflare authentication is required');
  const authorization='Bearer '+JSON.parse(token.stdout).token;
  const base='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER;
  async function api(suffix,init={}) {
    const response=await fetch(base+suffix,{...init,headers:{authorization,...init.headers},signal:AbortSignal.timeout(90000)});
    const payload=await response.json();
    if (!response.ok || !payload.success) throw new Error('Cloudflare HTTP '+response.status+'; codes '+(payload.errors || []).map(e=>e.code).join(','));
    return payload.result;
  }
  const require=createRequire(resolve(realpathSync(resolve(ROOT,'node_modules/wrangler')),'package.json'));
  const blake=require('blake3-wasm'),directory=resolve(ROOT,'.cloudflare-assets');
  const manifest=await assetManifestV150(directory,value=>blake.hash(value).toString('hex').slice(0,32));
  const settings=await api('/settings');
  rebindMetadataV150(settings,'preflight','');
  // This is a recovery for an already-uploaded release. Missing bytes must be
  // uploaded with Wrangler first; never silently bind a partial manifest.
  const upload=await api('/assets-upload-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({manifest})});
  const missing=(upload.buckets || []).flat().length;
  if (missing || !upload.jwt) throw new Error('Assets are not fully uploaded; refusing rebind ('+missing+' missing)');
  const metadata=rebindMetadataV150(settings,upload.jwt,await readFile(resolve(directory,'_headers'),'utf8'));
  const record={worker:WORKER,execute,assets:Object.keys(manifest).length,
    bundleSha256:bundle?createHash('sha256').update(bundle).digest('hex'):null};
  if (execute) {
    const form=new FormData();form.set('metadata',JSON.stringify(metadata));
    form.set('worker.js',new File([bundle],'worker.js',{type:'application/javascript+module'}));
    const result=await api('?bindings_inherit=strict&excludeScript=true',{method:'PUT',body:form});
    record.deploymentId=result.deployment_id;
    record.verification=await verifyWebReleaseV150();
  }
  await mkdir(resolve(ROOT,'outputs'),{recursive:true});
  await writeFile(resolve(ROOT,'outputs/web-assets-rebind-v150.json'),JSON.stringify(record,null,2));
  console.log(JSON.stringify({worker:WORKER,execute,assets:record.assets,verified:record.verification?.ok || false,deploymentId:record.deploymentId}));
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  run().catch(error=>{console.error('WEB_ASSETS_REBIND_FAILED: '+error.message);process.exitCode=1;});
}
