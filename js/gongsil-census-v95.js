/* Loaded only in the provider collector, never on the JS map's startup path. */
(function(global) {
  "use strict";
  if (global.JSGongsilCensusV95) return;
  var KEY = "js_gongsil_fixed_scopes_v95";
  function stable(value) {
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(function(k) {
      return JSON.stringify(k) + ":" + stable(value[k]);
    }).join(",") + "}";
    return JSON.stringify(value == null ? null : value);
  }
  function ids(groups) {
    if (!Array.isArray(groups) || groups.length > 5000) throw Error("지도 전체목록 형식 미확인");
    var values = [];
    groups.forEach(function(group) {
      if (!group || !Array.isArray(group.fidxs)) throw Error("지도 광고번호 미확인");
      group.fidxs.forEach(function(id) {
        id = String(id == null ? "" : id).trim();
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw Error("광고번호 형식 미확인");
        values.push(id);
      });
    });
    if (values.length > 5000) throw Error("지도 광고번호 확인 한도 초과");
    return Array.from(new Set(values)).sort();
  }
  function bounds(value) {
    return Array.isArray(value) && value.length === 4 && value.every(function(n) {return typeof n === "number" && Number.isFinite(n);}) &&
      value[0] >= -90 && value[2] <= 90 && value[1] >= -180 && value[3] <= 180 && value[0] < value[2] && value[1] < value[3];
  }
  function validScope(s) {
    return s && s.version === 1 && s.selectionKind === "full-map-result" && bounds(s.bounds) &&
      Number.isInteger(s.level) && s.level >= 1 && s.level <= 22 && /^[A-Za-z0-9_-]{1,40}$/.test(s.btype) && /^[a-f0-9]{64}$/.test(s.filtersHash);
  }
  function profileKey(scope) {return scope.btype + ":" + scope.filtersHash;}
  function profiles() {
    try {var data = JSON.parse(localStorage.getItem(KEY) || "[]");return Array.isArray(data) ? data.filter(validScope).slice(-30) : [];}
    catch (_) {return [];}
  }
  async function hash(value) {
    var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value)));
    return Array.from(new Uint8Array(digest), function(n) {return n.toString(16).padStart(2,"0");}).join("");
  }
  async function readMap(body, scope, fetchMap) {
    var controller = new AbortController();
    var timer = setTimeout(function() {controller.abort();},15000);
    try {
      var request = {btype:body.btype,level:scope.level,search:body.search,isZzim:false,aptCircle:Boolean(body.aptCircle),
        areacoord:{minlat:scope.bounds[0],minlng:scope.bounds[1],maxlat:scope.bounds[2],maxlng:scope.bounds[3]},
        removecoord:{minlat:0,minlng:0,maxlat:0,maxlng:0}};
      var response = await fetchMap("/api/maps/circle",{method:"POST",credentials:"same-origin",
        headers:{"content-type":"application/json"},body:JSON.stringify(request),signal:controller.signal,__jsGongsilCensusV95:true});
      if (!response.ok) throw Error("기준범위 조회 실패");
      var data = await response.json();
      if (data.res !== "success" || data.more === true || data.datas && data.datas.more === true || data.nextCursor || data.datas && data.datas.nextCursor) {
        throw Error("기준범위 전체응답 미확인");
      }
      return ids(data.datas && data.datas.res);
    } finally {clearTimeout(timer);}
  }
  async function prepare(selection, options) {
    options = options || {};
    var state = global.__JS_GONGSIL_SCOPE_CAPTURE_V1__;
    var map = state && state.capture;
    var body = map && map.body;
    try {
      if (!body || map.complete !== true || !body.search || !selection || !selection.body) {
        throw Error("수집창을 먼저 연 뒤 지도를 한 번 이동하고 전체 선택하면 광고번호 비교를 준비합니다");
      }
      if (body.isZzim || body.search.MyActive || body.search.listmemoB || body.search.listmemoF ||
          Array.isArray(body.search.sch_zzim) && body.search.sch_zzim.length) throw Error("개인찜·내광고 필터는 전체비교 제외");
      if (Number(body.level) !== Number(selection.body.level) || String(body.btype) !== String(selection.body.btype)) {
        throw Error("지도와 선택 목록의 유형·축척 불일치");
      }
      var all = ids(map.groups);
      var filter = Object.assign({}, body.search); delete filter.ordersch1;
      var coordinate = body.areacoord || {};
      var scope = {version:1,selectionKind:"full-map-result",bounds:[coordinate.minlat,coordinate.minlng,coordinate.maxlat,coordinate.maxlng],
        level:Number(body.level),btype:String(body.btype),filtersHash:await hash({search:filter,aptCircle:Boolean(body.aptCircle),
          market:options.market === "lease" || options.market === "sale" ? options.market : "mixed"})};
      if (!validScope(scope) || !Number.isFinite(map.capturedAt) || Date.now() - map.capturedAt > 3600000 || map.capturedAt > Date.now()+60000) {
        throw Error("지도 범위·확인시각 미확인");
      }
      if (global.__JS_GONGSIL_SCOPE_CAPTURE_V1__ !== state || state.capture !== map || options.stopped && options.stopped()) throw Error("범위 변경 또는 안전중단");
      var capturedAt = map.capturedAt;
      if (body.removecoord && Object.keys(body.removecoord).some(function(k) {return Number(body.removecoord[k]) !== 0;})) {
        if (state.version < 95) throw Error("지도 일부 응답: 다음 페이지 접속에서 전체 범위를 확인합니다");
        all = await readMap(body,scope,options.fetch);
        capturedAt = Date.now();
      }
      var selected = Array.isArray(selection.body.bfidxs) ? Array.from(new Set(selection.body.bfidxs.map(String))).sort() : null;
      if (!selected || stable(selected) !== stable(all) || !all.length && !selection.emptyMapConfirmed) {
        throw Error("현재 지도 전체선택 미확인: 선택한 매물만 저장합니다");
      }
      var saved = profiles().find(function(s) {return profileKey(s) === profileKey(scope);});
      if (saved && stable(saved) !== stable(scope)) {
        if (state.version < 95) throw Error("기준범위 재확인 모듈은 다음 페이지 접속부터 적용됩니다");
        all = await readMap(body,saved,options.fetch);
        scope = saved;
        capturedAt = Date.now();
      }
      // A real provider request/filter change while the background check runs cancels it.
      if (global.__JS_GONGSIL_SCOPE_CAPTURE_V1__ !== state || state.capture !== map || options.stopped && options.stopped()) throw Error("범위 변경 또는 안전중단");
      return {census:{version:95,scope:scope,ids:all,capturedAt:new Date(capturedAt).toISOString(),
        complete:true,selectionVerified:true,emptyConfirmed:all.length===0},issue:""};
    } catch (error) {return {census:null,issue:String(error && error.message || "전체 광고번호 확인 보류")};}
  }
  function commit(census, result) {
    if (!census || !validScope(census.scope) || !result || result.presenceTracking !== true || result.censusValidatedV95 !== true) return false;
    try {
      var existing = profiles().find(function(s) {return profileKey(s) === profileKey(census.scope);});
      if (existing && stable(existing) !== stable(census.scope)) return false;
      var data = profiles().filter(function(s) {return profileKey(s) !== profileKey(census.scope);});
      data.push(census.scope);localStorage.setItem(KEY,JSON.stringify(data.slice(-30)));return true;
    } catch (_) {return false;}
  }
  global.JSGongsilCensusV95 = {prepare:prepare,commit:commit};
})(window);
