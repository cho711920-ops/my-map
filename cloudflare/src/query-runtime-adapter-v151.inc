export function createListingQueryRuntimeV151(items,unified) {
  // Operational registration dates are Korean local dates. Workers run UTC;
  // keep their numeric date constructor aligned with the desktop's KST order.
  const NativeDate=globalThis.Date;
  const Date=class extends NativeDate {
    constructor(...args){if(args.length>1)super(NativeDate.UTC(...args)-9*60*60*1000);
      else if(args.length)super(args[0]);else super();}
  };
  var allItems=items,map,favoriteOnly=false,favoriteKeys=[],favoriteFilterKeys=[],activeFavoriteFolderId='',
    hideDone=true,doneOnly=false,gongsilOnly=false,newListingDays=0;
  var NATURAL_ADDRESS_COLLATOR=new Intl.Collator('ko',{numeric:true,sensitivity:'base'});
  const sharedJsonV175=new Map(),sharedTextV175=new Map();
  function shareQueryValueV175(value) {
    if(value&&typeof value==='object'){
      const key=JSON.stringify(value);
      if(sharedJsonV175.has(key))return sharedJsonV175.get(key);
      const copy=Array.isArray(value)?value.map(shareQueryValueV175):Object.fromEntries(Object.entries(value).map(([key,value])=>[key,shareQueryValueV175(value)]));
      if(sharedJsonV175.size<2048&&key.length<8192)sharedJsonV175.set(key,copy);
      return copy;
    }
    if(typeof value!=='string')return value;
    if(value.length<128&&sharedTextV175.has(value))return sharedTextV175.get(value);
    const copy=JSON.parse(JSON.stringify(value));
    if(copy.length<128&&sharedTextV175.size<4096)sharedTextV175.set(copy,copy);
    return copy;
  }
  const elements=Object.create(null);
  const filters=['keyword','typeFilter','sourceFilter','floorQuickFilter','brokerageFeeFilter','sortFilter','industryFilter',
    'minDeposit','maxDeposit','minRent','maxRent','minPremium','maxPremium','minArea','maxArea','minFloor','maxFloor',
    'saleLandMin','saleLandMax','saleGrossMin','saleGrossMax','saleYieldMin','saleYieldMax','saleUnitPriceMin','saleUnitPriceMax',
    'saleCategoryFilter','saleLandUseFilter','saleZoningFilter'];
  filters.forEach(id=>{elements[id]={value:''};});
  const classList={add(){},remove(){},toggle(){}};
  const document={getElementById:id=>elements[id] || null,addEventListener(){},querySelector(){return null;},
    documentElement:{setAttribute(){},classList},readyState:'loading'};
  const CustomEvent=class{constructor(type,init){this.type=type;this.detail=init?.detail;}};
  class LatLng {constructor(lat,lng){this.lat=Number(lat);this.lng=Number(lng);}getLat(){return this.lat;}getLng(){return this.lng;}}
  const kakao={maps:{LatLng}};
  const storage={getItem(){return null;},setItem(){},removeItem(){}};
  const localStorage=storage;
  const fetch=()=>{throw new Error('Query projection attempted network or a mutation');};
  const window={document,kakao,localStorage,sessionStorage:storage,innerWidth:1280,addEventListener(){},dispatchEvent(){},
    setTimeout(){return 0;},clearTimeout(){},fetch,CustomEvent,JSAuthenticatedAccountEmail:'query-runtime@js.invalid'};
  Object.defineProperty(window,'allItems',{get:()=>allItems});
  Object.defineProperty(window,'map',{get:()=>map});
  Object.defineProperty(window,'newListingDays',{get:()=>newListingDays});
  Object.defineProperty(window,'hideDone',{get:()=>hideDone});
  Object.defineProperty(window,'doneOnly',{get:()=>doneOnly});
  Object.defineProperty(window,'favoriteOnly',{get:()=>favoriteOnly});
  /* QUERY_DECLARATIONS_V151 */
  const setMode=installTrade(window);installSale(window);installBrokerage(window);installParcel(window);
  const originals=installOriginals(window);
  function locate(item) {
    if (item.latitude!==null && item.latitude!=='' && item.longitude!==null && item.longitude!=='' &&
      Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude))) item.latlng=new LatLng(item.latitude,item.longitude);
    else item.latlng=null;
    item.key=item.key || itemKey(item);
  }
  allItems.forEach(locate);
  const byId=new Map(allItems.map(item=>[String(item.propertyId),item]));
  const compatibility=unified?window.JSUnifiedListingsV8.attachCompatible(allItems,originals.expandUnifiedResult(unified)):null;
  allItems.forEach(item=>{if(!item.latlng)locate(item);});
  return {
    query(spec={},captureProjectionV177=null) {
      if(!compatibility?.complete)throw new Error('Query index has unverified master/source pairs');
      const mode=spec.mode || 'lease';
      if (!['lease','building_sale','land_sale'].includes(mode)) throw new Error('Invalid query market');
      setMode(mode);
      filters.forEach(id=>{elements[id].value=String(spec.filters?.[id] ?? (id==='sortFilter'?'latest':''));});
      favoriteOnly=spec.favoriteOnly===true;favoriteKeys=Array.isArray(spec.favoriteKeys)?spec.favoriteKeys:[];
      favoriteFilterKeys=Array.isArray(spec.favoriteFilterKeys)?spec.favoriteFilterKeys:[];
      activeFavoriteFolderId=String(spec.favoriteFolderId || '');
      hideDone=spec.hideDone!==false;doneOnly=spec.doneOnly===true;gongsilOnly=spec.gongsilOnly===true;
      newListingDays=Number(spec.newListingDays || 0);
      if (newListingDays===1 && !spec.today) throw new Error('Today requires its confirmed period scope');
      window.JSTodayListingsV1=spec.today?{
        globalScope:()=>spec.today.globalScope!==false,
        matches:item=>spec.today.ids.includes(String(item.propertyId)),
        matchesOriginal:(master,original)=>(spec.today.originalIds[String(master.propertyId)] || []).includes(String(original.originalId))
      }:null;
      window.jsMobileGlobalKeywordV1=spec.globalKeyword===true;
      window.mapRadiusFilterV658=spec.radius || null;window.mapPolygonFilterV661=spec.polygon || null;
      const bounds=spec.bounds || {south:-90,north:90,west:-180,east:180};
      map={getBounds:()=>({contain:point=>point.getLat()>=bounds.south && point.getLat()<=bounds.north &&
        (bounds.west<=bounds.east?point.getLng()>=bounds.west && point.getLng()<=bounds.east:point.getLng()>=bounds.west || point.getLng()<=bounds.east)})};
      return getFilteredItems({includeUnlocated:spec.includeUnlocated===true,ignoreMapBounds:spec.ignoreMapBounds===true,
        ignoreDone:spec.ignoreDone===true,availabilityView:spec.availabilityView,captureProjectionV177,deferQueryFinalizeV151:spec.deferFinalize===true});
    },
    projectionPredicateV215(spec){
      setMode(spec.mode||'lease');filters.forEach(id=>{elements[id].value=String(spec.filters?.[id]??(id==='sortFilter'?'latest':''));});
      hideDone=true;doneOnly=false;gongsilOnly=false;newListingDays=0;favoriteOnly=false;
      window.mapRadiusFilterV658=null;window.mapPolygonFilterV661=null;
      map={getBounds:()=>({contain:()=>true})};
      return createQueryFilterPredicateV215(spec);
    },
    master(id){return byId.get(String(id));},
    firstThumbnail:original=>originals.thumbnailImagesV119(original)[0] || '',
    preparedMatchesV176(item,spec){
      setMode(spec.mode);
      for(const name of ['minDeposit','maxDeposit'])elements[name].value=String(spec.filters?.[name]||'');
      const f=spec.filters||{},bounded=!!(f.minDeposit||f.maxDeposit),price=window.JSListingTradeV1.displayPrice(item);
      return window.JSListingTradeV1.matchesItem(item,spec.mode)&&
        (!bounded||item.displayValuePresence?.salePrice!==false)&&
        price>=readOptionalFilterNumberV1('minDeposit',0)&&price<=readOptionalFilterNumberV1('maxDeposit',Infinity)&&
        window.JSSaleWorkbenchV1.matches(item,f);
    },
    compatibility,
    groupKey(id){return originals.wholeBuildingKeyV55(byId.get(String(id)));},
    visitFlags(item){return {queryPendingVisitV152:isFieldVisitItem(item),queryConfirmedVisitV152:isConfirmedVisitItem(item)};},
    finalize(rows,spec={}){setMode(spec.mode||'lease');return finalizeQueryV151(rows,{...spec,mode:spec.mode||'lease'});},
    expand:originals.expandUnifiedResult,
    csv(text){const rows=parseCSVRecordsV655(text);if(!rows.length||rows[0].length!==34)throw new Error('Invalid master CSV');
      return rows.slice(1).map((row,index)=>{if(row.length!==34)throw new Error('Truncated master CSV');
        // CSV substring views otherwise retain its entire 12MB backing string.
        return JSON.parse(JSON.stringify(csvMasterV151(row,index+1)));});},
    csvRecordV175(text,ordinal){const rows=parseCSVRecordsV655(text);
      if(rows.length!==1||rows[0].length!==34)throw new Error('Invalid master CSV record');
      if(!ordinal)return null;
      // descriptionText is detail-only; keyword/industry matching uses the intact
      // operating memo. Financial facts, manual fields and all other values stay.
      const detail=parseDirectSaleDetailsV1(rows[0][31]);
      if(detail&&typeof detail==='object')delete detail.descriptionText;
      const fields=rows[0].map((value,index)=>shareQueryValueV175(index===31?detail:value));
      return {propertyId:clean(fields[15]),sourceSnapshotKey:clean(fields[32]),sheetRow:ordinal+1,queryCsvFieldsV175:fields};},
    mayMatchV175(item,originalRows,spec){
      const fields=item.queryCsvFieldsV175,master=fields?{address:fields[1],type:fields[3],source:fields[14],tradeType:fields[28],saleCategory:fields[29],salePrice:fields[30],saleDetails:fields[31]}:item;
      const f=spec.filters||{},keyword=String(f.keyword||'').trim();
      const exact=keyword.split(',').map(v=>v.trim()).filter(Boolean).map(v=>parseExactJibunKeyword(v)||(spec.mode==='building_sale'?parseBuildingParcelKeywordV193(v):null));
      if(exact.length&&exact.every(Boolean)&&!exact.some(v=>matchesExactJibunAddress(master,v)))return false;
      if(spec.mode==='building_sale'&&f.saleCategoryFilter){
        const categories=[master,...originalRows].map(row=>window.JSListingTradeV1.normalizedSaleCategory(row));
        if(categories.every(category=>category&&category!==f.saleCategoryFilter))return false;
      }
      if(spec.mode==='lease'||(!f.minDeposit&&!f.maxDeposit&&!f.saleLandMin&&!f.saleLandMax&&!f.saleGrossMin&&!f.saleGrossMax&&!f.saleYieldMin&&!f.saleYieldMax))return true;
      // This is only a conservative rejection gate. Candidate facts may come
      // from different ads; the unchanged full runtime still selects and checks
      // the actual original. Never emit these temporary combinations.
      const details=[master.saleDetails||{},...originalRows.map(o=>o.saleSummary||o.saleDetails||{})];
      const price=[master.salePrice,...originalRows.map(o=>o.salePrice)].map(v=>Number(v)||0);
      const low=String(f.minDeposit||'').trim(),high=String(f.maxDeposit||'').trim();
      const min=low&&Number.isFinite(Number(low.replace(/,/g,'')))?Number(low.replace(/,/g,'')):0;
      const max=high&&Number.isFinite(Number(high.replace(/,/g,'')))?Number(high.replace(/,/g,'')):Infinity;
      if((low||high)&&!price.some(v=>v>=min&&v<=max))return false;
      for(const [key,field]of [['saleLand','landAreaM2'],['saleGross','grossAreaM2']]){
        if(key==='saleGross'&&spec.mode==='land_sale')continue;
        const bounds={[key+'Min']:f[key+'Min'],[key+'Max']:f[key+'Max']};
        if((bounds[key+'Min']||bounds[key+'Max'])&&!details.some(d=>window.JSSaleWorkbenchV1.matches({tradeType:'sale',saleCategory:'building',saleDetails:{[field]:d[field]}},bounds)))return false;
      }
      if(spec.mode!=='land_sale'&&(f.saleYieldMin||f.saleYieldMax)){
        const deposits=[...new Set(details.map(d=>d.totalDeposit))],incomes=[...new Set(details.map(d=>d.monthlyIncome))];let possible=false;
        for(const p of new Set(price))for(const deposit of deposits)for(const income of incomes){
          if(window.JSSaleWorkbenchV1.matches({tradeType:'sale',saleCategory:'building',salePrice:p,saleDetails:{totalDeposit:deposit,monthlyIncome:income}}, {saleYieldMin:f.saleYieldMin,saleYieldMax:f.saleYieldMax})){possible=true;break;}
        }
        if(!possible)return false;
      }
      return true;
    },
    jsonRecordV175(text,ordinal,includeIds=null){const value=JSON.parse(text);
      if(!ordinal){if(value.querySheetV175!==175)throw new Error('Invalid prepared sheet');return null;}
      if(!Array.isArray(value)||value.length!==34)throw new Error('Invalid prepared master row');
      if(includeIds&&!includeIds.has(clean(value[15])))return null;
      const fields=value.map(shareQueryValueV175);
      return {propertyId:clean(fields[15]),sourceSnapshotKey:clean(fields[32]),sheetRow:ordinal+1,queryCsvFieldsV175:fields};},
    unpackMasterV175(item){if(!item.queryCsvFieldsV175)return JSON.parse(JSON.stringify(item));
      const fields=item.queryCsvFieldsV175.slice(),details=fields[31];fields[31]='';
      const result=csvMasterV151(fields,item.sheetRow-1);result.saleDetails=details;
      return JSON.parse(JSON.stringify(result));},
    rawMaster:listingChangeRowToItemV683
  };
}
