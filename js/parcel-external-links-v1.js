/* Exact parcel links only. No coordinate/building-name fallback or listing writes. */
(function (global) {
  'use strict';
  var cache = new Map(), pending = new Map();
  var provinces = {서울:'서울특별시',부산:'부산광역시',대구:'대구광역시',인천:'인천광역시',광주:'광주광역시',대전:'대전광역시',울산:'울산광역시',세종:'세종특별자치시',경기:'경기도',강원:'강원특별자치도',강원도:'강원특별자치도',충북:'충청북도',충남:'충청남도',전북:'전북특별자치도',전라북도:'전북특별자치도',전남:'전라남도',경북:'경상북도',경남:'경상남도',제주:'제주특별자치도',제주도:'제주특별자치도'};
  function text(v) { return String(v == null ? '' : v).trim(); }
  function parseAddress(value) {
    var raw = text(value).replace(/[‐‑–−]/g, '-').replace(/\s+/g, ' ');
    if (!raw || raw.length > 160) return null;
    // A bare floor ("용두동 1층"), road name, multiple lots or hidden lot is not a parcel.
    var m = raw.match(/^(.*?)([가-힣0-9·.]+(?:동|리|가))\s*(산\s*)?(\d{1,4})(?:\s*-\s*(\d{1,4}))?(?:\s*번지)?$/);
    if (!m || !Number(m[4])) return null;
    var region = text(m[1]), town = m[2], regionOmitted = !region;
    // JS부동산의 운영 범위에서는 "도마동34-42"도 대전 지번으로 조회하되,
    // 응답이 정확히 한 필지일 때만 링크를 허용합니다.
    if (regionOmitted) region = '대전광역시';
    // Existing JS listings omit the city for the five Daejeon districts only.
    if (/^(동구|중구|서구|유성구|대덕구)$/.test(region)) region = '대전광역시 ' + region;
    var parts = region.split(' '); parts[0] = provinces[parts[0]] || parts[0];
    region = parts.join(' ');
    if (!/(?:특별시|광역시|특별자치시|도)(?: |$)/.test(parts[0]) || /[^가-힣0-9·. ]/.test(region)) return null;
    var main = Number(m[4]), sub = Number(m[5] || 0), mountain = !!m[3];
    return {query:region+' '+town+' '+(mountain?'산 ':'')+main+(sub?'-'+sub:''),regionOmitted:regionOmitted,town:town,main:main,sub:sub,mountain:mountain};
  }
  function matchParcel(query, results) {
    var requested = parseAddress(query), matches = new Map();
    if (!requested) throw Error('정확한 동(리)과 지번을 입력해 주세요.');
    (Array.isArray(results) ? results : []).forEach(function(row) {
      var a = row && row.address, parsed = parseAddress(a && a.address_name);
      if (!a || !parsed) return;
      var sameAddress = requested.regionOmitted
        ? !parsed.regionOmitted && parsed.query.indexOf('대전광역시 ') === 0 && parsed.town === requested.town
        : parsed.query === requested.query;
      if (!sameAddress) return;
      var code = text(a.b_code), main = text(a.main_address_no), sub = text(a.sub_address_no) || '0', mountain = text(a.mountain_yn).toUpperCase();
      if (!/^[1-9]\d{9}$/.test(code) || !/^\d{1,4}$/.test(main) || !/^\d{1,4}$/.test(sub) || !/^[NY]$/.test(mountain)) return;
      if (Number(main) !== requested.main || Number(sub) !== requested.sub || (mountain === 'Y') !== requested.mountain) return;
      var pnu = code + (mountain === 'Y' ? '2' : '1') + main.padStart(4,'0') + sub.padStart(4,'0');
      matches.set(pnu, {pnu:pnu,address:parsed.query});
    });
    if (matches.size !== 1) throw Error(matches.size ? '동일 주소의 필지가 여러 개입니다. 정확한 지번을 다시 확인해 주세요.' : '입력한 지번과 정확히 일치하는 필지를 찾지 못했습니다. 주소를 확인해 주세요.');
    return Array.from(matches.values())[0];
  }
  function links(pnu) {
    if (!/^[1-9]\d{9}[12]\d{8}$/.test(text(pnu)) || Number(text(pnu).slice(11,15)) === 0) throw Error('올바른 필지번호가 아닙니다.');
    return {
      eum:'https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?selGbn=umd&isNoScr=script&s_type=1&mode=search&add=land&pnu='+pnu,
      valuemap:'https://www.valueupmap.com/properties/lands/'+pnu
    };
  }
  function resolve(address) {
    var parsed = parseAddress(address);
    if (!parsed) return Promise.reject(Error('정확한 동(리)과 지번을 입력해 주세요. 지번이 없거나 여러 필지이면 바로 연결하지 않습니다.'));
    var query = parsed.query, saved = cache.get(query);
    if (saved && Date.now()-saved.at < 600000) return Promise.resolve(saved.value);
    if (pending.has(query)) return pending.get(query);
    var promise = new Promise(function(resolve, reject) {
      var services = global.kakao && global.kakao.maps && global.kakao.maps.services;
      if (!services || !services.Geocoder) { reject(Error('주소 검색 서비스가 준비되지 않았습니다. 잠시 후 지번 확인을 눌러 주세요.')); return; }
      var settled = false;
      var timer = global.setTimeout(function() { finish(Error('지번 조회 시간이 초과되었습니다. 잠시 후 다시 확인해 주세요.')); }, 8000);
      function finish(error, value) {
        if (settled) return; settled = true; global.clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      }
      try {
        new services.Geocoder().addressSearch(query, function(results, status) {
          if (settled) return;
          if (status !== services.Status.OK) { finish(Error('지번 조회에 실패했습니다. 주소를 확인하거나 잠시 후 다시 시도해 주세요.')); return; }
          try { var parcel = matchParcel(address, results); finish(null, {address:parcel.address,pnu:parcel.pnu,links:links(parcel.pnu)}); }
          catch (e) { finish(e); }
        }, {size:30,analyze_type:services.AnalyzeType ? services.AnalyzeType.EXACT : 'exact'});
      } catch (_) { finish(Error('주소 검색 서비스를 실행하지 못했습니다. 잠시 후 다시 확인해 주세요.')); }
    });
    pending.set(query,promise);
    return promise.then(function(value) {
      pending.delete(query); if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(query,{at:Date.now(),value:value}); return value;
    }, function(error) { pending.delete(query); throw error; });
  }
  global.JSParcelExternalLinksV1 = {parseAddress:parseAddress,matchParcel:matchParcel,links:links,resolve:resolve};
})(window);
