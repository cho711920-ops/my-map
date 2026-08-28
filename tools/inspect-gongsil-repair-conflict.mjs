// Read-only conflict diagnostics; raw/contact/memo values never printed.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const file = process.argv[2];
const before = JSON.parse(fs.readFileSync(file,'utf8'));
for (const table of ['listings','listing_sources','listing_contacts','listing_media','collector_raw']) {
 const rows = before[table]; if(!rows.length) continue;
 const sql = `SELECT * FROM ${table} WHERE id IN (${rows.map(r=>"'"+r.id.replaceAll("'","''")+"'").join(',')})`;
 const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','js-map-primary','--remote','--json','--command',sql],{encoding:'utf8',maxBuffer:128*1024*1024,windowsHide:true});
 if(r.status)throw Error(r.stderr||r.stdout);
 const after=JSON.parse(r.stdout)[0].results;
 const changed=rows.flatMap(old=>{const current=after.find(r=>r.id===old.id); const keys=Object.keys(old).filter(k=>old[k]!==current?.[k]); return keys.length?[{id:old.id,keys}]:[];});
 console.log(JSON.stringify({table,changed}));
}
