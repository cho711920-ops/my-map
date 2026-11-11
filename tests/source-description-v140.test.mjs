import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync('js/unified-listings-v8.js','utf8');
const ast=ts.createSourceFile('source.js',source,ts.ScriptTarget.Latest,true);
const names=new Set(['text','esc','rawDescriptionHtmlV140','saleOccupancyMemoHtmlV180','cleanSourceDescriptionV140','sourceDescriptionHtmlV140','operatingMemoHtmlV140','editableMemoTextV144','memoEditorRawHtmlV144']);
const functions=[];
function visit(node){if(ts.isFunctionDeclaration(node)&&names.has(node.name?.text))functions.push(node.getText(ast));else ts.forEachChild(node,visit);}
visit(ast);assert.equal(functions.length,names.size);
const ctx=vm.createContext({});vm.runInContext(functions.join('\n'),ctx);
const clean=value=>ctx.cleanSourceDescriptionV140(value);
const screenshot=readFileSync('tests/fixtures/source-description-v140.txt','utf8');

test('reported screenshot removes broker self-promotion while retaining every property fact',()=>{
 const result=clean(screenshot);assert.equal(result.changed,true);assert.doesNotMatch(result.text,/\uFE0F/);
 for(const value of ['주차가능','무권리','코너 상가','광고,활용성좋음','5000','315','159.89','48.4','광고효과 좋음','트램역세권','도안대로변','내부 규약 준수','방 없음','단독사용 남·여 각 1'])assert.ok(result.text.includes(value),value);
 for(const value of ['전화상담','13년','책임중개','책임 중개','책임보험','상담문의','채팅보다','공인중개사','고객님의','허위광고'])assert.ok(!result.text.includes(value),value);
});

for(const value of [
 '광고 효과 좋은 코너 상가 / 주차 3대 / 월세 100만원',
 '입주 즉시 가능. 권리금 협의, 배기시설 양도 가능.',
 '중개사무소로 사용 중인 1층 20평 사무실',
 '책임보험 미가입 확인 필요. 임대인 통화 후 재확인.',
 '계약 전 공인중개사에게 용도변경 가능 여부 확인',
 '관리실 010-1234-5678 책임보험 가입 여부 문의',
 '월세 220만원, 보증금 24,000만원, 실투자 58,000만원',
 '지하1층. 전기 15kw, 전면 8m. 대로변 노출 좋음.',
 '토지 200평. 지분 매매가 2억원. 도로접면 미확인.',
 '공인중개사무소 입점 불가 / 동종업종 제한',
 '전용면적 159.89m² / 공용화장실 / 주차 불가',
 '중개업소 홍보인지 판단하기 애매한 설명',
 '임차인은 2억원 책임보험 가입 필수',
 '영업배상 책임보험 2억원 가입 조건',
 '공인중개사무소 입점 가능',
 '공인중개사무소 사용 가능',
 '임대인 요청: 세입자 책임보험 가입 의무'
])test('preserves factual, qualified or ambiguous text: '+value,()=>{
 const result=clean(value);assert.equal(result.changed,false);assert.equal(result.text,value);
});

test('does not truncate facts following a promotional section or insurance claim',()=>{
 const raw='공인중개사무소 소개\n한국공인중개사협회 2억 원 책임보험 가입\n보증금 5000만원 월세 315만원\n주차 2대 / 즉시입주';
 const result=clean(raw);assert.ok(!result.text.includes('보험'));assert.match(result.text,/5000만원 월세 315만원/);assert.match(result.text,/주차 2대 \/ 즉시입주/);
});
test('removes only a known phrase when property terms share its clause',()=>{
 const result=clean('보증금 5000만원 월세 315만원 성실·책임 중개');assert.match(result.text,/5000만원 월세 315만원/);assert.ok(!result.text.includes('책임'));
});
test('dated manual additions survive even when they quote promotional terms',()=>{
 const suffix='\n[26.11.08] 책임중개 문구 확인. 내 메모는 그대로\n[26.11.09] 사진과 보험 가입 문구를 임대인에게 문의';
 const result=clean('성실·책임 중개 ✅ 보증금 2000만원'+suffix);assert.ok(result.text.endsWith(suffix));
});
test('only source-generated operating memos are projected, never unmarked user notes',()=>{
 const memo='\n  내가 쓴 문구: 성실·책임 중개\n공인중개사무소 소개  \n\n';
 assert.equal(ctx.operatingMemoHtmlV140({source:'네이버',memo}),memo);
 const raw='(임장가자) 월세 100만원 ✅ 성실·책임 중개';
 const item=Object.freeze({source:'네이버',memo:raw,propertyId:'A'}),before=JSON.stringify(item);
 assert.match(ctx.operatingMemoHtmlV140(item),/source-description-clean-v140/);assert.equal(JSON.stringify(item),before);
});
test('manual fallback, unknown sources and clean descriptions do not gain a raw toggle',()=>{
 for(const item of [{source:'직접등록'},{source:'네이버',masterFallback:true},{source:'네이버'}]){
  const raw=item.masterFallback||item.source==='직접등록'?'성실·책임 중개':'월세 100만원';
  assert.equal(ctx.sourceDescriptionHtmlV140(raw,item),raw);
 }
});
test('the original remains available and escaped, without executable ad HTML',()=>{
 const raw='월세 80만원 ✅ 성실·책임 중개 ✅ <img src=x onerror=alert(1)>';
 const html=ctx.sourceDescriptionHtmlV140(raw,{source:'당근'});
 assert.match(html,/<details[^>]*><summary>수집 원문 보기<\/summary>/);assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);assert.match(html,/성실·책임 중개/);
});
test('promotion-only description does not manufacture any property condition',()=>{
 const html=ctx.sourceDescriptionHtmlV140('성실·책임 중개 ✅ 공인중개사무소 소개',{source:'공실박스'});
 assert.match(html,/매물 설명은 원문에서 확인/);assert.ok(!html.includes('월세'));
});
test('all three collectors and trade types use the same display rule without rewriting input',()=>{
 for(const source of ['네이버','당근','공실박스'])for(const tradeType of ['lease','sale']){
  const original=Object.freeze({source,tradeType,memo:screenshot,salePrice:82000,rent:315});
  const before=JSON.stringify(original),html=ctx.sourceDescriptionHtmlV140(original.memo,original);
  assert.match(html,/source-description-clean-v140/);assert.equal(JSON.stringify(original),before);
 }
});
test('bounded fallback leaves unusually large raw input unchanged',()=>{
 const raw='성실·책임 중개'.repeat(10000);assert.equal(clean(raw).text,raw);assert.equal(clean(raw).changed,false);
});

const reportedV144=JSON.parse(readFileSync('tests/fixtures/source-description-v144.json','utf8')).raw;
test('Yongmun261-10 keeps property facts and dated private notes, omitting brokerage and availability boilerplate',()=>{
 const result=clean(reportedV144);assert.equal(result.changed,true);
 for(const term of ['내부규정에의함','휴게음식점으로 성업중 권리금 유선','후드 및 주방 시설','아파트단지 앞 카페, 배달 추천상가','권리금 : 350만 원','면적 : 약 12 평','주차장 : 불가','부가세 : 없음','주차 대수는 건물 전체 기준','[26.11.09] 사용자 작성 메모'])assert.ok(result.text.includes(term),term);
 for(const term of ['공인중개사','권리와 의무','조건 조율','협의 지원','상담 진행','공제·보험','단순한 매물 안내','본 매물은 광고 게시','광고 게시 이후','유태현'])assert.ok(!result.text.includes(term),term);
 const item={source:'네이버',memo:reportedV144};assert.equal(ctx.editableMemoTextV144(item),result.text);
 assert.match(ctx.memoEditorRawHtmlV144(item),/수집 원문 보기/);assert.match(ctx.memoEditorRawHtmlV144(item),/공제·보험/);
 assert.equal(item.memo,reportedV144);
});
test('editor projection keeps unmarked private text and drafts untouched',()=>{
 const item={source:'네이버',memo:'내 메모: 공인중개사 홍보 문구 확인 필요'};
 assert.equal(ctx.editableMemoTextV144(item),item.memo);assert.equal(ctx.memoEditorRawHtmlV144(item),'');
});

for(const value of ['임대인과 임차인 사이 월세 300만원 조건 조율','임차인 손해배상책임 보장 관련 공제·보험 가입 의무','매매가 2억원, 손해배상책임 보장 관련 공제·보험 가입'])test('known promotional words never erase concrete or tenant obligations: '+value,()=>{assert.equal(clean(value).text,value);});

const reportsV146=JSON.parse(readFileSync('tests/fixtures/source-description-v146.json','utf8'));
for(const sample of reportsV146)test('v146 removes broker-only boilerplate without erasing property facts: '+sample.key,()=>{
 const raw=sample.raw,result=clean(raw);assert.equal(result.changed,true);
 for(const value of sample.keep)assert.ok(result.text.includes(value),sample.key+' keep: '+value);
 for(const value of sample.remove)assert.ok(!result.text.includes(value),sample.key+' remove: '+value);
 assert.equal(clean(result.text).text,result.text,'the projection is stable');
 const item=Object.freeze({source:'네이버',memo:raw,propertyId:'FIXTURE-A'});
 assert.equal(ctx.editableMemoTextV144(item),result.text);assert.equal(item.memo,raw);
 const html=ctx.operatingMemoHtmlV140(item);assert.ok(html.includes(ctx.rawDescriptionHtmlV140(raw)), 'raw remains separately available');
});
for(const value of ['공인중개사무소 맞은편 2층 매물','공인중개사무소로 임대 가능','공인중개사무소 사용 가능','임차인은 손해배상보험 2억원 가입 의무','관리실 전화 문의가 필요합니다','현재 운영 중인 매장으로 조건 협의 가능','매물 등록번호 : 12345, 월세 80만원'])test('v146 retains location, actual use, insurance obligations and property identifiers: '+value,()=>{assert.equal(clean(value).text,value);});
test('v146 broker cleanup preserves the dated private suffix byte for byte and never filters an unmarked note',()=>{
 const note='\n[26.11.09] 임대인 통화. 보험 2억원 가입 문구와 대표 전화 확인 필요\n직접 적은 메모: 언제든지 연락주세요라는 원문 문구 확인';
 const raw=reportsV146[0].raw+note;assert.ok(clean(raw).text.endsWith(note));
 const item={source:'네이버',memo:note.trim()};assert.equal(ctx.editableMemoTextV144(item),item.memo);
});

for(const value of ['수익률18','수익률13','대지면적 77','연면적 200','방수 3','욕실수 2'])test('v146 unitless numeric property fields survive a mixed office paragraph: '+value,()=>{
 const raw='(임장가자) '+value+' 검수공인중개사사무소',result=clean(raw);assert.ok(result.text.includes(value));
});

test('v146 never discards a real price bundled with office insurance in one ambiguous clause',()=>{const raw='보증금 1000만원 검수공인중개사사무소 책임보험 가입';assert.ok(clean(raw).text.includes('보증금 1000만원'));});

test('v146 a marked explicit private note keeps even an office label at its end',()=>{const raw='(임장가자) 메모: 현장 방문 중 간판 확인 · 검수공인중개사 사무소';assert.equal(clean(raw).text,raw);});

test('v180 building memo highlights occupancy spans without changing the text or editor',()=>{
 const raw='매매 8억원\n층별 임대현황\n지하1층 원룸1(공실)\n1층 상가 보증금 1,000만원 / 월80만원\n201호 임대중\n총14가구(원룸7, 투룸6, 주인세대)\n주차 4대';
 const item=Object.freeze({tradeType:'sale',saleCategory:'building',source:'직접등록',memo:raw});
 const html=ctx.operatingMemoHtmlV140(item);
 for(const content of ['층별 임대현황','지하1층 원룸1(공실)','1층 상가 보증금 1,000만원 / 월80만원','201호 임대중']) assert.ok(html.includes('>'+content+'</mark>'),content);
 assert.equal(html.replace(/<[^>]*>/g,''),raw);
 assert.ok(!html.includes('>매매 8억원</mark>'));assert.ok(!html.includes('>주차 4대</mark>'));
 assert.equal(ctx.editableMemoTextV144(item),raw);assert.equal(item.memo,raw);
});
test('v180 occupancy marks do not spill into building-wide price or parcel fields',()=>{
 const item={tradeType:'sale',saleCategory:'building'};
 const html=ctx.saleOccupancyMemoHtmlV180('메모: 1층 상가 2~3층 원룸4 대지면적: 100평',item);
 assert.ok(html.includes('>1층 상가 2~3층 원룸4</mark> 대지면적: 100평'));
 assert.equal(ctx.saleOccupancyMemoHtmlV180('총5층 건물, 매매8억, 대지100평',item),'총5층 건물, 매매8억, 대지100평');
 assert.equal(ctx.saleOccupancyMemoHtmlV180('역세권 주인세대 입주가능 문의) 관리가 잘 된 다가구',item),'역세권 <mark class="sale-occupancy-highlight-v180">주인세대 입주가능</mark> 문의) 관리가 잘 된 다가구');
 const compact=ctx.saleOccupancyMemoHtmlV180('건물 내역: 분리형 원룸1개 / 투룸4개 / 주인세대1개',item);
 for(const unit of ['분리형 원룸1개','투룸4개','주인세대1개'])assert.ok(compact.includes('>'+unit+'</mark>'),unit);
});
test('v180 lease, land and untyped notes retain their existing presentation',()=>{
 const raw='1층 상가\n201호 임대중\n층별현황';
 for(const item of [{tradeType:'lease'},{tradeType:'sale',saleCategory:'land'},{}]) assert.equal(ctx.saleOccupancyMemoHtmlV180(raw,item),raw);
});
test('v180 both occupancy text and collected original remain escaped and immutable',()=>{
 const raw='(임장가자) 1층 상가 <img src=x onerror=alert(1)>\n성실·책임 중개';
 const item=Object.freeze({tradeType:'sale',saleCategory:'building',source:'네이버',memo:raw}),html=ctx.operatingMemoHtmlV140(item);
 assert.match(html,/sale-occupancy-highlight-v180/);assert.doesNotMatch(html,/<img/);
 assert.ok(html.includes(ctx.rawDescriptionHtmlV140(raw)));assert.equal(item.memo,raw);
});
