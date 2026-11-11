/* Complete read-only advertisement projections; no contact, memo or writes. */
(function(global){
  'use strict';
  var allowed=new Set(['minDeposit','maxDeposit','saleLandMin','saleLandMax','saleGrossMin','saleGrossMax','saleYieldMin','saleYieldMax','saleCategoryFilter']);
  function supported(spec){return spec?.mode==='building_sale'&&spec.hideDone!==false&&!spec.doneOnly&&!spec.gongsilOnly&&!spec.newListingDays&&!spec.favoriteOnly&&
    Object.entries(spec.filters||{}).every(function(pair){return !pair[1]||allowed.has(pair[0])||pair[0]==='sortFilter'&&pair[1]==='latest';});}
  function prepare(packet){
    var catalog=packet.numericCatalogV177;
    if(!catalog||catalog.version!==177||catalog.format!=='row-deltas-v177'||catalog.complete!==true||catalog.revision!==packet.revision||packet.perPropertyOverridesV152||packet.numericLocalV177)return null;
    var view=global.JSQueryCollectionV152.decode(packet),groups=new Map(),count=0,baseRows=new Map(packet.rows.map(function(values){return [values[packet.fields.indexOf('propertyId')],values];}));
    if(!Array.isArray(catalog.groups)||catalog.groups.length>view.rows.length)throw Error('Incomplete numeric catalog');
    catalog.groups.forEach(function(pair){
      if(!Array.isArray(pair)||pair.length!==2||groups.has(pair[0])||!view.byId.has(pair[0])||!Array.isArray(pair[1])||pair[1].length<2)throw Error('Invalid numeric group');
      var base=view.byId.get(pair[0]),seen=new Set();
      if(base.queryMatchedOriginalCountV152!==pair[1].length)throw Error('Incomplete advertisements');
      var rows=pair[1].map(function(delta){
        if(!Array.isArray(delta)||delta.length>packet.fields.length)throw Error('Invalid numeric delta');
        var values=baseRows.get(pair[0]).slice(),changed=new Set();
        delta.forEach(function(entry){
          if(!Array.isArray(entry)||entry.length!==2||!Number.isSafeInteger(entry[0])||entry[0]<0||entry[0]>=packet.fields.length||changed.has(entry[0])||['propertyId','sourceSnapshotKey'].includes(packet.fields[entry[0]]))throw Error('Advertisement identity mismatch');
          changed.add(entry[0]);values[entry[0]]=entry[1];
        });
        var row=global.JSQueryCollectionV152.decode(Object.assign({},packet,{numericCatalogV177:undefined,total:1,rows:[values]})).rows[0];
        if(row.propertyId!==base.propertyId||row.sourceSnapshotKey!==base.sourceSnapshotKey||!row.querySelectedOriginalIdV152||seen.has(row.querySelectedOriginalIdV152)||row.queryMatchedOriginalCountV152!==1)throw Error('Advertisement identity mismatch');
        seen.add(row.querySelectedOriginalIdV152);if(++count>100000)throw Error('Catalog bound');return row;
      });groups.set(pair[0],rows);
    });
    view.rows.forEach(function(row){if(!Number.isSafeInteger(row.queryMatchedOriginalCountV152)||row.queryMatchedOriginalCountV152<0||row.queryMatchedOriginalCountV152>1&&!groups.has(row.propertyId))throw Error('Missing numeric group');});
    return {packet:packet,rows:view.rows,groups:groups};
  }
  function number(value,fallback){var raw=String(value??'').trim();if(!raw)return fallback;var result=Number(raw.replace(/,/g,''));return Number.isFinite(result)?result:fallback;}
  function filter(prepared,spec){
    if(!supported(spec)||!global.JSListingTradeV1||!global.JSSaleWorkbenchV1)return null;
    var f=spec.filters||{};
    if(!Object.entries(f).some(function(pair){return pair[1]&&pair[0]!=='sortFilter';}))return Object.assign({},prepared.packet,{numericLocalV177:true});
    var bounded=!!(f.minDeposit||f.maxDeposit),min=number(f.minDeposit,0),max=number(f.maxDeposit,Infinity),rows=[];
    prepared.rows.forEach(function(base){
      var candidates=prepared.groups.get(base.propertyId)||[base],matched=[];
      candidates.forEach(function(row){var price=global.JSListingTradeV1.displayPrice(row);
        if(global.JSListingTradeV1.matchesItem(row,'building_sale')&&(!bounded||row.displayValuePresence?.salePrice!==false)&&price>=min&&price<=max&&global.JSSaleWorkbenchV1.matches(row,f))matched.push(row);
      });
      if(!matched.length)return;
      var row=Object.assign({},matched[0]);
      if(prepared.groups.has(base.propertyId)){row.queryMatchedOriginalCountV152=matched.length;row.unifiedOriginalCountV8=matched.length;row.sourceTypesV8=Array.from(new Set(matched.flatMap(function(value){return value.sourceTypesV8||[];})));}
      rows.push(prepared.packet.fields.map(function(field){return row[field]??null;}));
    });
    // Default order is master registration time and sheet ordinal, unchanged
    // by choosing another advertisement. Map grouping remains the shared UI.
    return Object.assign({},prepared.packet,{total:rows.length,rows:rows,numericCatalogV177:undefined,numericLocalV177:true});
  }
  global.JSQueryNumericV177={prepare:prepare,filter:filter,supported:supported};
})(typeof window==='object'?window:globalThis);
