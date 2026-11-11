import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const RELEASE_ASSETS_V150 = Object.freeze([
  'js/building-registry-core-v164.js','js/building-registry-v164.js','js/auth-gate-v1.js','js/property-edit-v648.js','css/style.css',
  'js/mobile-app-v1.js','css/mobile-app-v1.css','js/script.js',
  'js/data-access-v6.js','js/initial-listings-cache-v1.js','js/map.js','js/unified-listings-v8.js','css/unified-listings-v8.css',
  'js/query-collection-v152.js','js/query-numeric-v177.js','js/query-preview-v154.js','js/query-startup-v152.js','css/auth-gate-v1.css','js/query-thumbnails-v159.js',
  'css/map-professional-v1.css','css/selected-listing-merge-v99.css','js/sale-property-workspace-v3.js','js/wide-detail-v26.js','css/wide-detail-v26.css',
  'js/selected-listing-merge-v99.js','js/unified-favorites-v7.js','js/print-v2.js','css/print-v2.css','js/sale-public-review-v6.js','js/sale-workbench-v1.js','js/sale-property-edit-v1.js','css/sale-design-v24.css','css/sale-professional-v2.css','css/listing-trade-v1.css','js/listing-attachments-v181.js'
]);
const ROOT = fileURLToPath(new URL('../',import.meta.url));
const ORIGINS = ['https://js-map.com','https://www.js-map.com'];
const digest = body => createHash('sha256').update(body).digest('hex');

export function releaseUrlsV150(html) {
  const urls = new Map();
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const value=match[1].replaceAll('&amp;','&');
    if (/^(?:[a-z]+:|\/\/|#)/i.test(value)) continue;
    const url=new URL(value,'https://js-map.invalid/'),path=url.pathname.slice(1);
    if (!/^(?:js\/.*\.js|css\/.*\.css)$/.test(path)) continue;
    if (!/^[a-f0-9]{16}$/.test(url.searchParams.get('build') || '')) throw new Error('Fingerprint missing: '+path);
    if (urls.has(path) && urls.get(path)!==url.pathname+url.search) throw new Error('Conflicting asset URLs: '+path);
    urls.set(path,url.pathname+url.search);
  }
  return urls;
}

// A successful control-plane deployment is not proof that its assets reached
// the public domain. Check the actual HTML references and delivered bytes.
export async function verifyWebReleaseV150({directory=resolve(ROOT,'.cloudflare-assets'), origins=ORIGINS, fetchImpl=fetch}={}) {
  const expected=releaseUrlsV150(await readFile(resolve(directory,'index.html'),'utf8'));
  for (const path of RELEASE_ASSETS_V150) if (!expected.has(path)) throw new Error('Build asset missing: '+path);
  const hashes=new Map(await Promise.all(RELEASE_ASSETS_V150.map(async path=>[path,digest(await readFile(resolve(directory,path)))])));
  const rows=[];
  for (const origin of origins) {
    const html=await fetchImpl(origin+'/',{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(20000)});
    if (!html.ok) throw new Error('Release HTML HTTP '+html.status+': '+origin);
    const actual=releaseUrlsV150(await html.text());
    for (const [path,url] of expected) if (actual.get(path)!==url) throw new Error('Release HTML still references different assets: '+path+' at '+origin);
    rows.push({origin,path:'/',status:html.status,match:true});
    for (const path of RELEASE_ASSETS_V150) {
      const response=await fetchImpl(origin+expected.get(path),{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error('Release asset HTTP '+response.status+': '+path);
      const match=digest(new Uint8Array(await response.arrayBuffer()))===hashes.get(path);
      if (!match) throw new Error('Release asset bytes differ: '+path+' at '+origin);
      rows.push({origin,path,status:response.status,match});
    }
  }
  return {ok:true,checkedAt:new Date().toISOString(),responses:rows.length,rows};
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const result=await verifyWebReleaseV150();
    await mkdir(resolve(ROOT,'outputs'),{recursive:true});
    await writeFile(resolve(ROOT,'outputs/web-release-verification-v150.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({ok:true,responses:result.responses,checkedAt:result.checkedAt}));
  } catch(error) {
    console.error('WEB_RELEASE_NOT_VERIFIED: '+error.message);process.exitCode=1;
  }
}
