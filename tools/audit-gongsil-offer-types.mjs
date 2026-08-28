// Read-only production audit. Writes evidence privately outside the repository.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { gongsilAdvertisedOffers, hasGongsilOfferEvidence } from '../cloudflare/src/gongsil-offers.js';
const root = resolve(import.meta.dirname, '..');
const dest = process.argv.find(a => a.startsWith('--backup='))?.slice(9);
if (!dest || !isAbsolute(dest) || !relative(root, resolve(dest)).startsWith('..')) throw Error('Private backup outside repo required');
const dir = resolve(dest, 'gongsil-offer-audit');
mkdirSync(dir, { recursive: true });
const sql = `SELECT id,listing_id,source_listing_id,trade_type,created_at,updated_at,
 json_object('list',json_object('Subtype',json_extract(raw_json,'$.list.Subtype'),
 'TypeView',json_extract(raw_json,'$.list.TypeView'),'Me',json_extract(raw_json,'$.list.Me'),
 'Bo',json_extract(raw_json,'$.list.Bo'),'Mm',json_extract(raw_json,'$.list.Mm'),
 'Jun',json_extract(raw_json,'$.list.Jun'),'Jmm',json_extract(raw_json,'$.list.Jmm'),
 'Bjbo',json_extract(raw_json,'$.list.Bjbo'),'Bjmm',json_extract(raw_json,'$.list.Bjmm')),
 'detail',json_object('floorinfo',json_object('LndSubtype',json_extract(raw_json,'$.detail.floorinfo.LndSubtype'),
 'Moneys',json(json_extract(raw_json,'$.detail.floorinfo.Moneys'))))) AS evidence
 FROM listing_sources WHERE source='공실박스'`;
const result = spawnSync(process.execPath, [resolve(root,'node_modules/wrangler/bin/wrangler.js'),
 'd1','execute','js-map-primary','--remote','--json','--command',sql], {cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});
if(result.status) throw Error(result.stderr || result.stdout);
const rows = JSON.parse(result.stdout)[0].results;
const bad = rows.filter(row => {
 const raw=JSON.parse(row.evidence);
 return hasGongsilOfferEvidence(raw.list,raw.detail)
   && !gongsilAdvertisedOffers(raw.list,raw.detail).some(o=>o.tradeType===row.trade_type);
});
writeFileSync(resolve(dir,'audit.json'),JSON.stringify({rows,bad}));
const groups={};
for(const r of bad){const raw=JSON.parse(r.evidence); const key=[r.trade_type,raw.list.TypeView,raw.list.Subtype,r.source_listing_id.includes('::')?'qualified':'legacy'].join('/');groups[key]=(groups[key]||0)+1;}
console.log(JSON.stringify({audited:rows.length,bad:bad.length,groups,backup:dir}));
