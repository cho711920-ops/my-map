// Current memo hits are reevaluated from their own originals in the first
// response. The echoed client digest binds the request, not server freshness.
export async function keywordBasisDigestV294(packet){
  const at=['propertyId','sourceSnapshotKey','queryMatchedOriginalCountV152','querySelectedOriginalIdV152'].map(name=>packet.fields.indexOf(name));
  if(at.some(n=>n<0))throw Error('Missing keyword basis');
  const rows=packet.rows.map(row=>at.map(n=>row[n])).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows)))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function inlineKeywordRepairsV294({digest,rows,readCurrent}){
  if(!/^[a-f0-9]{64}$/.test(digest||'')||!Array.isArray(rows)||rows.length>1024)return null;
  const proofs=new Map();
  for(const row of rows){if(!Array.isArray(row)||row.length!==3||typeof row[0]!=='string'||!row[0]||row[0].length>100||proofs.has(row[0])||!/^sha256-v1:[a-f0-9]{64}$/.test(row[1]))return null;proofs.set(row[0],row[1]);}
  const ids=[...proofs.keys()];
  const current=[];
  for(let start=0;start<ids.length;start+=50){const requested=ids.slice(start,start+50),items=await readCurrent(requested),seen=new Set();
    if(!Array.isArray(items)||items.some(row=>!requested.includes(row.propertyId)||seen.has(row.propertyId)||!seen.add(row.propertyId)||row.sourceSnapshotKey!==proofs.get(row.propertyId)))throw Object.assign(Error('검색 보완 원장 범위나 최신 기준이 다릅니다.'),{statusCode:409});
    current.push(...items);
  }
  return {digest,ids,rows:current};
}
