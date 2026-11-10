import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/building-registry-core-v164.js';
import {validateBuildingRegistryV164} from '../cloudflare/src/building-registry-v164.js';
const core=globalThis.JSBuildingRegistryCoreV164,p='대전광역시 서구 괴정동 6-3',q='대전광역시 서구 괴정동 6-4';
const building=()=>({id:'building-A',label:'같은 건물',parcels:[p,q],memberIds:['P-A','P-B'],excludedIds:[],autoParcels:[p,q],anchor:{lat:36.35,lng:127.38}});
const contact=()=>({id:'contact-A',label:'확인한 임대인',parcels:[p,q],memberIds:['P-A','P-B'],excludedIds:[],autoParcels:[p,q],phone:'01012345678',baselines:[{id:'P-A',phone:'',manual:false},{id:'P-B',phone:'01098765432',manual:true}]});
const doc=()=>({schema:164,buildings:[building()],contacts:[contact()]});
test('only exact verified Daejeon parcels normalize; roads, units, nearby bunji and other cities never guess',()=>{
  assert.equal(core.parcel('대한민국 대전광역시 서구 괴정동 006-03'),p);
  assert.equal(core.parcel('대전 서구 괴정동 6-3'),p);
  assert.equal(core.parcel('서구 괴정동 6-3번지'),p);
  for(const value of ['서울 서구 괴정동 6-3','서구 괴정동','서구 괴정동 6-3 2층','서구 계룡로 10','괴정동 6-3'])assert.equal(core.parcel(value),'');
  const view=core.index(core.validate(doc()));
  assert.equal(core.buildingFor(view.buildings,{id:'NEW',parcel:p}).id,'building-A');
  assert.equal(core.buildingFor(view.buildings,{id:'P-A',parcel:'대전광역시 서구 괴정동 6-30'}),null);
  assert.equal(core.buildingFor(view.buildings,{id:'OTHER',parcel:'대전광역시 서구 괴정동 6-30'}),null);
});
test('map grouping and common owner are independent and preserve exact exclusions',()=>{
  const value=doc();value.contacts[0].excludedIds=['P-B'];
  const view=core.index(core.validate(value)),m={id:'P-B',parcel:p,phone:'01098765432',manual:true};
  assert.equal(core.buildingFor(view.buildings,m).id,'building-A');assert.equal(core.contactFor(view,m),null);
  value.buildings=[];assert.equal(core.contactFor(core.index(core.validate(value)),{id:'P-A',parcel:p}).phone,'01012345678');
  value.contacts=[];value.buildings=[building()];assert.equal(core.contactFor(core.index(core.validate(value)),{id:'P-A',parcel:p}),null);
});
test('approved baselines allow explicit common selection, but newer individual edits and clears win',()=>{
  const view=core.index(core.validate(doc())),match=item=>core.contactFor(view,{parcel:p,...item});
  assert.equal(match({id:'P-B',manual:true,phone:'01098765432'}).phone,'01012345678');
  assert.equal(match({id:'P-B',manual:true,phone:'01022223333'}),null);
  assert.equal(match({id:'P-B',manual:true,phone:''}),null);
  assert.equal(match({id:'NEW',manual:true,phone:'01022223333'}),null);
  assert.equal(match({id:'NEW',manual:false,phone:'01022223333'}).phone,'01012345678');
  assert.equal(match({id:'NEW',manual:true,phone:'01012345678'}).phone,'01012345678');
});
test('partial scope restricts future ads to explicitly approved parcels or IDs',()=>{
  const value=doc();value.buildings[0].autoParcels=[];value.contacts[0].autoParcels=[];
  const view=core.index(core.validate(value));
  assert.equal(core.buildingFor(view.buildings,{id:'NEW',parcel:p}),null);assert.equal(core.contactFor(view,{id:'NEW',parcel:p}),null);
  assert.equal(core.contactFor(view,{id:'P-A',parcel:p}).phone,'01012345678');
});
test('server rejects duplicates, ambiguous scopes, bad baselines, invalid coordinates/phones and oversized documents',()=>{
  const invalid=[
    d=>d.buildings.push({...building(),id:'duplicate'}),
    d=>d.contacts.push({...contact(),id:'duplicate',memberIds:['OTHER'],baselines:[{id:'OTHER',phone:'',manual:false}]}),
    d=>d.buildings[0].parcels.push('서구 괴정동 6-3'),
    d=>d.buildings[0].excludedIds.push('P-A'),
    d=>d.buildings[0].anchor.lat=91,
    d=>d.contacts[0].phone='01000000000',
    d=>d.contacts[0].baselines[0].id='P-X',
    d=>d.contacts[0].baselines[0].manual='yes',
    d=>d.contacts[0].autoParcels.push('대전광역시 서구 괴정동 9-9'),
    d=>d.contacts[0].label='x'.repeat(101),
    d=>d.extra='x'.repeat(core.maxBytes)
  ];
  for(const change of invalid){const value=doc();change(value);assert.throws(()=>validateBuildingRegistryV164(value,'default'),e=>e.statusCode===400);}
  assert.throws(()=>validateBuildingRegistryV164(doc(),'other'),e=>e.statusCode===400);
  assert.equal(core.displayPhone('010-1234-5678'),'010-1234-5678');
  assert.deepEqual(validateBuildingRegistryV164(doc(),'default'),doc());
});
