import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import {naverLandFields,withNaverLandDisplay} from '../cloudflare/src/land-sale-facts.js';
import {naverSaleFields} from '../cloudflare/src/sale-fields.js';
import {compactSaleSummary,handleD1GetAction} from '../cloudflare/src/d1-api.js';

const raw={saleRaw:{detailInfo:{spaceInfo:{currentPurpose:'농지',recommendedPurpose:'주말농장',areaUsage:'자연녹지지역',approachRoad:true},sizeInfo:{landSpace:2522},articleDetailInfo:{articleName:'답'}}}};
const expected={landUse:'답',zoning:'자연녹지지역',currentUse:'농지',recommendedUse:'주말농장',roadAccess:'진입도로 있음',landAreaM2:2522};
const base={source:'네이버',tradeType:'sale',saleCategory:'land',salePrice:50000,area:0,saleDetails:{scope:'land'}};
test('explicit Naver land fields recover without guessing cadastral type, road legality or permission',()=>{
  assert.deepEqual(naverLandFields(raw),expected);
  const result=naverSaleFields({...base,...raw});
  for(const [key,value]of Object.entries(expected))assert.equal(result[key],value,key);
  for(const name of ['토지/임야','좋은 대지','대전','대 100평','<img>'])assert.equal(naverLandFields({articleName:name}).landUse,undefined);
  for(const approachRoad of [0,1,'true','false',null,[],{}])assert.equal(naverLandFields({spaceInfo:{approachRoad}}).roadAccess,undefined);
  assert.equal(naverLandFields({spaceInfo:{approachRoad:false}}).roadAccess,'진입도로 없음');
  assert.deepEqual(naverLandFields({spaceInfo:{landUsage:true,buildingPermission:true,landTradePermission:true}}),{});
  for(const value of [null,false,'bad',12,[]])assert.deepEqual(naverLandFields(value),{});
});
test('land supplement preserves manual blank/zero and saved facts, identities and other markets',()=>{
  const original={...base,key:'unchanged',propertyId:'M',saleDetails:{...base.saleDetails,landUse:'대',zoning:null,manualSaleFieldsV1:['zoning'],landAreaM2:0}};
  const before=structuredClone(original),shown=withNaverLandDisplay(original,raw);
  assert.equal(shown.saleDetails.landUse,'대');assert.equal(shown.saleDetails.zoning,null);assert.equal(shown.saleDetails.landAreaM2,0);
  assert.deepEqual(original,before);assert.equal(shown.key,original.key);assert.equal(shown.salePrice,original.salePrice);
  for(const patch of [{tradeType:'lease'},{source:'당근'},{saleCategory:'building'}]){const o={...base,...patch};assert.equal(withNaverLandDisplay(o,raw),o);}
});
test('real SQLite list and detail recover the same source-local land facts without returning raw data or writing',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const folder=new URL('../cloudflare/migrations/',import.meta.url);
  for(const file of readdirSync(folder).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL(file,folder),'utf8'));
  const cases=[{raw,expected},{raw:{...raw,saleRaw:{detailInfo:{spaceInfo:{approachRoad:null}},spaceInfo:{approachRoad:false}}},expected:{roadAccess:'진입도로 없음'}},
    {raw:{saleRaw:{spaceInfo:{areaUsage:'제2종일반주거지역',landSpace:100},detailInfo:{sizeInfo:{landSpace:0}},articleDetailInfo:{articleName:'대'}}},expected:{landUse:'대',zoning:'제2종일반주거지역',landAreaM2:100}},
    {raw,snapshot:{...base,saleDetails:{scope:'land',landUse:'전',manualSaleFieldsV1:['zoning'],zoning:''}},expected:{...expected,landUse:'전',zoning:''}}];
  cases.forEach((c,i)=>{const id='L'+i,snapshot={...base,...c.snapshot,originalId:'S'+i,propertyId:id};c.snapshot=snapshot;
    db.prepare("INSERT INTO listings(id,property_id,status,trade_type,sale_category)VALUES(?,?,'active','sale','land')").run(id,id);
    db.prepare("INSERT INTO listing_sources(id,listing_id,source,source_listing_id,active,trade_type,sale_category,list_snapshot_json,raw_json)VALUES(?,?,'네이버',?,1,'sale','land',?,?)").run('S'+i,id,'source'+i,JSON.stringify(snapshot),JSON.stringify({...c.raw,private:'NEVER_EXPOSE_RAW'}));});
  const before=db.prepare('SELECT list_snapshot_json,raw_json FROM listing_sources ORDER BY id').all(),queries=[];
  function prepare(sql,values=[]){queries.push(sql);const indexes=[],q=sql.replace(/\?(\d+)/g,(_,n)=>{indexes.push(Number(n)-1);return '?';});const args=()=>indexes.length?indexes.map(i=>values[i]):values;
    return {bind(...v){return prepare(sql,v);},async all(){return {results:db.prepare(q).all(...args())};},async first(){return db.prepare(q).get(...args())||null;}};}
  const env={DB:{prepare}},list=await handleD1GetAction(env,{}, {action:'unifiedListings'});
  assert.doesNotMatch(JSON.stringify(list),/NEVER_EXPOSE_RAW|approachRoadType|articleName/);
  for(const [i,c]of cases.entries()){
    const detail=await handleD1GetAction(env,{}, {action:'unifiedListingDetail',propertyId:'L'+i}),o=detail.originals[0],summary=list.groups['L'+i][0][list.fields.indexOf('saleSummary')];
    assert.deepEqual(summary,compactSaleSummary(o));for(const [key,value]of Object.entries(c.expected))assert.equal(o.saleDetails[key],value,`${i}:${key}`);
    assert.equal(o.salePrice,base.salePrice);
  }
  assert.deepEqual(db.prepare('SELECT list_snapshot_json,raw_json FROM listing_sources ORDER BY id').all(),before);
  assert.ok(queries.every(q=>/^\s*SELECT\b/.test(q)));
});
test('list facts use the selected advertisement and show unknowns without unsafe markup',()=>{
  const window={};vm.runInNewContext(readFileSync('js/listing-trade-ui-v1.js','utf8'),{window,document:{getElementById:()=>null,querySelector:()=>null,documentElement:{setAttribute(){}}}});
  const ui=window.JSListingTradeV1,a={...base,link:'https://example.test/a',saleDetails:expected},b={...a,link:'https://example.test/b',saleDetails:{...expected,roadAccess:'진입도로 없음'}};
  const master={...base,saleDetails:null,unifiedOriginalsV8:[a,b]};
  assert.doesNotMatch(ui.landFactsHtml(master),/진입도로 있음|진입도로 없음/);
  assert.match(ui.landFactsHtml({...master,sourceLink:a.link}),/진입도로 있음/);
  assert.match(ui.landFactsHtml({...base,saleDetails:{zoning:'<img onerror=x>'}}),/&lt;img/);
  assert.equal((ui.landFactsHtml(base).match(/원본 미제공/g)||[]).length,4);
  assert.equal(ui.landFactsHtml({...base,tradeType:'lease'}),'');
});
