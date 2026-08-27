// Isolated visual fixture: production markup/styles, no login, API or real data.
// Run: node tools/preview-listing-header.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import vm from "node:vm";
import { daangnSaleFields, naverSaleFields } from "../cloudflare/src/sale-fields.js";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.HEADER_PREVIEW_PORT || 4174);
const types = { ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    response.setHeader("Cache-Control", "no-store");
    if (pathname === "/collection-diagnostics") {
      const ops = await readFile(resolve(root,"js/operations-collection-v8.js"),"utf8");
      const context = {number:v=>Number(v||0),escape:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')};
      vm.runInNewContext(ops.match(/^  function collectionDiagnosticsHtml\([^]*?^  }/m)[0],context);
      const html=context.collectionDiagnosticsHtml({failed:1,requiredFieldRejected:2,diagnostics:[{sourceId:'123',stage:'필수정보',message:'정확한 지번 주소 없음'},{sourceId:'456',stage:'필수정보',message:'거래조건 확인 필요'},{sourceId:'789',stage:'저장',message:'요청 시간 초과'}]});
      response.setHeader("Content-Type","text/html; charset=utf-8");
      response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>수집 완료 내역 검수</title><body style="font:15px Arial;padding:24px;max-width:460px"><h2>수집 완료 · 제외/실패 3건</h2>'+html+'</body>');return;
    }
    if (pathname === "/sale-cards") {
      const source = await readFile(resolve(root, "index.html"), "utf8");
      const head = source.match(/<template id="jsAuthenticatedHeadAssets">([\s\S]*?)<\/template>/)[1];
      const styles = [...head.matchAll(/<link[^>]+href="css\/[^>]+>/g)].map(match => match[0]).join("\n");
      const script = await readFile(resolve(root, "js/script.js"), "utf8");
      const functions = ["addListItem", "getRentPerPyeongValue", "getPyeongBadgeClass", "buildPyeongMiniBadge", "buildCardActionIconV662"]
        .map(name => script.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"))[0]).join("\n");
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>매매 카드 검수</title>${styles}<style>body{overflow:auto!important;background:#f1f5fa!important;padding:16px!important;height:auto!important}#list{display:flex!important;gap:18px;flex-wrap:wrap;position:static!important;width:auto!important;height:auto!important;max-height:none!important;padding:0!important;overflow:visible!important}.sample{max-width:100%;box-sizing:border-box}.sample h2{font-size:16px}.sample .item{margin:0 0 12px!important}.detail-example{width:360px;background:white;padding:16px;margin-top:18px}</style></head><body><main id="list"></main><section class="detail-example"></section><script src="js/listing-trade-ui-v1.js"></script><script>
      // Exercise the actual production card builder with only unrelated actions stubbed.
      const selectedPrintKeys=[],openMemoKey='',editingMemoKey='';
      function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
      function isCustomerMatchMapCardV721(){return false;} function actionSelectionKeyV660(i){return i.key;}
      function getCustomerMatchStatus(){return '';} function isLinkedListingSelectedV845(){return false;}
      function isDone(){return false;} function isFieldVisitItem(){return true;} function isConfirmedVisitItem(){return false;} function isGongsilBoxItem(){return false;}
      function formatListRegistrationDate(){return '';} function buildCustomerMatchInlineControls(){return '';}
      function buildListContactButtonV654(){return '<button class="item-contact-button-v654 action-placement">☎</button>';}
      function listDisplayValueV650(i,k){return i[k]??'-';} function formatListingRoomForCardV653(v){return v;}
      function buildListElevatorIconV843(){return '';} function observeUnifiedDuplicateShimmerV812(){}
      window.JSUnifiedListingsV8={cardParts:()=>({thumbnail:'<button type="button" class="unified-thumb-v8 no-photo"><span>사진 없음</span></button>',badge:'',sourceButton:''})};
      ${functions}
      const fixtures=[
        {name:'대원아르떼',address:'서구 월평동 893',type:'건물전체',room:'전체',salePrice:197000,saleCategory:'building',saleDetails:{scope:'whole_building',landAreaM2:204.96,grossAreaM2:409.59,totalDeposit:50000,monthlyIncome:695}},
        {name:'베스트',address:'유성구 어은동 111-4',type:'건물전체',room:'전체',salePrice:195000,saleCategory:'building',saleDetails:{scope:'whole_building',landAreaM2:225.45,grossAreaM2:410.91,totalDeposit:13300,monthlyIncome:1400}},
        {name:'토지',address:'유성구 구암동 123-3',type:'토지',salePrice:213000,saleCategory:'land',saleDetails:{scope:'land',landAreaM2:2817}},
        {name:'상가',address:'서구 둔산동 100',type:'상가',room:'101호',salePrice:45000,saleCategory:'commercial',saleDetails:{scope:'unit',exclusiveAreaM2:102.5}},
        {name:'기존 상가임대',address:'서구 탄방동 793',type:'일반상가',room:'1층',tradeType:'lease',deposit:1000,rent:40,fee:0,premium:0,area:10}
      ];
      for(const width of [600,450,360]){const section=document.createElement('section');section.className='sample';section.style.width=width+'px';section.innerHTML='<h2>카드 폭 '+width+'px</h2>';document.querySelector('main').append(section);fixtures.forEach((f,n)=>addListItem({key:width+'-'+n,propertyId:width+'-'+n,tradeType:'sale',source:'공실박스',memo:'',...f},section));}
      document.querySelector('.detail-example').innerHTML='<h2>상세 수익률 안내</h2>'+JSListingTradeV1.saleDetailsHtml({...fixtures[0],tradeType:'sale'});
      </script></body></html>`);
      return;
    }
    if (pathname === "/sale") {
      const descriptionText='대지면적: 183.1m²\n연면적: 299.88m²\n건물층수: 총3개층\n세대구성: 원룸18개 (총18세대)\n매매: 8억5천만원\n융자: 3억원\n보증금: 1억7천8백8십만원\n월수익(이자제외): 202만원\n실투자금: 3억7천1백2십만원\n연 수익률: 6.53%\n괴정동 수익형 다가구';
      const supplementFixtures=[
        {name:'당근 4084712 · 설명 정보 보완',salePrice:85000,saleDetails:daangnSaleFields({content:descriptionText,trades:[{type:'BUY',price:85000}],salesTypeV3:{type:'TWO_ROOM'}})},
        {name:'네이버 · 기본정보/설명 불일치 예시',salePrice:85000,saleDetails:naverSaleFields({category:'다가구',salePrice:85000,description:descriptionText,saleRaw:{priceInfo:{warrantyPrice:150000000,rentPrice:3000000}}})}
      ];
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>매매 상세 회귀검사</title><link rel="stylesheet" href="css/listing-trade-v1.css"><style>body{margin:16px;font-family:Arial,sans-serif;color:#243b53;background:#f2f5fa}main{display:flex;gap:16px;flex-wrap:wrap}article{width:360px;max-width:100%;box-sizing:border-box;padding:16px;background:white;border-radius:12px}h2{font-size:17px}.price{font-size:20px;color:#0b64cd;font-weight:bold}.empty{padding:25px;background:#e9edf2;text-align:center;color:#607080}</style></head><body><h1>매매 상세정보 검수용 예시</h1><main></main><script src="js/listing-trade-ui-v1.js"></script><script>
      const fixtures=[
        {name:'공실박스 건물통 · 월평동 893',salePrice:197000,saleDetails:{scope:'whole_building',landAreaM2:204.96,grossAreaM2:409.59,totalDeposit:50000,monthlyIncome:695}},
        {name:'공실박스 토지 · 구암동 123-3',salePrice:213000,saleDetails:{scope:'land',landAreaM2:2817,landUse:'창',zoning:'개발한구역',roadAccess:'세로한면(불)',buildingUse:'창고시설'}},
        {name:'네이버 다가구 · 도마동 20-2',salePrice:58000,saleDetails:{scope:'whole_building',landAreaM2:263.47,grossAreaM2:447.93,totalDeposit:3500,monthlyIncome:400,aboveGroundFloors:4}},
        {name:'당근 단독주택 · 괴정동',salePrice:35000,saleDetails:{scope:'whole_building',landAreaM2:93.04,grossAreaM2:103.94,roomCount:4,bathroomCount:2,approvalDate:'1990-06-25'}},
        ...${JSON.stringify(supplementFixtures).replaceAll('<','\\u003c')}
      ];
      document.querySelector('main').innerHTML=fixtures.map(f=>'<article><h2>'+f.name+'</h2><div class="empty">등록된 사진 없음</div><p class="price">매매 '+f.salePrice.toLocaleString('ko-KR')+'만원</p>'+JSListingTradeV1.saleDetailsHtml({...f,tradeType:'sale'})+'</article>').join('');
      </script></body></html>`);
      return;
    }
    if (pathname === "/") {
      const source = await readFile(resolve(root, "index.html"), "utf8");
      const head = source.match(/<template id="jsAuthenticatedHeadAssets">([\s\S]*?)<\/template>/)[1];
      const styles = [...head.matchAll(/<link[^>]+href="css\/[^>]+>/g)].map(match => match[0]).join("\n");
      const markup = source.match(/<template id="jsAuthenticatedApplication">([\s\S]*?)<\/template>/)[1]
        .replace('id="wrap" inert aria-hidden="true"', 'id="wrap"');
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Header layout fixture</title>${styles}</head><body>${markup}<script src="js/listing-trade-ui-v1.js"></script><script src="js/mobile-app-v1.js"></script></body></html>`);
      return;
    }
    const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep) || !/^(css\/|js\/(listing-trade-ui-v1|mobile-app-v1)\.js$)/.test(relative)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", `${types[extname(file)] || "application/octet-stream"}; charset=utf-8`);
    response.end(await readFile(file));
  } catch {
    response.writeHead(500).end("Preview unavailable");
  }
}).listen(port, "127.0.0.1", () => console.log(`Header fixture: http://127.0.0.1:${port}/`));
