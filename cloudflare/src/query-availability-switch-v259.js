// Prepare exact alternate availability views, never synthesize completion from
// an active-only row. Only already prepared, same-revision private results are
// read here: this optional read cannot trigger a source scan or write any master.
import {availabilityKeyV253} from './query-availability-v253.js';
export const availabilityDigestV259=async packet=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(JSON.stringify([packet.fields,packet.rows])))),b=>b.toString(16).padStart(2,'0')).join('');
export async function availabilitySwitchV259({env,state,spec,basis,digest,fields,revision}){
  const result={ok:true,version:259,revision:state.revision,baseDigest:digest,variants:[]};
  if(basis!==state.revision||!/^[a-f0-9]{64}$/.test(digest||'')||spec.favoriteOnly||spec.gongsilOnly||spec.newListingDays||
    Object.entries(spec.filters||{}).some(([k,v])=>v&&!(k==='sortFilter'&&v==='latest')))return result;
  const current=spec.doneOnly?'completed':spec.hideDone===false?'all':'active';
  async function read(view){
    const key=view==='active'?`api-cache/query-view-${spec.mode==='building_sale'?'v184':'v215'}-${spec.mode}.json.navigation-v228.gz`:
      availabilityKeyV253(spec.mode,view)+'.result-latest.gz';
    const object=await env.MEDIA.get(key);
    if(object?.customMetadata?.revision!==state.revision){await object?.body?.cancel();return null;}
    const packet=await new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).json();
    if(packet?.ok!==true||packet.version!==152||packet.completeQuery!==true||packet.revision!==state.revision||
      JSON.stringify(packet.fields)!==JSON.stringify(fields)||packet.total!==packet.rows?.length)return null;
    const id=fields.indexOf('propertyId'),proof=fields.indexOf('sourceSnapshotKey'),seen=new Set();
    if(id<0||proof<0||packet.rows.some(row=>!Array.isArray(row)||row.length!==fields.length||typeof row[id]!=='string'||seen.has(row[id])||
      !/^sha256-v1:[a-f0-9]{64}$/.test(row[proof])||!seen.add(row[id])))return null;
    return packet;
  }
  const base=await read(current);if(!base||await availabilityDigestV259(base)!==digest)return result;
  const id=fields.indexOf('propertyId'),byId=new Map(base.rows.map(row=>[row[id],row])),baseIds=new Set(byId.keys());
  for(const view of ['active','all','completed']){
    if(view===current)continue;
    const packet=await read(view);if(!packet)continue;
    const changes=[],added=[],borrowed=[];
    for(const row of packet.rows){const before=byId.get(row[id]);
      if(!before){added.push(row);byId.set(row[id],row);continue;}
      if(!baseIds.has(row[id]))borrowed.push(row[id]);
      const cells=[];row.forEach((value,index)=>{const prior=before[index];
        if(value!==prior&&(value===null||typeof value!=='object'||JSON.stringify(value)!==JSON.stringify(prior)))cells.push([index,value]);
      });
      if(cells.length)changes.push([row[id],cells]);
    }
    result.variants.push({view,fields:packet.fields,order:packet.rows.map(row=>row[id]),added,borrowed,changes,total:packet.total,
      digest:await availabilityDigestV259(packet),cardProjectionV157:packet.cardProjectionV157===true});
  }
  if(await revision()!==state.revision)return {...result,variants:[]};
  return result;
}
