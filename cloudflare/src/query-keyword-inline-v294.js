// A client's exact navigation digest permits bounded current-original repair
// in the same response as memo masks. Never retain invocation promises or memos.
const memories=new WeakMap();
export async function keywordBasisDigestV294(packet){
  const at=['propertyId','sourceSnapshotKey','queryMatchedOriginalCountV152','querySelectedOriginalIdV152'].map(name=>packet.fields.indexOf(name));
  if(at.some(n=>n<0))throw Error('Missing keyword basis');
  const rows=packet.rows.map(row=>at.map(n=>row[n])).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows)))),b=>b.toString(16).padStart(2,'0')).join('');
}
async function basis(env,revision,mode,digest){
  if(!/^[a-f0-9]{64}$/.test(digest||'')||!env.MEDIA?.head)return null;
  const key=`api-cache/query-view-${mode==='building_sale'?'v184':'v215'}-${mode}.json.navigation-v228.gz`;
  const head=await env.MEDIA.head(key);if(head?.customMetadata?.revision!==revision||!head.etag)return null;
  let cache=memories.get(env.MEDIA);if(!cache){cache=new Map();memories.set(env.MEDIA,cache);}
  let saved=cache.get(mode);
  if(!saved||saved.etag!==head.etag||saved.revision!==revision){
    const object=await env.MEDIA.get(key,{onlyIf:{etagMatches:head.etag}});if(!object?.body)return null;
    const packet=await new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).json();
    if(packet.ok!==true||packet.version!==152||packet.revision!==revision||packet.completeQuery!==true||packet.recentQueryBaseV154||packet.perPropertyOverridesV152||
      !Array.isArray(packet.fields)||new Set(packet.fields).size!==packet.fields.length||!Array.isArray(packet.rows)||packet.total!==packet.rows.length||packet.total>50000)return null;
    const id=packet.fields.indexOf('propertyId'),proof=packet.fields.indexOf('sourceSnapshotKey'),proofs=new Map();let bytes=0;
    if(id<0||proof<0)return null;
    for(const row of packet.rows){
      if(!Array.isArray(row)||row.length!==packet.fields.length||typeof row[id]!=='string'||!row[id]||proofs.has(row[id])||!/^sha256-v1:[a-f0-9]{64}$/.test(row[proof]))return null;
      proofs.set(row[id],row[proof]);bytes+=(row[id].length+row[proof].length)*2+64;
    }
    saved={etag:head.etag,revision,digest:await keywordBasisDigestV294(packet),proofs,bytes};
    if(bytes<=4*1024*1024){cache.clear();cache.set(mode,saved);}
  }
  return saved.digest===digest?saved.proofs:null;
}
export async function inlineKeywordRepairsV294({env,revision,mode,digest,rows,readCurrent}){
  let proofs;try{proofs=await basis(env,revision,mode,digest);}catch{return null;}
  if(!proofs)return null;
  const ids=rows.filter(row=>proofs.has(row[0])&&proofs.get(row[0])!==row[1]).map(row=>row[0]);
  if(ids.length>1024||new Set(ids).size!==ids.length)return null;
  const current=[];
  for(let start=0;start<ids.length;start+=50){const requested=ids.slice(start,start+50),items=await readCurrent(requested),seen=new Set();
    if(!Array.isArray(items)||items.some(row=>!requested.includes(row.propertyId)||seen.has(row.propertyId)||!seen.add(row.propertyId)||!/^sha256-v1:[a-f0-9]{64}$/.test(row.sourceSnapshotKey)))throw Object.assign(Error('검색 보완 원장 범위가 다릅니다.'),{statusCode:409});
    current.push(...items);
  }
  return {digest,ids,rows:current};
}
