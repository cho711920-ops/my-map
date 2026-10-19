const numericFields = ['landAreaM2','grossAreaM2','exclusiveAreaM2','buildingAreaM2','totalDeposit','monthlyIncome',
  'monthlyNetIncome','statedMonthlyIncome','loanAmount','investmentAmount','advertisedYield'];
const textFields = ['buildingUse','landUse','zoning','roadAccess','parcelShape'];
const landFields = ['landAreaM2','landUse','zoning','roadAccess','parcelShape'];
const own = (o,k) => Object.prototype.hasOwnProperty.call(o || {},k);
const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const parse = v => { try { return object(JSON.parse(v || '{}')); } catch { return {}; } };
const failure = (message,statusCode=400) => Object.assign(new Error(message),{statusCode,code:statusCode===409?'PROPERTY_EDIT_CONFLICT':'SALE_EDIT_INVALID'});
function normalize(key,value) {
  if (textFields.includes(key)) {
    if (value != null && typeof value !== 'string') throw failure('문자 항목을 확인해 주세요.');
    const s=String(value ?? '').trim();if(s.length>160)throw failure('입력은 160자 이내로 작성해 주세요.');return s;
  }
  if (value == null || value === '') return null;
  if (!['number','string'].includes(typeof value) || !/^\d+(?:\.\d+)?$/.test(String(value)) || !Number.isFinite(Number(value)) || Number(value)>Number.MAX_SAFE_INTEGER) throw failure('금액·면적은 0 이상의 숫자로 입력해 주세요.');
  return Number(value);
}
export function mergeManualSaleDetails(incoming,saved) {
  const source=object(incoming),master=object(saved);
  if (!Array.isArray(master.manualSaleFieldsV1)) return master;
  const keys=[...new Set(master.manualSaleFieldsV1)].filter(k=>numericFields.includes(k)||textFields.includes(k));
  return {...source,...Object.fromEntries(keys.map(k=>[k,master[k] ?? null])),manualSaleFieldsV1:keys};
}
// Only explicit, dirty fields are accepted. Raw advertisements and lease
// columns are never written. The enclosing updateProperty performs the CAS.
export function salePropertyEditPatch(before,input) {
  const edit=object(input),original=object(edit.original),patch=object(edit.patch);
  if (before.trade_type!=='sale' || String(edit.saleCategory ?? '')!==String(before.sale_category ?? '')) throw failure('거래유형·매매 구분이 변경되었습니다. 다시 열어 주세요.',409);
  const current=parse(before.sale_details_json),initial=object(original.saleDetails),next={...current};
  const allowed=before.sale_category==='land'?landFields:numericFields.concat('buildingUse');
  const manual=new Set(Array.isArray(current.manualSaleFieldsV1)?current.manualSaleFieldsV1:[]),changes=[];
  for(const key of Object.keys(patch)) {
    if(key!=='salePrice'&&!allowed.includes(key))throw failure('이 매물에서 수정할 수 없는 항목입니다.');
    if(!own(key==='salePrice'?original:initial,key))throw failure('최초 값을 다시 조회한 뒤 저장해 주세요.');
    const desired=normalize(key,patch[key]),old=normalize(key,key==='salePrice'?original.salePrice:initial[key]),now=normalize(key,key==='salePrice'?before.sale_price:current[key]);
    if(key==='salePrice'&&!(desired>0))throw failure('매매가는 0보다 커야 합니다.');
    if(/AreaM2$/.test(key)&&desired!=null&&!(desired>0))throw failure('면적은 0보다 커야 합니다. 미제공은 빈 칸으로 두세요.');
    if(now!==old&&now!==desired)throw failure('다른 작업에서 매매정보가 변경되었습니다. 입력을 유지한 채 최신 값과 비교해 주세요.',409);
    if(now===desired&&(key==='salePrice'||manual.has(key)))continue;
    if(key==='salePrice')changes.push({key:'salePrice',column:'sale_price',value:desired});
    else {next[key]=desired;manual.add(key);}
  }
  const keys=[...manual].filter(k=>numericFields.includes(k)||textFields.includes(k));
  if(JSON.stringify(next)!==JSON.stringify(current)||JSON.stringify(keys)!==JSON.stringify(current.manualSaleFieldsV1||[])) {
    next.manualSaleFieldsV1=keys;
    changes.push({key:'saleDetails',column:'sale_details_json',value:JSON.stringify(next)});
  }
  return {changes,value:{tradeType:'sale',saleCategory:before.sale_category,salePrice:changes.find(c=>c.key==='salePrice')?.value ?? before.sale_price,saleDetails:next}};
}
