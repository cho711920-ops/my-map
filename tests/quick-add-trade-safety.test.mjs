import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
import { validateQuickAddTrade } from "../cloudflare/src/quick-add-trade.js";
import { handleD1PostAction, handleD1GetAction, buildD1SheetCsv, masterFallbackOriginal } from "../cloudflare/src/d1-api.js";

test("direct sale validates explicit category and positive price; missing terms stay unknown", () => {
  const result = validateQuickAddTrade({ tradeType: "sale", saleCategory: "building", salePrice: "100,000" }, []);
  assert.equal(result.salePrice, 100000);
  assert.equal(result.saleDetails.monthlyIncome, null);
  assert.equal(result.saleDetails.totalDeposit, null);
  const zero = validateQuickAddTrade({ tradeType: "sale", saleCategory: "land", salePrice: 20, saleDetails: {landAreaM2: 10, monthlyIncome: 0} }, []);
  assert.equal(zero.saleDetails.monthlyIncome, 0);
  for (const salePrice of [0, -1, "", "1억원", true]) assert.throws(() => validateQuickAddTrade({tradeType: "sale", saleCategory: "land", salePrice}, []));
  assert.throws(() => validateQuickAddTrade({tradeType: "sale", saleCategory: "invented", salePrice: 20}, []));
});
test("legacy leases work, but a sale type cannot silently register as lease", () => {
  assert.equal(validateQuickAddTrade({}, ["", "", "", "사무실", 1000, 0]).tradeType, "lease");
  assert.throws(() => validateQuickAddTrade({}, ["", "", "", "매매"]), /거래유형/);
  assert.throws(() => validateQuickAddTrade({tradeType:"lease", salePrice: 1000}, []));
  assert.throws(() => validateQuickAddTrade({}, ["", "", "", "사무실", -1000]));
});
test("D1 quick registration explicitly persists market and optional details", async () => {
  const calls=[];
  const DB={prepare(sql){return {bind(...args){calls.push({sql,args});return this;},async first(){return null;},async run(){return {meta:{changes:1}};}};}};
  const values=Array(25).fill(""); values[0]="테스트 건물"; values[1]="테스트 주소"; values[3]="건물전체"; values[15]="M-test-direct-sale";
  const result=await handleD1PostAction({DB},{email:"owner@example.com",role:"owner"},{action:"quickAdd",values,tradeType:"sale",saleCategory:"building",salePrice:30000,saleDetails:{landAreaM2:50,totalDeposit:0}});
  assert.equal(result.persisted,true);
  const insert=calls.find(c=>/INSERT INTO listings/.test(c.sql));
  assert.deepEqual(insert.args.slice(-4,-1),["sale","building",30000]);
  const details=JSON.parse(insert.args.at(-1)); assert.equal(details.landAreaM2,50); assert.equal(details.totalDeposit,0); assert.equal(details.monthlyIncome,null);
  const exact=calls.find(c=>/AND address = \?1 AND room/.test(c.sql)); assert.deepEqual(exact.args.slice(5),["sale",30000,"building",50,null]);
  const fallback=masterFallbackOriginal({id:"M-test",trade_type:"sale",sale_details_json:JSON.stringify(details)});
  assert.equal(fallback.saleDetails.monthlyIncome,null);
});
test("direct sale metadata does not mask provider sale details on old rows", () => {
  const source=readFileSync(new URL("../js/map.js",import.meta.url),"utf8");
  const code=source.slice(source.indexOf("function parseDirectSaleDetailsV1("),source.indexOf("/* 목록에 적용한 것과 같은"));
  const context=vm.createContext({}); vm.runInContext(code,context);
  assert.equal(context.parseDirectSaleDetailsV1("{}"),null);
  assert.equal(context.parseDirectSaleDetailsV1("bad"),null);
  assert.equal(context.parseDirectSaleDetailsV1('{"totalDeposit":0}').totalDeposit,0);
});

test("late quickadd-at compatibility wrapper preserves explicit sale fields and source", () => {
  const parser=readFileSync(new URL("../js/parser.js",import.meta.url),"utf8");
  const fields={qaTradeMode:"building_sale",qaSaleCategory:"building",qaSalePrice:"30000",qaLandAreaM2:"123.4",qaTotalDeposit:"0",qaMonthlyIncome:"",qaSource:"직접등록",qaMemo:"검수메모"};
  const context=vm.createContext({console, document:{getElementById:id=>({value:fields[id]||""})},
    getQuickAddObject:()=>({name:"테스트건물",address:"서구 도마동 1-1",source:"직접등록",memo:"검수메모"}),parseQuickAddText(){}});
  context.window=context;
  vm.runInContext(parser.slice(parser.indexOf("function getQuickAddRowValues()"),parser.indexOf("function normalizeQuickDuplicateTextV61")),context);
  vm.runInContext(readFileSync(new URL("../js/quickadd-at.js",import.meta.url),"utf8"),context);
  const values=context.getQuickAddRowValues();
  assert.equal(values[14],"직접등록"); assert.equal(values[28],"sale"); assert.equal(values[29],"building");
  assert.equal(values[30],"30000"); assert.equal(JSON.parse(values[31]).landAreaM2,"123.4");
});

function migratedDatabase() {
  const sqlite=new DatabaseSync(":memory:");
  const directory=new URL("../cloudflare/migrations/",import.meta.url);
  for (const file of readdirSync(directory).filter(name=>name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file,directory),"utf8"));
  const prepare=sql=>{
    const statement=sqlite.prepare(sql);
    return {args:[],bind(...args){this.args=args;return this;},
      async first(){return statement.get(...this.args)||null;},async all(){return {results:statement.all(...this.args)};},
      async run(){return {success:true,meta:{changes:Number(statement.run(...this.args).changes)}};}};
  };
  return {sqlite,env:{DB:{prepare}}};
}

test("real SQLite migrations and queries preserve direct-sale details in sheet, delta and detail paths", async () => {
  const {sqlite,env}=migratedDatabase();
  const user={email:"owner@test.invalid",role:"owner"};
  try {
    const values=Array(32).fill(""); values[0]="검증건물";values[1]="서구 도마동 1-1";values[3]="건물전체";values[15]="M-sql-sale";
    const saleDetails={landAreaM2:123.4,grossAreaM2:456.7,totalDeposit:0,monthlyIncome:null};
    const result=await handleD1PostAction(env,user,{action:"quickAdd",values,tradeType:"sale",saleCategory:"building",salePrice:30000,saleDetails});
    assert.equal(result.persisted,true);
    const row=sqlite.prepare("SELECT * FROM listings WHERE id='M-sql-sale'").get();
    assert.equal(row.trade_type,"sale");assert.equal(row.sale_price,30000);assert.equal(JSON.parse(row.sale_details_json).monthlyIncome,null);
    const csv=await buildD1SheetCsv(env);assert.match(csv,/매매상세/);assert.match(csv,/123\.4/);assert.match(csv,/monthlyIncome/);
    const delta=await handleD1GetAction(env,user,{action:"listingChanges",ids:"M-sql-sale"});
    assert.equal(JSON.parse(delta.items[0].sale_details_json).grossAreaM2,456.7);
    const detail=await handleD1GetAction(env,user,{action:"unifiedListingDetail",propertyId:"M-sql-sale"});
    assert.equal(detail.originals[0].saleDetails.totalDeposit,0);assert.equal(detail.originals[0].saleDetails.monthlyIncome,null);
    // An identical location can have both lease and sale without cross-market duplicate blocking.
    const leaseValues=values.slice();leaseValues[15]="M-sql-lease";leaseValues[3]="상가";
    assert.equal((await handleD1PostAction(env,user,{action:"quickAdd",values:leaseValues,tradeType:"lease"})).persisted,true);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM listings").get().n,2);
    const landValues=values.slice();landValues[15]="M-sql-land";
    assert.equal((await handleD1PostAction(env,user,{action:"quickAdd",values:landValues,tradeType:"sale",saleCategory:"land",salePrice:30000,saleDetails})).persisted,true);
    const otherArea=values.slice();otherArea[15]="M-sql-other-area";
    assert.equal((await handleD1PostAction(env,user,{action:"quickAdd",values:otherArea,tradeType:"sale",saleCategory:"building",salePrice:30000,saleDetails:{...saleDetails,landAreaM2:200}})).persisted,true);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM listings").get().n,4);
  } finally {sqlite.close();}
});

test("old provider row with empty direct details still supplies its matching source summary", () => {
  const map=readFileSync(new URL("../js/map.js",import.meta.url),"utf8");
  const context=vm.createContext({document:{getElementById(){return null;},querySelector(){return null;},documentElement:{setAttribute(){}}},dispatchEvent(){},CustomEvent:function(){}});context.window=context;
  vm.runInContext(map.slice(map.indexOf("function parseDirectSaleDetailsV1("),map.indexOf("/* 목록에 적용한 것과 같은")),context);
  vm.runInContext(readFileSync(new URL("../js/listing-trade-ui-v1.js",import.meta.url),"utf8"),context);
  const sourceDetails={scope:"whole_building",totalDeposit:10000,monthlyIncome:200,landAreaM2:70};
  const item={tradeType:"sale",saleCategory:"building",salePrice:50000,source:"네이버",saleDetails:context.parseDirectSaleDetailsV1("{}"),
    unifiedOriginalsV8:[{tradeType:"sale",saleCategory:"building",salePrice:50000,source:"네이버",saleSummary:sourceDetails}]};
  assert.equal(context.JSListingTradeV1.saleSummary(item),sourceDetails);
  assert.equal(context.JSListingTradeV1.saleYield(item),6);
});
