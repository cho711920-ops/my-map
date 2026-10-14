import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {canonicalListingRoom,listingFloor,normalizedRoomKey,parseBasementFloor,parseListingFloor,floorMatchesBounds} from "../cloudflare/src/floor.js";

const script=fs.readFileSync("js/script.js","utf8");
const floorStart=script.indexOf("function parseExplicitFloorLabelV1(");
const floorEnd=script.indexOf("function setupStableDetailFilterV62(",floorStart);
assert.ok(floorStart>=0 && floorEnd>floorStart);
const floorRuntime=script.slice(floorStart,floorEnd);
function frontend() {const context={};vm.createContext(context);vm.runInContext(floorRuntime,context);return context;}

test("explicit provider floors beat ambiguous B03 and legacy room inference on both boundaries",()=>{
  const ui=frontend();
  for(const [floor,room,expected] of [[-1,"B03",-1],[-1,"B03호",-1],[1,"302호",1],["1F","",1],["-2","B101",-2]]) {
    assert.equal(listingFloor({floor,room}),expected,JSON.stringify({floor,room}));
    assert.equal(ui.getItemFloorNumber({floor,room}),expected,JSON.stringify({floor,room}));
  }
  assert.equal(listingFloor({floor:101,room:""}),101,"scalar floor metadata is never reinterpreted as a unit");
  assert.equal(ui.getItemFloorNumber({floor:101,room:""}),101);
});

test("literal B03 units survive canonicalization and display beside their actual basement floor",()=>{
  const ui=frontend();
  for(const value of ["B03","B03호","B03호실"]) {
    assert.equal(canonicalListingRoom(value,-1),"지하1층 B03호");
    assert.equal(ui.formatListingRoomForCardV653(value,-1),"지하1층 B03호");
  }
  assert.equal(canonicalListingRoom("",1),"1층");
  assert.equal(ui.formatListingRoomForCardV653("","1F"),"1층");
  assert.equal(canonicalListingRoom("B03호"),"B03호");
  assert.equal(parseListingFloor("B03호",true),null);
  assert.equal(ui.parseFloorNotationV612("B03호",true),null);
  assert.equal(normalizedRoomKey("B03",-1),normalizedRoomKey("지하1층 B03호"));
});

test("composite floor-and-room strings prioritize the explicit floor and never drop the unit",()=>{
  const ui=frontend();
  for(const [value,expected,label] of [
    ["지하1층 B03호",-1,"지하1층 B03호"],
    ["지하1층B03호",-1,"지하1층 B03호"],
    ["1층 B03호",1,"1층 B03호"],
    ["1층 302호",1,"1층 302호"],
    ["-1층 B03호",-1,"지하1층 B03호"],
    ["지하1층 49,50호",-1,"지하1층 49,50호"]
  ]) {
    assert.equal(parseListingFloor(value,true),expected,value);
    assert.equal(ui.parseFloorNotationV612(value,true),expected,value);
    assert.equal(canonicalListingRoom(value),label,value);
    assert.equal(ui.formatListingRoomForCardV653(value),label,value);
  }
});

test("unambiguous legacy basement and current/total floor labels retain their behavior",()=>{
  const ui=frontend();
  for(const [value,expected] of [["B1",-1],["B01",-1],["B101",-1],["B101호",-1],["B201",-2],["지하1층",-1],["-1",-1],["1/4",1],["6/7",6]]) {
    assert.equal(parseListingFloor(value),expected,value);
    assert.equal(ui.parseFloorNotationV612(value,true),expected,value);
  }
  assert.equal(parseBasementFloor("B03"),-3,"explicit-floor input keeps its legacy alias");
  assert.equal(parseListingFloor("B03",false),-3);
  assert.equal(canonicalListingRoom("B01"),"지하1층");
  assert.equal(canonicalListingRoom("B101호"),"지하1층");
  assert.equal(ui.formatListingRoomForCardV653("6/7"),"6층");
});

test("unknown floor values pass bounds while known out-of-range values still fail",()=>{
  for(const unknown of [null,undefined,"",NaN,"미확인"]) {
    assert.equal(floorMatchesBounds(unknown,1,1),true,String(unknown));
    assert.equal(floorMatchesBounds(unknown,1,null),true,String(unknown));
    assert.equal(floorMatchesBounds(unknown,null,-1),true,String(unknown));
  }
  assert.equal(floorMatchesBounds(1,1,1),true);
  assert.equal(floorMatchesBounds(-1,1,1),false);
  assert.equal(floorMatchesBounds(2,1,1),false);
});

function filterHarness() {
  const elements=Object.fromEntries(["keyword","typeFilter","sourceFilter","floorQuickFilter","brokerageFeeFilter","sortFilter",
    "industryFilter","minDeposit","maxDeposit","minRent","maxRent","minPremium","maxPremium","minArea","maxArea","minFloor","maxFloor"]
    .map(id=>[id,{value:""}]));
  Object.assign(elements.keyword,{value:"괴정"});Object.assign(elements.typeFilter,{value:"상가"});
  Object.assign(elements.sourceFilter,{value:"naver"});Object.assign(elements.industryFilter,{value:"음식점"});
  for(const [id,value] of Object.entries({minDeposit:"1000",maxDeposit:"3000",minRent:"20",maxRent:"100",minPremium:"0",maxPremium:"100",minArea:"10",maxArea:"30",minFloor:"1",maxFloor:"1"})) elements[id].value=value;
  const context={console,Date,document:{getElementById:id=>elements[id] || null},
    map:{getBounds:()=>({contain:point=>!point.outside})},allItems:[],
    favoriteOnly:true,hideDone:true,doneOnly:false,gongsilOnly:true,newListingDays:1,
    matchesMultiKeyword:(item,keyword)=>item.name.includes(keyword),getListingTypeLabelV1:item=>item.type,
    getItemSourceType:item=>item.source,isFavorite:item=>item.favorite,isDone:item=>item.state==="계약완료",
    isGongsilBoxItem:item=>item.gongsil,
    window:{JSListingTradeV1:{getMode:()=>"lease",matchesItem:item=>item.tradeType==="lease"},
      JSUnifiedListingsV8:{matchesSource:(item,source)=>item.source===source},
      JSSaleWorkbenchV1:{filterValues:()=>({}),matches:item=>item.saleFields!==false},
      JSTodayListingsV1:{matches:item=>item.today,globalScope:()=>false}}
  };
  vm.createContext(context);
  vm.runInContext(floorRuntime,context);
  const start=script.indexOf("function readOptionalFilterNumberV1(");
  const end=script.indexOf("function getCoordinateDistanceMetersV658(",start);
  vm.runInContext(script.slice(start,end),context);
  const base={name:"괴정 상가",room:"",floor:null,type:"상가",source:"naver",memo:"음식점 추천",
    deposit:2000,rent:70,premium:0,area:20,tradeType:"lease",favorite:true,gongsil:true,today:true,
    latlng:{outside:false},state:"active"};
  const make=(key,extra={})=>({...base,key,propertyId:key,...extra});
  return {context,elements,make,ids:()=>Array.from(context.getFilteredItems(),item=>item.key)};
}

test("including unknown floors never bypasses keyword, source, money, area, favorites, done, Today or map conditions",()=>{
  const h=filterHarness();
  h.context.allItems=[h.make("known-first",{floor:1}),h.make("known-first-no-room",{floor:"1F"}),h.make("unknown"),
    h.make("known-basement-B03",{floor:-1,room:"B03"}),h.make("known-second",{floor:2}),
    h.make("bad-keyword",{name:"탄방 상가"}),h.make("bad-source",{source:"danggeun"}),
    h.make("bad-min-deposit",{deposit:500}),h.make("bad-max-deposit",{deposit:5000}),
    h.make("bad-min-rent",{rent:10}),h.make("bad-max-rent",{rent:150}),h.make("bad-premium",{premium:200}),
    h.make("bad-area",{area:50}),h.make("bad-type",{type:"토지"}),h.make("bad-industry",{memo:"사무실"}),
    h.make("bad-favorite",{favorite:false}),h.make("bad-done",{state:"계약완료"}),
    h.make("bad-gongsil",{gongsil:false}),h.make("bad-today",{today:false}),
    h.make("bad-map",{latlng:{outside:true}}),h.make("bad-sale-fields",{saleFields:false}),h.make("bad-market",{tradeType:"sale"})];
  assert.deepEqual(h.ids(),["known-first","known-first-no-room","unknown"]);
  assert.equal(h.context.allItems.find(item=>item.key==="known-basement-B03").room,"B03","filtering does not rewrite stored rooms");
});

test("quick-floor chips remain known-floor selections independent of inclusive range bounds",()=>{
  const h=filterHarness();
  h.context.allItems=[h.make("known-first",{floor:1}),h.make("unknown"),h.make("known-basement",{floor:-1})];
  h.elements.floorQuickFilter.value="first";
  assert.deepEqual(h.ids(),["known-first"]);
  h.elements.floorQuickFilter.value="unknown";
  assert.deepEqual(h.ids(),["unknown"]);
  h.elements.floorQuickFilter.value="basement";
  assert.deepEqual(h.ids(),[],"known basement still fails 1~1 bounds");
  h.elements.minFloor.value="";h.elements.maxFloor.value="";
  assert.deepEqual(h.ids(),["known-basement"]);
});
