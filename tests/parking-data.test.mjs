import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeParking} from '../tools/update-daejeon-parking.mjs';

test('parking normalization preserves unknowns, isolates Daejeon, rejects bad coordinates and takes newest duplicate',()=>{
  const base={PRKPLCE_NO:'test',PRKPLCE_NM:'검사 주차장',RDNMADR:'대전광역시 서구 검사로 1',LATITUDE:'36.35',LONGITUDE:'127.38',PRKPLCE_SE:'공영',PRKCMPRT:'0',REFERENCE_DATE:'2026-01-01'};
  const result=normalizeParking([base,{...base,REFERENCE_DATE:'2026-02-01',PRKCMPRT:'32'},
    {...base,PRKPLCE_NO:'unknown',PRKPLCE_SE:'',PRKCMPRT:''},
    {...base,PRKPLCE_NO:'bad',LATITUDE:'0'}, {...base,PRKPLCE_NO:'seoul',RDNMADR:'서울특별시 강남구'}]);
  assert.equal(result.items.length,2);assert.equal(result.invalidCoordinates,1);
  assert.equal(result.items.find(i=>i.id==='test').capacity,32);
  const unknown=result.items.find(i=>i.id==='unknown');assert.equal(unknown.capacity,null);assert.equal(unknown.kind,'미확인');assert.equal(unknown.basicFee,null);
});

test('published parking snapshot has unique valid coordinates and all five districts with source dates',async()=>{
  const data=JSON.parse(await readFile(new URL('../data/daejeon-parking-v1.json',import.meta.url),'utf8'));
  assert.equal(data.schemaVersion,1);assert.match(data.sourceUrl,/^https:\/\/www\.data\.go\.kr\//);
  assert.ok(data.items.length>=50);assert.equal(new Set(data.items.map(i=>i.id)).size,data.items.length);
  for(const district of ['서구','유성구','대덕구','중구','동구'])assert.ok(data.items.some(i=>i.address.includes(' '+district+' ')),district);
  for(const item of data.items){assert.ok(item.lat>36.1&&item.lat<36.65&&item.lng>127.1&&item.lng<127.7);assert.match(item.referenceDate,/^\d{4}-\d{2}-\d{2}$/);assert.ok(item.capacity===null||Number.isInteger(item.capacity)&&item.capacity>0);}
});
