import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync('js/unified-listings-v8.js','utf8');
const ast=ts.createSourceFile('source.js',source,ts.ScriptTarget.Latest,true);
const names=new Set(['text','esc','rawDescriptionHtmlV140','cleanSourceDescriptionV140','sourceDescriptionHtmlV140','operatingMemoHtmlV140']);
const functions=[];
function visit(node){if(ts.isFunctionDeclaration(node)&&names.has(node.name?.text))functions.push(node.getText(ast));else ts.forEachChild(node,visit);}
visit(ast);assert.equal(functions.length,names.size);
const ctx=vm.createContext({});vm.runInContext(functions.join('\n'),ctx);
const clean=value=>ctx.cleanSourceDescriptionV140(value);

const cases=JSON.parse(readFileSync('tests/fixtures/source-description-v141.json','utf8'));
const keep={
 tanbang755:['주차가능','즉시입주','무권리','2,000만원','70만원','188.8㎡','57.11평'],
 dunsan1826:['문정초근처','둔산청솔A맞은편','바로입주가능','40평'],
 dunsan1209:['주차가능','둔산초등학교 근처','대전시청 인근','38평 사무실','보1천/70만원'],
 taepyeong337:['97p','상하차 용이','무권리','3000만원','210만원(부가세별도)','내부규정','약 97평(임대인 고지)','건물통임대','현 공실','1~3층 이용 가능','내부 화물 엘리베이터 있음','야적공간 많음'],
 songchon241:['앞마당 넓어','물건상하차 편리','홈통골어린이공원 인근','해당층 : 1층','약 70평','제1종근린생활시설','권리금 : 무','E/V : 없음','외부화장실','내부 규정','대전톨게이트 5분거리','주거지역','25.9mX8.5m','층고 2.6m 셔터 있음']
};
const remove={
 tanbang755:['맞춤형','최적화','성공 파트너','사후 관리','365일','24시간','상담 라인','ORO공인중개사','대표 담당자'],
 dunsan1826:['대성부동산','공인중개사','소장'],
 dunsan1209:['대성부동산','공인중개사','소장'],
 taepyeong337:['상업용 및 상가 전문','공인중개사','최대한 조율','직접 찾지','권리분석','계약부터 입점까지','최다 매물','중개 서비스','세부 특약','연락주세요','공제보험'],
 songchon241:['O이음O','이 음 부 동 산','전화주시면','친절상담','최대한 조율','매물 다량 보유']
};
for(const {key,raw} of cases)test('five reported real memos remove promotion and preserve every property fact: '+key,()=>{
 const result=clean(raw);assert.equal(result.changed,true);
 for(const word of keep[key])assert.ok(result.text.includes(word),'missing fact: '+word+'\n'+result.text);
 for(const word of remove[key])assert.ok(!result.text.includes(word),'remaining promotion: '+word+'\n'+result.text);
 assert.ok(result.text.startsWith('(임장가자)'));assert.equal(clean(result.text).changed,false,'idempotent');
});
for(const raw of [
 '공인중개사무소로 사용 중인 1층 20평 사무실 * 입점 가능',
 '임대인 확인: 365일 24시간 영업 가능. 소음 업종 불가.',
 '관리실 010-1234-5678 / 월세 100만원 / 임차인 책임보험 가입 필수',
 '보증금 3000만원 월세 210만원(부가세별도) / 렌트프리 2개월 협의 가능',
 '상가 전문 공인중개사에게 용도변경 가능 여부 확인 필요',
 '임대인 요청: 보증금, 월세, 권리금은 조율 불가',
 '건축물 용도: 부동산중개사무소, 임차인 공제보험 가입 의무',
 '내부 크기 25.9m*8.5m / 층고 2.6m / 야적공간 있음',
 '공인중개사무소 입점 불가 / 보증금 월세 조율 안됨',
 '부동산 중개법인 소유 매물, 공제보험 미가입 확인 필요',
 '상담 가능, 업종 제한 없음. 주차 편리'
])test('factual conditions and user caveats never become brokerage advertising: '+raw,()=>{
 assert.equal(clean(raw).text,raw);assert.equal(clean(raw).changed,false);
});
test('mixed same-line identity removes only office while preserving following labels',()=>{
 const raw='주차 2대 / 공인중개사무소 소개 ✅ 월차임: 210만원(부가세별도) ✅ 화물 엘리베이터 있음';
 const result=clean(raw);assert.match(result.text,/주차 2대/);assert.match(result.text,/210만원\(부가세별도\)/);assert.match(result.text,/화물 엘리베이터/);assert.doesNotMatch(result.text,/공인중개사/);
});
test('each raw memo stays expandable exactly and inputs/objects stay untouched',()=>{
 for(const {raw} of cases){const item=Object.freeze({source:'당근',memo:raw,propertyId:'A'});const html=ctx.operatingMemoHtmlV140(item);assert.ok(html.includes(ctx.rawDescriptionHtmlV140(raw)));assert.equal(item.memo,raw);}
});
test('manual dated suffix survives new marketing rules exactly',()=>{
 const suffix='\n[26.11.09] 공인중개사 연락 확인. 보증금 조율 안내 직접 작성';
 for(const {raw} of cases)assert.ok(clean(raw+suffix).text.endsWith(suffix));
});

test('flattened sentences isolate office promotion without discarding adjacent facts',()=>{
 const result=clean('주차 2대. 공인중개사무소 소개. 월세 80만원. 언제든 전화주시면 친절상담 해드립니다. 층고 2.6m 셔터 있음');
 for(const term of ['주차 2대','월세 80만원','층고 2.6m 셔터 있음'])assert.ok(result.text.includes(term));
 assert.doesNotMatch(result.text,/공인중개사|전화주시면/);
});

test('decorated broker tag requires an exact standalone office label, never a guessed building name',()=>{
 const cleaned=clean('O이음O 사진O 창고 70평 ✅ 이 음 부 동 산 ✅ 주차 2대');
 assert.doesNotMatch(cleaned.text,/O이음O|이 음 부 동 산/);assert.match(cleaned.text,/창고 70평/);assert.match(cleaned.text,/주차 2대/);
 const unmatched='O이음O 창고 70평 ✅ 다른부동산 ✅ 이음빌딩 인근';
 assert.match(clean(unmatched).text,/O이음O/);assert.match(clean(unmatched).text,/이음빌딩 인근/);
 const plain='O이음O 창고 70평 ✅ 해당층 : 1층';assert.equal(clean(plain).text,plain);
});

test('the word real estate is not itself proof of a brokerage promotion',()=>{
 for(const raw of ['OO부동산 바로 옆, 접근 편리','부동산 매각금액 문의','이음부동산 맞은편 1층 사무실','부동산 홍보인지 판단하기 애매한 설명'])assert.equal(clean(raw).text,raw);
});
