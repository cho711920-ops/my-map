import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

export async function privateCollector(source) {
  const url = new URL('../../cloudflare/src/collector-api.js', import.meta.url);
  const code = (source || fs.readFileSync(url, 'utf8')).replace(/\bfrom\s+(["'])(\.\/[^"']+)\1/g,
    (_, quote, relative) => `from ${quote}${new URL(relative, url).href}${quote}`);
  return import(`data:text/javascript;base64,${Buffer.from(code + '\nexport { ingestRecords, attachSource };').toString('base64')}`);
}

export function speedDatabase() {
  const db = new DatabaseSync(':memory:');
  const migrations = new URL('../../cloudflare/migrations/', import.meta.url);
  for (const file of fs.readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(new URL(file, migrations), 'utf8'));
  const calls = [], batches = [];
  let fail = () => false;
  const prepare = (sql, values = []) => {
    const positions = [], compiled = sql.replace(/\?(\d+)/g, (_, n) => { positions.push(Number(n) - 1); return '?'; });
    const args = () => positions.length ? positions.map(i => values[i]) : values;
    const execute = method => {
      if (fail(sql, values)) throw new Error('synthetic transaction failure');
      const statement = db.prepare(compiled);
      if (method === 'all') return {results: statement.all(...args())};
      if (method === 'first') return statement.get(...args()) || null;
      return {meta: {changes: Number(statement.run(...args()).changes)}};
    };
    return {sql, values, execute, bind: (...args) => prepare(sql, args),
      async all() { calls.push({kind:'all',sql}); return execute('all'); },
      async first() { calls.push({kind:'first',sql}); return execute('first'); },
      async run() { calls.push({kind:'run',sql}); return execute('run'); }};
  };
  const env = {DB:{prepare, async batch(statements) {
    calls.push({kind:'batch',size:statements.length}); batches.push(statements.map(s=>s.sql));
    db.exec('BEGIN');
    try { const results = statements.map(s=>s.execute('run')); db.exec('COMMIT'); return results; }
    catch(error) { db.exec('ROLLBACK'); throw error; }
  }}};
  return {db,env,calls,batches,reset() {calls.length=0;batches.length=0;},failWhen(fn){fail=fn;}};
}

export function speedAd(provider, market, id='one', revision=1, imageCount=2) {
  const images = Array.from({length:imageCount},(_,i)=>`https://images.example.test/${provider}-${market}-${id}-${revision}-${i}.jpg`);
  const address='서구 갈마동 361-14', listSnapshot=JSON.stringify({id,market,revision});
  if(provider==='공실박스') {
    const list={Bfidx:id,TypeView:'상가',Ho:'107',Me:market==='sale'?50000:0,Bo:2000,Mm:150+revision,Area:11,
      Photos:Array.from({length:imageCount},(_,i)=>`${id}-${revision}-${i}.jpg`)};
    return {externalId:id,tradeType:market,listSnapshot:JSON.stringify({...list,revision}),raw:{list},images,
      values:['검수상가',address,'107호','일반상가',2000,150+revision,0,0,11,'','','합성 검수']};
  }
  if(provider==='네이버') return {articleNo:id,tradeType:market,saleCategory:'commercial',salePrice:50000+revision,
    category:'상가점포',buildingName:'검수상가',jibunAddress:address,roomInfo:'1층',deposit:1000,
    monthly:100+revision,areaSquareMeter:66.1,managementFee:5,description:'합성 원본 검수',imageUrls:images,listSnapshot};
  return {originalId:id,tradeType:market,salesTypeV3:{type:'COMMERCIAL'},
    trades:[{type:'MONTH',deposit:1000,monthlyPay:100+revision},{type:'BUY',price:50000+revision,preferred:true}],
    publicJibunAddress:address,buildingName:'검수상가',floor:1,area:66.1,totalManageCost:5,
    content:'합성 원본 검수',images,listSnapshot};
}
