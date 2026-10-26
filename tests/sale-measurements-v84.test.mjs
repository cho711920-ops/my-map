import assert from 'node:assert/strict';
import test from 'node:test';
import {naverSaleMeasurements, saleMeasurements} from '../cloudflare/src/sale-measurements.js';
import {naverSaleFields, gongsilSaleFields} from '../cloudflare/src/sale-fields.js';
import {saleAreaProvider, withSaleAreaDisplay} from '../cloudflare/src/sale-area-display.js';
import {compactSaleSummary} from '../cloudflare/src/d1-api.js';

const size={landSpace:223.5,buildingSpace:134.05,floorSpace:444.34,exclusiveSpace:59.5,buildingCoverageRatio:59.98,floorAreaRatio:170.6};
const expected={landAreaM2:223.5,buildingAreaM2:134.05,grossAreaM2:444.34,exclusiveAreaM2:59.5,buildingCoverageRatio:59.98,floorAreaRatio:170.6};
const ad={source:'네이버',tradeType:'sale',saleCategory:'building',salePrice:80000,saleDetails:{scope:'whole_building'}};

test('measurements read sizeInfo alongside nonempty spaceInfo at every saved provider container',()=>{
  for(const raw of [{saleRaw:{detailInfo:{sizeInfo:size,spaceInfo:{floorInfo:{targetFloor:'전체'}}}}},
    {saleRaw:{sizeInfo:size,spaceInfo:{direction:'남'}}},{sizeInfo:size,spaceInfo:{direction:'남'}},
    {saleRaw:{detailInfo:{spaceInfo:size}}},{saleRaw:{spaceInfo:size}},{spaceInfo:size}]){
    assert.deepEqual(naverSaleMeasurements(raw),expected);
    const normalized=naverSaleFields({...raw,saleCategory:'building'});
    for(const [key,value]of Object.entries(expected))assert.equal(normalized[key],value);
    const before=structuredClone(raw),shown=withSaleAreaDisplay(ad,saleAreaProvider(raw,'네이버'));
    for(const [key,value]of Object.entries(expected))assert.equal(shown.saleDetails[key],value);
    assert.deepEqual(raw,before);
  }
});

test('empty defaults and invalid candidates do not mask explicit measurements or invent FAR',()=>{
  assert.deepEqual(naverSaleMeasurements({saleRaw:{detailInfo:{sizeInfo:{landSpace:0,floorSpace:null},spaceInfo:{landSpace:'223.5',floorSpace:444.34}}}}),{landAreaM2:223.5,grossAreaM2:444.34});
  for(const v of [null,undefined,'',false,true,{},[],[25],-1,0,Infinity,'미제공']){
    assert.deepEqual(naverSaleMeasurements({sizeInfo:{landSpace:v,buildingCoverageRatio:v,floorAreaRatio:v}}),{});
  }
  assert.deepEqual(saleMeasurements({buildingCoverageRatio:101,floorAreaRatio:'1,200.5'}),{floorAreaRatio:1200.5});
  assert.deepEqual(naverSaleMeasurements({area:100,sizeInfo:{landSpace:100,floorSpace:400}}),{landAreaM2:100,grossAreaM2:400});
});

test('existing and manual fields survive read-only repair, including deliberate blank overrides',()=>{
  const original={...ad,saleDetails:{...ad.saleDetails,landAreaM2:300,buildingAreaM2:null,manualSaleFieldsV1:['buildingAreaM2']}},before=structuredClone(original);
  const result=withSaleAreaDisplay(original,saleAreaProvider({sizeInfo:size},'네이버'));
  assert.equal(result.saleDetails.landAreaM2,300);assert.equal(result.saleDetails.buildingAreaM2,null);
  assert.equal(result.saleDetails.grossAreaM2,444.34);assert.deepEqual(original,before);
  assert.equal(result.salePrice,original.salePrice);
  assert.deepEqual(saleAreaProvider({sizeInfo:size},'당근').measurements,{});
  assert.equal(withSaleAreaDisplay({...original,tradeType:'lease'},saleAreaProvider({sizeInfo:size},'네이버')).saleDetails,original.saleDetails);
});

test('gongsil keeps explicit ratios without treating zero-filled register defaults as known data',()=>{
  const raw={list:{TypeView:'건물통'},detail:{getbilbases:{ArchArea:134.05,BcRat:59.98,VlRat:170.6}}};
  const normalized=gongsilSaleFields(raw).saleDetails,shown=withSaleAreaDisplay({...ad,source:'공실박스'},saleAreaProvider(raw,'공실박스'));
  for(const key of ['buildingAreaM2','buildingCoverageRatio','floorAreaRatio']){
    assert.equal(normalized[key],expected[key]);assert.equal(shown.saleDetails[key],expected[key]);
  }
  assert.deepEqual(saleAreaProvider({detail:{getbilbases:{ArchArea:0,BcRat:0,VlRat:0}}},'공실박스').measurements,{});
});

test('compact summaries pass explicit ratios without raw data, derived ratios, or land/lease leakage',()=>{
  const shown=withSaleAreaDisplay(ad,saleAreaProvider({sizeInfo:size},'네이버'));
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(k=>[k,compactSaleSummary(shown)[k]])),expected);
  assert.equal(compactSaleSummary({...shown,tradeType:'lease'}),'');
  assert.equal(compactSaleSummary({...shown,saleCategory:'land'}).floorAreaRatio,undefined);
  assert.equal(compactSaleSummary({...ad,saleDetails:{buildingCoverageRatio:101,floorAreaRatio:0}}).buildingCoverageRatio,undefined);
  assert.equal(compactSaleSummary({...ad,saleDetails:{buildingCoverageRatio:101,floorAreaRatio:0}}).floorAreaRatio,undefined);
  assert.doesNotMatch(JSON.stringify(compactSaleSummary(shown)),/sizeInfo|spaceInfo|description|raw/);
});
