// Read-only census of exact-source sale financial display. Private input stays outside Git.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {withSaleFinancialDisplay} from '../cloudflare/src/sale-financial-display.js';
const option=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const folder=option('private-dir');
if(!folder||!path.isAbsolute(folder))throw Error('An absolute private-dir outside the repository is required');
const root=path.resolve(import.meta.dirname,'..');
if(!path.relative(root,path.resolve(folder)).startsWith('..'))throw Error('Private audit must be outside the repository');
fs.mkdirSync(folder,{recursive:true});
const input=path.join(folder,'originals.json');
const fields=['totalDeposit','monthlyIncome','monthlyNetIncome','statedMonthlyIncome'];
const values=o=>Object.fromEntries(fields.map(k=>[k,o.saleDetails?.[k]??null]));
let rows;
if(process.argv.includes('--fetch')){
 if(fs.existsSync(input))throw Error('Use a new private audit directory to preserve the original census');
 const cli=option('wrangler');const cwd=option('cli-cwd');const config=option('config');if(!cli||!cwd||!config)throw Error('Explicit installed CLI, config and working directory required');
 rows=[];let cursor=0;
 for(;;){
  const sql=`SELECT s.rowid AS cursor,s.id,s.listing_id,s.source,s.sale_price,s.sale_category,
    json_extract(s.list_snapshot_json,'$.saleDetails') AS detail,
    CASE WHEN s.source='당근' THEN substr(json_extract(s.raw_json,'$.content'),1,12000)
      WHEN s.source='네이버' THEN substr(${['description','saleRaw.detailInfo.description','saleRaw.detailInfo.articleDescription','saleRaw.detailInfo.articleFeatureDescription','saleRaw.detailInfo.articleDetailInfo.description','saleRaw.detailInfo.articleDetailInfo.articleDescription','saleRaw.detailInfo.articleDetailInfo.articleDesc','saleRaw.articleDetailInfo.articleDescription'].map(p=>`COALESCE(json_extract(s.raw_json,'$.${p}'),'')`).join('||char(10)||')},1,24000) END AS raw_description,
    CASE WHEN s.source='네이버' THEN COALESCE(json_extract(s.raw_json,'$.saleRaw.detailInfo.priceInfo'),json_extract(s.raw_json,'$.saleRaw.priceInfo')) END AS price_info
    FROM listing_sources s JOIN listings l ON l.id=s.listing_id
    WHERE s.rowid>${cursor} AND s.active=1 AND s.trade_type='sale' AND s.sale_category<>'land' AND l.status<>'deleted'
    ORDER BY s.rowid LIMIT 1000;`;
  const r=spawnSync(process.execPath,[cli,'d1','execute','js-map-primary','--remote','--config',config,'--json','--command',sql],{cwd,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
  if(r.status!==0)throw Error(r.stderr||'Read-only query failed');
  const page=JSON.parse(r.stdout)[0].results;
  if(!page.length)break;
  for(const x of page){
   const original={originalId:x.id,propertyId:x.listing_id,source:x.source,tradeType:'sale',saleCategory:x.sale_category,salePrice:x.sale_price,saleDetails:JSON.parse(x.detail||'{}')};
   const provider={source:x.source,daangn:{description:x.raw_description||''},naverDescription:x.source==='네이버'?x.raw_description||'':'',naverPriceInfo:JSON.parse(x.price_info||'null')};
   rows.push({original,provider,before:values(withSaleFinancialDisplay(original,provider))});
  }
  cursor=page.at(-1).cursor;console.log(JSON.stringify({read:rows.length}));
 }
 fs.writeFileSync(input,JSON.stringify({checkedAt:new Date().toISOString(),rows}));
}else{rows=JSON.parse(fs.readFileSync(input,'utf8')).rows;}
const report={checkedAt:new Date().toISOString(),total:rows.length,bySource:{},additional:{totalDeposit:0,monthlyIncome:0},changed:{totalDeposit:0,monthlyIncome:0},manualPreserved:0};
const phrases=new Map();const changes=[];
for(const row of rows){
 const {original,provider,before}=row;const shown=withSaleFinancialDisplay(original,provider);const after=values(shown);
 const stats=report.bySource[original.source]??={originals:0,missingDeposit:0,missingIncome:0,additionalDeposit:0,additionalIncome:0};stats.originals++;
 if(after.totalDeposit==null)stats.missingDeposit++;if(after.monthlyIncome==null)stats.missingIncome++;
 for(const field of ['totalDeposit','monthlyIncome']){
  if(before[field]!==after[field]){report.changed[field]++;changes.push({originalId:original.originalId,source:original.source,field,before:before[field],after:after[field],evidence:shown.saleDetails?.descriptionEvidence});}
  if(before[field]==null&&after[field]!=null){report.additional[field]++;stats[field==='totalDeposit'?'additionalDeposit':'additionalIncome']++;}
 }
 for(const field of original.saleDetails?.manualSaleFieldsV1||[])if(fields.includes(field)&&Object.hasOwn(original.saleDetails,field)){
  if(after[field]!==original.saleDetails[field])throw Error('Manual field changed');report.manualPreserved++;
 }
 const text=original.saleDetails?.descriptionText||provider.daangn?.description||'';
 if(after.totalDeposit==null||after.monthlyIncome==null)for(const m of text.matchAll(/.{0,8}(?:보증|월세|월임대|임대수입|월수익).{0,26}/g)){
  const snippet=m[0].replace(/\d[\d,.-]*/g,'#');phrases.set(snippet,(phrases.get(snippet)||0)+1);
 }
}
fs.writeFileSync(path.join(folder,'changes.json'),JSON.stringify(changes,null,2));
fs.writeFileSync(path.join(folder,'unresolved-patterns.json'),JSON.stringify([...phrases].sort((a,b)=>b[1]-a[1]),null,2));
report.additionalOriginals=new Set(changes.filter(x=>x.before==null&&x.after!=null).map(x=>x.originalId)).size;
fs.writeFileSync(path.join(folder,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
