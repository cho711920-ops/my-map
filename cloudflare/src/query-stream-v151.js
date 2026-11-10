// Parse the large originals snapshot one property at a time. In particular,
// do not hold the JSON text, expanded rows and all photo paths simultaneously.
const MAPS=new Set(['groups','sourceSearchIds','sourceSnapshotKeys','sourceSnapshotPropertyIds']);
export async function readQueryOriginalsV151(stream,{onGroup=rows=>rows,maxEntryBytes=4*1024*1024,maxBytes=128*1024*1024}={}) {
  const root=Object.create(null),seen=new Set(),decoder=new TextDecoder('utf-8',{fatal:true});
  const reader=stream.getReader();
  let buffer='',cursor=0,start=0,depth=0,quoted=false,escaped=false,mapName='',key='',consumed=false;
  let opened=false,closed=false,bytes=0,afterComma=false;
  function pair(raw,target) {
    if(raw.length>maxEntryBytes)throw new Error('Snapshot entry exceeds bound');
    if(!raw.trim()) {if(afterComma)throw new Error('Trailing JSON comma');return;}
    const parsed=JSON.parse('{'+raw+'}'),keys=Object.keys(parsed);
    if(keys.length!==1)throw new Error('Invalid snapshot entry');
    const name=keys[0];
    if(Object.hasOwn(target,name))throw new Error('Duplicate snapshot key');
    target[name]=mapName==='groups'?onGroup(parsed[name],name,root):parsed[name];
    afterComma=false;
  }
  function rootPair(raw) {
    if(raw.length>maxEntryBytes)throw new Error('Snapshot entry exceeds bound');
    if(!raw.trim()) {if(afterComma)throw new Error('Trailing JSON comma');return;}
    const parsed=JSON.parse('{'+raw+'}'),keys=Object.keys(parsed);
    if(keys.length!==1||seen.has(keys[0]))throw new Error('Invalid or duplicate root entry');
    seen.add(keys[0]);root[keys[0]]=parsed[keys[0]];afterComma=false;
  }
  function scan(chunk) {
    buffer+=chunk;
    for(;cursor<buffer.length;cursor++) {
      const char=buffer[cursor];
      if(closed) {if(!/\s/.test(char))throw new Error('Data after snapshot');continue;}
      if(quoted) {if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"'){quoted=true;continue;}
      if(!opened) {
        if(/\s/.test(char))continue;
        if(char!=='{')throw new Error('Snapshot must be an object');
        opened=true;depth=1;start=cursor+1;continue;
      }
      if(depth===1&&char===':')key=JSON.parse(buffer.slice(start,cursor).trim());
      if(char==='{'||char==='[') {
        if(depth===1&&char==='{'&&MAPS.has(key)) {
          if(seen.has(key))throw new Error('Duplicate snapshot map');
          seen.add(key);mapName=key;root[key]=Object.create(null);start=cursor+1;afterComma=false;
        }
        depth++;if(depth>128)throw new Error('Snapshot nesting exceeds bound');continue;
      }
      if(char==='}'||char===']') {
        if(depth===2&&mapName&&char==='}') {
          pair(buffer.slice(start,cursor),root[mapName]);mapName='';consumed=true;start=cursor+1;
        } else if(depth===1) {
          if(char!=='}')throw new Error('Invalid snapshot close');
          if(!consumed)rootPair(buffer.slice(start,cursor));
          closed=true;start=cursor+1;
        }
        depth--;if(depth<0)throw new Error('Invalid snapshot nesting');continue;
      }
      if(char===','&&(depth===1||depth===2&&mapName)) {
        if(mapName)pair(buffer.slice(start,cursor),root[mapName]);
        else if(!consumed)rootPair(buffer.slice(start,cursor));
        start=cursor+1;key='';consumed=false;afterComma=true;
      }
    }
    if(start){buffer=buffer.slice(start);cursor-=start;start=0;}
    if(buffer.length>maxEntryBytes)throw new Error('Snapshot entry exceeds bound');
  }
  try {
    for(;;) {
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;if(bytes>maxBytes)throw new Error('Snapshot exceeds bound');
      scan(decoder.decode(value,{stream:true}));
    }
    scan(decoder.decode());
    if(!opened||!closed||depth||quoted||mapName)throw new Error('Truncated snapshot');
    if(root.ok!==true||['groups','sourceSnapshotKeys','sourceSnapshotPropertyIds'].some(name=>
      !root[name]||typeof root[name]!=='object'||Array.isArray(root[name])))throw new Error('Incomplete snapshot identity');
    return root;
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export function queryOriginalReducerV151(firstThumbnail) {
  const strings=new Map();
  function intern(value) {
    if(typeof value!=='string')return value;
    if(strings.has(value))return strings.get(value);
    // Detach slices from the streaming input too, before retaining a value.
    const copy=JSON.parse(JSON.stringify(value));if(strings.size>=4096)strings.clear();strings.set(copy,copy);return copy;
  }
  return (rows,id,root)=>{
    if(!Array.isArray(rows))throw new Error('Invalid original group');
    const compact=/^compact-v\d+$/.test(root.format||'');
    if(compact&&(!Array.isArray(root.fields)||root.fields.some(field=>typeof field!=='string')||
      new Set(root.fields).size!==root.fields.length||root.fields.includes('propertyId')))throw new Error('Snapshot fields must precede groups and be unique');
    return rows.map(values=>{
      if(compact&&!Array.isArray(values)||!compact&&(!values||typeof values!=='object'||Array.isArray(values)))throw new Error('Invalid original row');
      if(!compact&&values.propertyId!==id)throw new Error('Original crossed its owning master');
      const original=compact?Object.fromEntries(root.fields.map((field,index)=>[field,values[index]])):{...values};
      original.propertyId=id;
      original.thumbnail=firstThumbnail(original);
      // Keep the shared object shape. Deleting a middle property turns each
      // of 60,000 rows into a large V8 dictionary even after paths are gone.
      original.photoPathsV119=undefined;original.images=undefined;
      for(const field of Object.keys(original))original[field]=intern(original[field]);
      return original;
    });
  };
}
