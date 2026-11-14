import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {extractManualMemoContacts} from '../cloudflare/src/d1-api.js';
const source=readFileSync(new URL('../js/script.js',import.meta.url),'utf8');
function context(){
  const state={epoch:'E1',revision:'R1'},window={JSAuthenticatedAccountEmail:'one@example.invalid',JSQueryListingsV152:{
    contactEpochV171:()=>state.epoch,contactRevisionV224:()=>state.revision,metadata:()=>{throw Error('Contact rendering must not enumerate masters');}}};
  const c=vm.createContext({window,document:{querySelectorAll:()=>[]},escapeHtml:v=>String(v),buildCardActionIconV662:()=>''});
  vm.runInContext(source.slice(source.indexOf('var LIST_CONTACT_ROLE_META_V650'),source.indexOf('function normalizeLinkedGongsilContactsV8')),c);
  vm.runInContext(source.slice(source.indexOf('var listContactPresenceV224'),source.indexOf('function applyLinkedContactResultV8')),c);
  return {c,state,window};
}
test('memo role labels match persisted extraction, including dated short labels and honorifics',()=>{
  const {c}=context();const memo='[26.11.13]임01011112222\n사장님 01022223333 / 사모 01033334444\n관리실 전화 0421234567\n현재 세입자 번호 01044445555\n문의 01099998888';
  const contacts=JSON.parse(JSON.stringify(c.extractMemoRoleContactsV224(memo))).map(x=>({role:x.role,phone:x.phone.display}));
  assert.deepEqual(contacts,extractManualMemoContacts(memo));
  assert.deepEqual(contacts.map(x=>x.role),['임','남','여','관','세']);
  const values=c.memoContactEditorValuesV224({},memo);
  assert.equal(values.landlordPhone,'010-1111-2222');assert.equal(values.tenantPhone,'010-4444-5555');
  const onlyRoles=c.memoContactEditorValuesV224({},'사장 01022223333 / 사모 01033334444 / 관리 0421234567');
  assert.equal(onlyRoles.landlordPhone,'');assert.equal(onlyRoles.tenantPhone,'');
  assert.equal(onlyRoles.contacts.length,3,'Preserve roles instead of guessing ownership');
  assert.equal(c.memoContactEditorValuesV224({},'임01011112222 / 사모01011112222').landlordPhone,'010-1111-2222','A richer display role must not erase an explicit landlord label');
});
test('contact presence survives unrelated global refresh but never crosses an account, master or parent/source proof',()=>{
  const {c,state,window}=context(),proof='sha256-v1:'+'a'.repeat(64);
  const row={propertyId:'P1',sourceSnapshotKey:proof,source:'네이버',address:'동일 지번',queryRowV152:true};
  const full={...row,queryRowV152:false,memo:'임01011112222',landlordPhone:'',tenantPhone:''};
  assert.equal(c.listContactAvailableV224(full),true);
  for(let i=0;i<8;i++)assert.equal(c.listContactAvailableV224({...row}),true);
  assert.equal(c.listContactAvailableV224({...row,propertyId:'P2'}),false);
  assert.equal(c.listContactAvailableV224({...row,sourceSnapshotKey:'sha256-v1:'+'b'.repeat(64)}),false);
  state.revision='R2';assert.equal(c.listContactAvailableV224(row),true);
  state.revision='R1';state.epoch='E2';assert.equal(c.listContactAvailableV224(row),true);
  state.epoch='E1';window.JSAuthenticatedAccountEmail='two@example.invalid';assert.equal(c.listContactAvailableV224(row),false);
  window.JSAuthenticatedAccountEmail='one@example.invalid';
  assert.equal(c.listContactAvailableV224({...full,memo:''}),false,'A confirmed removal replaces positive presence');
  assert.equal(c.listContactAvailableV224(row),false);
  window.JSBuildingRegistryV164={contactFor:()=>({display:'010-7777-8888'})};
  assert.equal(c.listContactAvailableV224({...full,memo:''}),true);
  window.JSBuildingRegistryV164={contactFor:()=>null};
  assert.equal(c.listContactAvailableV224(row),false,'Removing a common setting cannot leave its old green cached');
  assert.equal(c.listContactAvailableV224({...row,displayValuePresence:{contactsV224:true}}),true);
  assert.equal(c.listContactAvailableV224({...row,displayValuePresence:{contactsV224:false}}),false,'Current verified absence replaces a positive hint');
});

test('v226 same-line phone-then-role labels match server extraction without borrowing a following line',()=>{
  const {c}=context(),memo='01011112222 (임대인) / 01033334444 세입자\n01055556666\n임대인 01077778888\n01099990000 상담문의';
  const client=JSON.parse(JSON.stringify(c.extractMemoRoleContactsV224(memo))).map(x=>({role:x.role,phone:x.phone.display}));
  assert.deepEqual(client,extractManualMemoContacts(memo));
  assert.equal(c.memoContactEditorValuesV224({},memo).tenantPhone,'010-3333-4444');
  assert.equal(client.some(c=>c.phone==='010-5555-6666'),false);
  assert.equal(client.some(c=>c.phone==='010-9999-0000'),false);
});

test('v227 explicit compound ownership labels retain both roles without borrowing another line or number',()=>{
 const {c}=context(),memo='임대인(사모) 01011112222\n세입자(사장) 01033334444\n임대인\n관리 01055556666\n임대인 01077778888 / 사모 01099990000';
 const values=c.memoContactEditorValuesV224({},memo);
 assert.equal(values.landlordPhone,'010-1111-2222');assert.equal(values.tenantPhone,'010-3333-4444');
 const contacts=JSON.parse(JSON.stringify(values.contacts));assert.deepEqual(contacts.map(x=>({role:x.role,phone:x.phone.display})),extractManualMemoContacts(memo));
 assert.deepEqual(contacts.find(x=>x.phone.display==='010-5555-6666').roles,['관']);
 assert.deepEqual(contacts.find(x=>x.phone.display==='010-9999-0000').roles,['여']);
});

test('v227 only trusted structured Gongsilbox owner-side contacts fill blank editor fields',()=>{
 const {c}=context(),contacts=[{role:'부동산',phone:'01099990000'},{role:'사모',phone:'01022223333'},{role:'주인',phone:'01011112222'},{role:'세입자',phone:'01033334444'}];
 assert.equal(c.memoContactEditorValuesV224({gongsilContactsV8:contacts},'').landlordPhone,'');
 const values=c.memoContactEditorValuesV224({gongsilContactsLoadedV8:true,gongsilContactsV8:contacts},'');
 assert.equal(values.landlordPhone,'010-1111-2222');assert.equal(values.tenantPhone,'010-3333-4444');
 assert.equal(c.memoContactEditorValuesV224({gongsilContactsLoadedV8:true,gongsilContactsV8:[contacts[0]]},'').landlordPhone,'');
 assert.equal(c.memoContactEditorValuesV224({gongsilContactsLoadedV8:true,gongsilContactsV8:[contacts[1]]},'').landlordPhone,'010-2222-3333');
 assert.equal(c.memoContactEditorValuesV224({},'사모 01022223333').landlordPhone,'');
 assert.equal(c.memoContactEditorValuesV224({gongsilContactsLoadedV8:true,gongsilContactsV8:contacts},'임대인 01055556666').landlordPhone,'010-5555-6666');
});
