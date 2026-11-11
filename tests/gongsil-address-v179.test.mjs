import test from 'node:test';
import assert from 'node:assert/strict';
import {hasExactLotAddress, hasPublishableCollectorAddress, gongsilExactSourceAddressV179, normalizedRecord} from '../cloudflare/src/collector-api.js';

const detail = {addr:'충남 계룡시 엄사면 엄사리',addrdo:'충남',addrcity:'계룡시',addrdong:'엄사면',addrlee:'엄사리',addrbun:'129-1'};
test('rural parcel requires city/county, township, village and an actual lot number',()=>{
  for (const address of ['충남 계룡시 엄사면 엄사리 129-1','공주시 계룡면 화헌리 254-4','금산군 복수면 곡남리 산 12-3','세종 세종 금남면 용담리 193-5','충북 청주시 서원구 현도면 양지리 53-1']) {
    assert.equal(hasExactLotAddress(address),true,address);
    assert.equal(hasPublishableCollectorAddress('공실박스',address),true,address);
  }
  for (const address of ['엄사리 129-1','엄사면 엄사리 129-1','계룡시 엄사면 엄사리','계룡시 엄사면 엄사리 1층','서구 엄사리 129-1','충남 계룡시 엄사면 엄사리 인근']) assert.equal(hasExactLotAddress(address),false,address);
});
test('provider Sejong alias and city district preserve the complete provider hierarchy',()=>{
  assert.equal(gongsilExactSourceAddressV179('용담리 193-5',{addr:'세종 세종 금남면 용담리',addrbun:'193-5'}),'세종 세종 금남면 용담리 193-5');
  const building={addr:'충북 청주시 서원구 현도면 양지리',addrbun:'53-1'};
  assert.equal(gongsilExactSourceAddressV179('서원구 양지리 53-1',building),'충북 청주시 서원구 현도면 양지리 53-1');
  assert.equal(gongsilExactSourceAddressV179('흥덕구 양지리 53-1',building),'흥덕구 양지리 53-1');
});
test('own structured original completes the same village and parcel only',()=>{
  assert.equal(gongsilExactSourceAddressV179('엄사리 129-1',detail),'충남 계룡시 엄사면 엄사리 129-1');
  assert.equal(gongsilExactSourceAddressV179('엄사리 129-1',{...detail,addr:''}),'충남 계룡시 엄사면 엄사리 129-1');
  for(const building of [null,{}, {...detail,addrbun:'129-2'}, {...detail,addr:'충남 계룡시 엄사면 향한리',addrlee:'향한리'}, {...detail,addr:'엄사리',addrcity:''}, {...detail,addrbun:'129-1층'}]) assert.equal(gongsilExactSourceAddressV179('엄사리 129-1',building),'엄사리 129-1');
});
test('never replaces a valid original address, guesses from coordinates, or accepts roads',()=>{
  assert.equal(gongsilExactSourceAddressV179('서구 괴정동 5-12',detail),'서구 괴정동 5-12');
  for(const address of ['', '엄사리', '엄사리 129-2','엄사중앙로 129-1']) assert.equal(gongsilExactSourceAddressV179(address,{...detail,mapx:127,mapy:36}),address);
});
test('old saved payload receives canonical source address without changing terms or manual data',()=>{
  const value={externalId:'test-v179',values:['합성','엄사리 129-1','2층','상가점포',1000,80,0,0,12,'','','설명'],raw:{list:{Subtype:'3',Bo:1000,Mm:80},detail:{bilinfo:detail}}};
  const original=structuredClone(value),record=normalizedRecord('공실박스',value);
  assert.equal(record.address,'충남 계룡시 엄사면 엄사리 129-1');
  assert.equal(record.deposit,1000);assert.equal(record.rent,80);
  assert.deepEqual(value,original);
});
