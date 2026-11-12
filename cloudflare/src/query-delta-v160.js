// An authenticated, complete revision history may reuse a complete query on
// the device. The authoritative order and row identities still come from R2.
export async function queryDeltaV160({state,since,changes,loadPacket}) {
  if(typeof since!=='string'||!since||since.length>200)return null;
  let ids;try{ids=changes(state,since);}catch{return null;}
  if(!ids.length)return {ok:true,version:160,queryDeltaV160:true,baseRevision:since,revision:state.revision,unchanged:true};
  const packet=await loadPacket();
  if(packet?.ok!==true||packet.version!==152||packet.completeQuery!==true||packet.revision!==state.revision||packet.total!==packet.rows?.length)return null;
  const idIndex=packet.fields.indexOf('propertyId'),rowIndex=packet.fields.indexOf('sheetRow');
  if(idIndex<0||rowIndex<0)return null;
  const wanted=new Set(ids),rows=packet.rows.filter(row=>wanted.has(row[idIndex])),found=new Set(rows.map(row=>row[idIndex]));
  return {ok:true,version:160,queryDeltaV160:true,baseRevision:since,revision:state.revision,unchanged:false,
    fields:packet.fields,rows,changedIds:ids,missingIds:ids.filter(id=>!found.has(id)),
    order:packet.rows.map(row=>[row[idIndex],row[rowIndex]]),total:packet.total,
    cardProjectionV157:packet.cardProjectionV157===true,grouping:packet.grouping,
    ...(packet.numericCatalogV177?{numericCatalogDeltaV215:{...packet.numericCatalogV177,
      groups:packet.numericCatalogV177.groups.filter(pair=>wanted.has(pair[0]))}}:{})};
}
