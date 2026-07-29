(function (global) {
  "use strict";

  var aliasPromise = null;

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  }

  function unique(values) {
    return (values || []).filter(function (value, index, all) {
      return value && all.indexOf(value) === index;
    });
  }

  function loadAliases() {
    if (aliasPromise) return aliasPromise;
    aliasPromise = fetch("data/brand-industry-aliases.json?v=20260729-brand1", {
      cache: "no-store"
    }).then(function (response) {
      if (!response.ok) throw new Error("브랜드 업종 사전을 불러오지 못했습니다.");
      return response.json();
    });
    return aliasPromise;
  }

  function findAlias(request, data) {
    var text = normalize(request);
    var matches = (data.brands || []).filter(function (brand) {
      return [brand.name].concat(brand.aliases || []).some(function (alias) {
        var key = normalize(alias);
        return key && text.indexOf(key) >= 0;
      });
    }).sort(function (a, b) {
      return normalize(b.name).length - normalize(a.name).length;
    });
    if (!matches.length) return null;
    var best = matches[0];
    return {
      matched: true,
      source: "브랜드 업종 사전",
      brandName: best.name,
      businessType: best.businessType,
      industryIds: unique(best.industryIds || []),
      categoryEvidence: [],
      confidence: "HIGH",
      notice: data.notice
    };
  }

  function mapPlaceCategories(places) {
    var text = (places || []).map(function (place) {
      return [place.category_name, place.place_name].join(" ");
    }).join(" ");
    var mappings = [
      [/바이크|오토바이|이륜차|모터사이클/, ["motorcycle-sales", "motorcycle-repair", "motorcycle-parts"]],
      [/바이크튜닝|오토바이튜닝|이륜차튜닝|커스텀바이크/, ["motorcycle-tuning"]],
      [/동물병원/, ["animal-hospital"]],
      [/애견|반려동물|동물미용/, ["pet-grooming", "pet-hotel"]],
      [/자동차정비|카센터/, ["auto-repair"]],
      [/세차/, ["car-wash"]],
      [/스크린골프|골프연습장/, ["screen-golf"]],
      [/헬스|휘트니스|피트니스/, ["fitness"]],
      [/코인노래|노래방/, ["coin-karaoke", "karaoke"]],
      [/PC방|피시방/, ["internet-computer-game"]],
      [/약국/, ["pharmacy"]],
      [/병원|의원|치과|한의원/, ["clinic"]],
      [/미용실|헤어/, ["beauty-hair"]],
      [/네일/, ["beauty-nail"]],
      [/피부관리|에스테틱/, ["beauty-skin"]],
      [/학원|교습소|공부방/, ["private-academy", "study-room"]],
      [/세탁/, ["laundry"]],
      [/숙박|호텔|모텔/, ["lodging"]],
      [/목욕|사우나/, ["bathhouse"]],
      [/편의점/, ["convenience-store"]],
      [/제과|베이커리|빵집/, ["bakery", "rest-restaurant"]],
      [/카페|커피|디저트/, ["cafe", "rest-restaurant"]],
      [/김밥|분식|떡볶이/, ["general-restaurant", "rest-restaurant"]],
      [/음식점|한식|중식|일식|양식|치킨|피자|햄버거/, ["general-restaurant"]],
      [/생활용품|화장품|소매/, ["retail-store"]]
    ];
    var ids = [];
    mappings.forEach(function (mapping) {
      if (mapping[0].test(text)) ids = ids.concat(mapping[1]);
    });
    ids = unique(ids);
    if (/바이크|오토바이|이륜차|모터사이클/.test(text)) {
      ids = ids.filter(function (id) { return id !== "auto-repair"; });
    }
    if (ids.indexOf("cafe") >= 0 || ids.indexOf("bakery") >= 0) {
      ids = ids.filter(function (id) { return id !== "general-restaurant"; });
    }
    if (ids.indexOf("animal-hospital") >= 0) {
      ids = ids.filter(function (id) { return id !== "clinic"; });
    }
    return ids;
  }

  function queryKakao(request) {
    return new Promise(function (resolve) {
      if (!global.kakao || !global.kakao.maps || !global.kakao.maps.services) {
        resolve(null);
        return;
      }
      var placesService = new global.kakao.maps.services.Places();
      placesService.keywordSearch(String(request || "").slice(0, 80), function (places, status) {
        if (status !== global.kakao.maps.services.Status.OK || !places || !places.length) {
          resolve(null);
          return;
        }
        var evidence = places.slice(0, 5).map(function (place) {
          return {
            name: place.place_name || "",
            category: place.category_name || ""
          };
        });
        var industryIds = mapPlaceCategories(evidence.map(function (entry) {
          return { place_name: entry.name, category_name: entry.category };
        }));
        if (!industryIds.length) {
          resolve(null);
          return;
        }
        resolve({
          matched: true,
          source: "지도 등록 업소 카테고리",
          brandName: evidence[0].name,
          businessType: evidence[0].category,
          industryIds: industryIds,
          categoryEvidence: evidence,
          confidence: "MEDIUM",
          notice: "지도 업소 카테고리는 법정 인허가 업종과 다를 수 있어 실제 운영내용 확인이 필요합니다."
        });
      }, { size: 5 });
    });
  }

  function resolve(request) {
    return loadAliases().then(function (data) {
      var alias = findAlias(request, data);
      if (alias) return alias;
      return queryKakao(request);
    }).catch(function () {
      return queryKakao(request);
    });
  }

  global.PermitBrandIndustryResolverV1 = {
    normalize: normalize,
    loadAliases: loadAliases,
    findAlias: findAlias,
    mapPlaceCategories: mapPlaceCategories,
    resolve: resolve
  };
})(window);
