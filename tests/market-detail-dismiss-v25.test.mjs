import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
test('only a real market change dismisses detail, before list replacement even when filter resets are disabled',()=>{
  const events=[],window={dispatchEvent(){},allItems:[],applyFilter(){events.push('list');},JSUnifiedListingsV8:{closeForOverlay(){events.push('close');}}};
  const document={getElementById(){return null;},querySelector(){return null;},documentElement:{setAttribute(){}}};
  vm.runInNewContext(fs.readFileSync('js/listing-trade-ui-v1.js','utf8'),{window,document,CustomEvent:class{}});
  window.JSListingTradeV1.setMode('lease');assert.deepEqual(events,['list']);events.length=0;
  window.JSListingTradeV1.setMode('building_sale',{resetFilters:false});assert.deepEqual(events,['close','list']);events.length=0;
  window.JSListingTradeV1.setMode('land_sale',{apply:false,resetFilters:false});assert.deepEqual(events,['close']);events.length=0;
  window.JSListingTradeV1.setMode('invalid');assert.equal(window.JSListingTradeV1.getMode(),'lease');assert.deepEqual(events,['close','list']);
});
