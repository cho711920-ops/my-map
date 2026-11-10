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
  const compatibility=unified?window.JSUnifiedListingsV8.attachCompatible(allItems,originals.expandUnifiedResult(unified)):null;
  allItems.forEach(item=>{if(!item.latlng)locate(item);});
  return {
    query(spec={}) {
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
        ignoreDone:spec.ignoreDone===true,availabilityView:spec.availabilityView,deferQueryFinalizeV151:spec.deferFinalize===true});
    },
    master(id){return allItems.find(item=>String(item.propertyId)===String(id));},
    firstThumbnail:original=>originals.thumbnailImagesV119(original)[0] || '',
    compatibility,
    finalize(rows,spec={}){setMode(spec.mode||'lease');return finalizeQueryV151(rows,{...spec,mode:spec.mode||'lease'});},
    expand:originals.expandUnifiedResult,
    csv(text){const rows=parseCSVRecordsV655(text);if(!rows.length||rows[0].length!==34)throw new Error('Invalid master CSV');
      return rows.slice(1).map((row,index)=>{if(row.length!==34)throw new Error('Truncated master CSV');
        // CSV substring views otherwise retain its entire 12MB backing string.
        return JSON.parse(JSON.stringify(csvMasterV151(row,index+1)));});},
    rawMaster:listingChangeRowToItemV683
  };
}
