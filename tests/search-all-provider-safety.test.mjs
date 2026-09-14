import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../js/script.js",import.meta.url),"utf8");
const start=source.indexOf("function parseOriginalListingNumberKeyword");
const end=source.indexOf("function parseExactJibunKeyword",start);
const {parseOriginalListingNumberKeyword:parse,matchesOriginalListingNumber:matches}=new Function(source.slice(start,end)+";return {parseOriginalListingNumberKeyword,matchesOriginalListingNumber};")();
test("Gongsil numbers, provider-prefix short IDs, and direct IDs are searchable",()=>{
  const item={propertyId:"M-123456-abcd",sourceListingSearchV6579:["g:2430644","m:123456"],unifiedOriginalsV8:[]};
  assert.equal(matches(item,parse("2430644")),true);
  assert.equal(matches(item,parse("공실박스 2430644")),true);
  assert.equal(matches(item,parse("네이버 2430644")),false);
  assert.equal(matches(item,parse("M-123456-abcd")),true);
  assert.equal(matches({unifiedOriginalsV8:[{source:"공실박스",sourceId:"12345"}]},parse("공실박스 12345")),true);
  assert.equal(parse("12345"),null);
});
test("supported original URL searches are exact, unsupported hosts are not interpreted",()=>{
  const link="https://new.land.naver.com/articles/123456789";
  assert.equal(matches({sourceLink:link},parse(link)),true);
  assert.equal(matches({unifiedOriginalsV8:[{link}]},parse(link)),true);
  assert.equal(matches({sourceLink:link+"0"},parse(link)),false);
  assert.equal(parse("https://evilnaver.com/articles/123456789"),null);
});
