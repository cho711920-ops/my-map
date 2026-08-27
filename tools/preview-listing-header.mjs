// Isolated visual fixture: production markup/styles, no login, API or real data.
// Run: node tools/preview-listing-header.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.HEADER_PREVIEW_PORT || 4174);
const types = { ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    response.setHeader("Cache-Control", "no-store");
    if (pathname === "/sale") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>매매 상세 회귀검사</title><link rel="stylesheet" href="css/listing-trade-v1.css"><style>body{margin:16px;font-family:Arial,sans-serif;color:#243b53;background:#f2f5fa}main{display:flex;gap:16px;flex-wrap:wrap}article{width:360px;max-width:100%;box-sizing:border-box;padding:16px;background:white;border-radius:12px}h2{font-size:17px}.price{font-size:20px;color:#0b64cd;font-weight:bold}.empty{padding:25px;background:#e9edf2;text-align:center;color:#607080}</style></head><body><h1>매매 상세정보 검수용 예시</h1><main></main><script src="js/listing-trade-ui-v1.js"></script><script>
      const fixtures=[
        {name:'공실박스 건물통 · 월평동 893',salePrice:197000,saleDetails:{scope:'whole_building',landAreaM2:204.96,grossAreaM2:409.59,totalDeposit:50000,monthlyIncome:695}},
        {name:'공실박스 토지 · 구암동 123-3',salePrice:213000,saleDetails:{scope:'land',landAreaM2:2817,landUse:'창',zoning:'개발한구역',roadAccess:'세로한면(불)',buildingUse:'창고시설'}},
        {name:'네이버 다가구 · 도마동 20-2',salePrice:58000,saleDetails:{scope:'whole_building',landAreaM2:263.47,grossAreaM2:447.93,totalDeposit:3500,monthlyIncome:400,aboveGroundFloors:4}},
        {name:'당근 단독주택 · 괴정동',salePrice:35000,saleDetails:{scope:'whole_building',landAreaM2:93.04,grossAreaM2:103.94,roomCount:4,bathroomCount:2,approvalDate:'1990-06-25'}}
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
