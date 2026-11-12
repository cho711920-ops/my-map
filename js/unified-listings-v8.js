(function(global) {
  "use strict";

  var DETAIL_CACHE_TTL = 5 * 60 * 1000;
  var DETAIL_RETRY_DELAY = 30 * 1000;
  var state = { groups: {}, detailCache: {}, detailCachedAt: {}, detailRetryAt: {}, detailGeneration: 0,
    detailPending: {}, detailPendingForced: {}, contactCache: {}, contactPending: {},
    tellCache: {}, tellPending: {}, masterMeta: {}, sourceSearchIds: {}, pendingMove: null,
    loaded: false, originalLoadPhase: "pending", loadPending: null, loadGeneration: 0, snapshotRevision: "", detailPropertyGeneration: {},
    openPropertyId: "", openOriginalId: "", openOriginalIdentity: "", detailRequestToken: 0,
    detailWarmupTimer: 0, detailWarmupIds: [], contactWarmupTimer: 0,
    contactWarmupIds: [], tellInputTimer: 0, tellRequestToken: 0,
    photoPreloads: {}, photoLookupsV116: {}, pendingDetailSteps: {}, detailPhotoRetryCount: 0,
    detailStatus: {}, detailRefreshRetries: {},
    masterItemsArray: null, masterItemsById: Object.create(null),
    metadataCoverage: Object.create(null), sourceSnapshotProofKeys: Object.create(null),
    pendingProofIds: Object.create(null), pendingProofCount: 0, lastPendingProofCount: 0,
    displayItemsArray: null, displayItemsById: Object.create(null),
    personalCoverGroupKeysV86: Object.create(null), personalCoverGroupRevisionV86: 0 };

  function text(value) { return String(value == null ? "" : value).trim(); }
  function isPhoneDetailV2() {
    var device = global.JSPhoneDeviceV1;
    return !!(device && (typeof device.isMobileLayout === "function" ? device.isMobileLayout() :
      typeof device.isPhone === "function" && device.isPhone()));
  }
  function encodedExternalLink(value) {
    return encodeURIComponent(text(value)).replace(/'/g, "%27");
  }
  function esc(value) {
    return text(value).replace(/[&<>"']/g, function(character) {
      return {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[character];
    });
  }

  // Pure projection: never rewrite collector evidence or price-parser inputs.
  // Runs on open, including the approved edit view, not over the inventory.
  function cleanSourceDescriptionV140(value) {
    var raw = String(value == null ? "" : value);
    if (!raw || raw.length > 50000) return {text: raw, changed: false};
    // Dated user additions are not source advertising, even when they quote it.
    var suffixAt = raw.search(/\r?\n\s*\[\d{2,4}[./-]\d{1,2}[./-]\d{1,2}\]/);
    var suffix = suffixAt < 0 ? "" : raw.slice(suffixAt);
    var body = suffixAt < 0 ? raw : raw.slice(0, suffixAt);
    var prefixMatch = body.match(/^\s*\((?:임장가자|공실박스)\)\s*/);
    var prefix = prefixMatch ? prefixMatch[0] : "";
    if (prefixMatch) body = body.slice(prefix.length);
    var changed = false;
    // Collectors flatten paragraphs. Split decorated clauses before classifying:
    // a financial keyword in a later clause must not protect a broker's slogan.
    // Asterisks before words are bullets; numeric dimensions (25.9m*8.5m) stay intact.
    var parts = body.replace(/\u200D/g, "").replace(/\(\s*(?:임장가자|공실박스)\s*\)\s*/g, "").split(/\r?\n|[✓✔☑☘❇✳★☆✦▪▣▶▷■□◆◇●○※∙•‣☞]+|\p{Extended_Pictographic}+|\p{Emoji_Modifier}+|\uFE0F+|[─━_—=]{4,}|-{5,}|\*+(?=\s*[가-힣A-Za-z])|(?<=[.!?])\s+(?=[가-힣A-Za-z'"(])|\s+\/\s+(?=[^/\n]{0,60}(?:공인\s*중개사|부\s*동\s*산))/u);
    // Remove a decorated title tag only when its exact name is identified by
    // a standalone brokerage label in the same description. Never guess a
    // building name from the tag alone or erase ordinary occurrences of it.
    var officeNames = Object.create(null);
    parts.forEach(function(part) {
      var match = part.replace(/\s/g, "").match(/^([가-힣A-Za-z0-9]{2,16})부동산(?:공인중개사(?:사무소|무소)?|중개법인)?[:：]?$/);
      if (match) officeNames[match[1]] = true;
    });
    var brokerContextV146 = /중개사|중개\s*사무소|부동산|개설\s*등록번호/.test(body);
    var narrativeBrokerV174 = /중개\s*실력|진심\s*중개|공인\s*중개사|중개\s*사무소|부동산/.test(body);
    function narrativePitchV174(clause) {
      if (!narrativeBrokerV174) return false;
      // An audience appeal or a broker's service promise is not a property
      // condition. Match it before generic words such as 필요/주차 protect it.
      // Never discard the rest of a paragraph after finding one such appeal.
      var evidence = /\d+(?:[.,]\d+)?\s*(?:억|만원|만\s*원|평|㎡|m2|층|호|대|kw|%)|(?:보증금|월세|관리비|권리금|면적|전용|주차|화장실|입주|업종|용도)\s*[:：]|임대인|임차인|세입자|관리실|관리인|건물주|(?:미가입|미확인|불가|안\s*됨|금지|필수|의무)|(?:입점|사용|임대|영업|용도변경|인허가|업종)\s*(?:가능|제한)|^(?:메모|임장\s*기록|현장\s*메모|직접\s*작성|수동\s*메모)\s*[:：]/i.test(clause);
      if (evidence) return false;
      var investmentPitchV184 = /좋은\s*매물은\s*타이밍|지금(?:은|이)?\s*(?:바로\s*)?(?:현금\s*흐름을\s*만드는\s*자산에\s*투자|부동산\s*투자\s*시기)|불확실한\s*시대.{0,40}확실한\s*투자처|은행\s*이자보다\s*높은\s*월세\s*수익.{0,35}확인해|(?:오늘이|지금이).{0,15}가장\s*싸다|(?:다가구\s*전문을\s*넘어.{0,35}최저가로|건물\s*급매물\s*다량\s*보유)|꼭\s*팔아야.{0,80}빠르게.{0,25}(?:팔아|사드)|현금흐름.{0,25}시세차익.{0,35}투자\s*전략|투자\s*상담해\s*보세요|지금\s*바로\s*문의하세요/.test(clause);
      if (investmentPitchV184) return true;
      if (!narrativeBrokerV174) return false;
      var personal = /작게\s*시작해도.{0,70}끝까지\s*함께|중개\s*실력.{0,35}자신|저의\s*진심|알아주실.{0,25}믿|그\s*마음.{0,45}잊지|그저\s*거래로\s*끝내는|(?:저는|제가|그것이).{0,55}(?:신경\s*쓰|드리는\s*말|도와드릴)|저를\s*믿고.{0,25}함께\s*준비/.test(clause);
      var audience = /혼자\s*고민하는\s*창업|처음\s*상가.{0,45}(?:불안|답답)|처음\s*창업.{0,55}막막|허위\s*매물\s*때문에.{0,40}(?:실망|경험)|월세\s*부담.{0,35}시작.{0,20}두려|(?:상권\s*조건|내\s*업종).{0,40}알고\s*싶/.test(clause);
      var service = /(?:합리적인|저렴한)\s*소형\s*상가만.{0,20}골라|가성비\s*좋은\s*자리.{0,25}현실적인\s*상권\s*판단|진짜\s*필요한\s*조건.{0,25}먼저\s*생각|월세\s*부담\s*낮춘.{0,25}상가\s*먼저\s*안내|동네\s*분위기.{0,40}주차까지\s*직접\s*체크|업종.{0,35}함께\s*머리.{0,25}고민|계약에서\s*오픈까지.{0,35}도와|신고[\s·ㆍ.,/]*등록[\s·ㆍ.,/]*인허가까지.{0,35}챙|부담\s*갖지.{0,25}됩니다|질문하면.{0,20}정직.{0,20}답|보내주신\s*조건.{0,35}소개하지\s*않|성급하게\s*밀어붙이지\s*않/.test(clause);
      return personal || audience || service;
    }
    function brokerClauseV146(clause) {
      // An office address/registration or its own liability cover is not a
      // property fact merely because it includes a room number or an amount.
      var actualTerms = /(?:보증금|월세|월차임|매매가|매매금액|임대수입|권리금|관리비|면적|전용|평수|층수|해당층|방수|욕실수|입주가능일|방향기준|건축물용도|위반건축물|사용승인일)\s*[:：]|(?:보증금|월세|월차임|매매가|매매금액|임대수입|권리금|관리비|전용면적|대지면적|연면적|수익률|건폐율|용적률|해당층수|해당층|층수|방수|욕실수).{0,8}\d|\d+(?:[.,]\d+)?\s*(?:평|㎡|m2|kw)|(?:지분|수익률|건폐율|용적률|대출).{0,12}\d+\s*%|(?:주차|화장실|수도|냉난방|엘리베이터|승강기|층고|셔터|상하차|야적|공실|가벽|인테리어|리모델링|입점|사용\s*(?:가능|중)|운영\s*중|임대\s*가능|대출\s*(?:가능|불가|한도)|업종\s*(?:제한|가능|불가)|용도변경|즉시입주|입주가능|청소|수선|개별\s*청구)/i.test(clause);
      var officeNeedClaim = /공인\s*중개사.{0,80}고객.{0,15}필요.{0,15}충족/.test(clause);
      if (/(?:미가입|미확인|불가|안됨|안\s*됨|금지|필수|의무|요구|메모)|(?:임대인|임차인|세입자|관리실).{0,40}(?:요청|통화|확인)/.test(clause) || /필요/.test(clause) && !officeNeedClaim) return clause;
      clause = clause.replace(/\s+[·ㆍ]\s+[가-힣A-Za-z0-9 \t]{2,50}(?:공인\s*중개사(?:\s*사무소|무소)?|부동산)[.!~ \t]*$/, "").trim();
      var propertyRole = /임차인|세입자|임대인|관리실|계약\s*전|영업배상|화재보험|가입\s*(?:필수|의무|조건)/.test(clause);
      var ownCover = /손해\s*배상(?:책임)?(?:보증)?\s*보험|공인\s*중개사\s*협회.{0,40}(?:보험|공제)|(?:책임|공제)\s*보험\s*\d+\s*억|(?:안심\s*중개|중개\s*사무소|공인\s*중개사|부동산).{0,90}(?:보증|공제|책임)\s*보험/.test(clause);
      var solicitation = /(?:전화|문자|카톡|연락|문의|상담).{0,65}(?:주세|주시면|주십|주셔|주세요|드리|환영|약속|부탁|감사|가능|바랍|하겠|해드|도와)|(?:궁금|자세한\s*(?:사항|설명)).{0,75}(?:전화|연락|문의|상담)/.test(clause);
      var service = /(?:믿음|신뢰|정성|성실|정직).{0,45}(?:중개|보답|상담)|(?:고객|원하시는\s*매물|원하는\s*매물).{0,80}최선|최선.{0,40}(?:중개|상담|구해)|광고(?:하지\s*않는|하지않은).{0,35}매물|등록되어\s*있지\s*않은.{0,35}매물.{0,25}보유|매물.{0,25}(?:많이|다량|다수|다양하게)\s*(?:보유|확보)|직접\s*발로\s*뛰어.{0,35}(?:현장|사진)|^공인\s*중개사가\s*추천/.test(clause);
      var office = /공인\s*중개사|중개\s*사무소|부동산\s*(?:중개|대표)|부동산입니다[.!~\s]*$/.test(clause);
      var officePromotion = office && /전문|서비스|고객|저희|실매물|소유주.{0,40}중개|중개합니다|(?:부동산|사무소)입니다|^[가-힣A-Za-z0-9 \t]{2,50}공인\s*중개사(?:\s*사무소|무소)?[.!~ \t]*$/.test(clause);
      var agencyService = /저희\s*중개업소|(?:공인\s*중개사무소|부동산).{0,35}전문\s*임대팀/.test(clause) && /관리해|관리함|관리하|계약관리|번거로움|공실걱정|해소하|도와드|1순위|순위.{0,20}관리/.test(clause);
      if (agencyService && !/(?:관리비|청소|수선|개별\s*청구|\d+\s*(?:만원|평|㎡))/.test(clause)) return "";
      var slogan = /(?:믿음|신뢰|정직|성실|성심|진심|최선).{0,65}(?:증명|구축|기본|맞춰|뛰겠|보답|모십|진행|다하|만들어|중개|상담)|친절(?:한|히)?\s*상담/.test(clause);
      var identity = office && /대표|등록\s*번호|개설\s*등록|(?:^|\s)[TF]\s*[:：.]/i.test(clause) ||
        brokerContextV146 && /^주소\s*[:：].{0,160}대표\s+[가-힣]{2,5}/.test(clause);
      var bareIdentity = brokerContextV146 && /^(?:대표(?:자|번호|전화)?(?:\s*[:：]?\s+[가-힣]{2,5})?|친절\s*상담\s*[:：]?|카톡\s*ID\s*[:：].*|문의\(담당\)\s*대표.*)[.!~\s/|]*$/i.test(clause) && !/호실|매물|사진|층수/.test(clause);
      var identityLabel = brokerContextV146 && /^(?:[【\[\s]*)(?:대표(?:자|번호)?|소장(?:\(대표\))?(?:\s*직통번호)?|문자상담|카톡\s*ID|상호(?:명)?|사무소\s*(?:명|주소)|사업자\s*등록번호)\s*[:：]/i.test(clause);
      if (!actualTerms && !propertyRole && (ownCover || solicitation || service || identity || identityLabel || bareIdentity || officePromotion || slogan)) return "";
      // Remove only the identifier in a flattened legal footer: actual fields
      // such as move-in date, orientation and room count after it remain.
      if (brokerContextV146 && !/(?:건축물|임대사업자|매물|광고)\s*등록번호/.test(clause)) {
        clause = clause.replace(/(?:개설\s*)?등록\s*번호\s*[:：]?\s*(?:제\s*)?(?:[가-힣]{1,8}[-\s])?\d{3,6}(?:[-\s]\d{2,6}){0,3}\s*호?/g, "").trim();
      }
      clause = clause.replace(/\s+담당\s*공인\s*중개사\s*[:：]\s*[가-힣A-Za-z\d()\s,+\-]{0,45}?(?:로)?\s*연락\s*(?:주세요|주시면[^.\n]{0,25})[.!~\s]*$/g, "").trim();
      clause = clause.replace(/문의\(담당\)\s*대표\s*[\/:\s]*[가-힣]{2,5}\s*[:：]\s*[\d\s(),+\-]*$/g, "").trim();
      return clause;
    }
    var kept = parts.map(function(part) {
      var clause = part.trim();
      if (!clause) return "";
      if (narrativePitchV174(clause)) { changed = true; return ""; }
      // Broker boilerplate may itself say "obligation", "rent" or "confirm".
      // Match the actual promise before those generic safety words, while
      // retaining any concrete property terms in a mixed clause.
      var specificV144 = /\d+(?:[.,]\d+)?\s*(?:만원|만\s*원|평|㎡|층|호|m2|kw|%)|(?:보증금|월세|관리비|권리금|면적|주차장)\s*[:：]|(?:매매가|매매금액|보증금|월세|임대수입).{0,12}\d/i.test(clause);
      var marketingV144 = /직접\s*현장\s*방문.{0,30}실제\s*매물만\s*광고|허위매물\s*없는.{0,20}중개|임대인과\s*임차인\s*사이.{0,30}조건\s*조율|계약\s*전\s*고객님.{0,30}권리와\s*의무.{0,20}설명|보증금\s*및\s*월세.{0,40}임대\s*조건\s*협의\s*지원|찾으시는\s*조건에\s*맞는\s*다른\s*상가.{0,30}안내|전\s*지역\s*상가\s*매물\s*확보.{0,30}상담|^매물\s*문의\s*및\s*상가\s*상담$|해당\s*매물\s*외에도.{0,60}상가\s*매물.{0,20}안내|원하시는\s*업종.{0,100}상가를\s*함께\s*찾아|단순한\s*매물\s*안내를\s*넘어.{0,100}살펴보겠|본\s*매물은\s*광고\s*게시\s*당시.{0,80}확인한\s*매물|광고\s*게시\s*이후\s*계약\s*진행.{0,150}거래\s*가능\s*여부를\s*확인/.test(clause);
      var brokerCoverV144 = /손해배상책임\s*보장.{0,25}공제[·ㆍ\s]*보험\s*가입/.test(clause) && !/(?:임차인|세입자|임대인|가입\s*(?:필수|의무|조건))/.test(clause);
      if (marketingV144 && !specificV144 || brokerCoverV144 && !specificV144) { changed = true; return ""; }
      // Explicit restrictions, obligations and field notes are property evidence.
      // Do not use generic '확인/계약/업종/특약' as a whole-paragraph bypass.
      var original = clause;
      clause = brokerClauseV146(clause);
      if (clause !== original) {
        changed = true;
        // Removing a registration prefix may expose a bare representative
        // label. One bounded second pass makes that projection stable.
        clause = brokerClauseV146(clause);
      }
      if (!clause) return "";
      if (/(?:미가입|미확인|불가|안됨|안\s*됨|금지|필요|필수|의무|요구|메모)|(?:임대인|임차인|세입자|관리실).{0,40}(?:요청|통화|확인)/.test(clause)) return clause;
      clause = clause
        .replace(/[O0]([가-힣A-Za-z0-9]{2,16})[O0](?=\s|$)/g, function(tag, name) { return officeNames[name] ? "" : tag; })
        .replace(/채팅(?:보다는?|보다)\s*전화\s*상담(?:이|을)?\s*(?:빠릅니다|빠르답니다|부탁드립니다|권장합니다)[.!~^\s]*/g, "")
        .replace(/(?:한국\s*)?공인중개사\s*협회\s*(?:\d+(?:\.\d+)?\s*억\s*(?:원)?\s*)?책임\s*보험\s*가입[.!~^\s]*/g, "")
        .replace(/\d+\s*년\s*(?:경력|노하우)\s*[!！]?\s*(?:성실[·ㆍ/\s]*책임\s*중개)?/g, "")
        .replace(/성실[·ㆍ/\s]*책임\s*중개/g, "")
        .replace(/허위\s*광고\s*NO[!！.\s]*/gi, "")
        .replace(/실제\s*매물[·ㆍ,\s]*실제\s*사진(?:만)?\s*등록[!！.\s]*/g, "");
      if (clause !== original) changed = true;
      clause = clause.trim();
      if (!clause || /^[\s!！.~^·ㆍ/|:：*-]*$/.test(clause)) return "";
      // Bare decorative headings are omitted only if an actual promotion was
      // removed elsewhere. Otherwise return the original byte-for-byte below.
      if (/^(?:매\s*물\s*(?:정\s*보|소\s*개|설명\s*및\s*특징)|한\s*줄\s*매물특징)\s*[:：]?$/.test(clause)) return "";
      var brokerage = /(?:공인\s*중개사|중개\s*사무소|부\s*동\s*산\s*(?:정보|중개법인|공인|사무소|소개)|^[가-힣A-Za-z0-9\s]+부\s*동\s*산[:：]?$|책임\s*중개|책임\s*보험|상담\s*문의|상담\s*가능)/.test(clause);
      var propertyContext = /(?:중개사(?:무소)?|부동산).{0,20}(?:입점|사용|용도|소유|임대\s*가능)|(?:임차인|세입자|임대인|계약\s*전|관리실)/.test(clause);
      var facts = /(?:보증금|월차임|월세|월\s*임대|임대\s*금액|임대\s*조건|매매가|매매\s*금액|대출|임대\s*수입|수익률|관리비|권리금|면적|평수|전용|공급|연면적|대지|주차|입점|사용|허가|제한|승계|임차인|세입자|화장실|엘리베이터|승강기|냉난방|시설|입주|양도|철거|원상\s*복구|전기|수도|가스|전면|코너|대로|역세권|용도|지목|건폐율|용적률|분할|배기|배수|천장|출입|업종|방\s*없음)|\d+(?:[.,]\d+)?\s*(?:억|만원|원|평|㎡|층|호|m2|㎾|kw|%)/i.test(clause);
      // A boilerplate promise can mention rent, permits or contract terms. It
      // needs a concrete amount/label/facility to qualify as a property fact.
      var concrete = /\d+(?:[.,]\d+)?\s*(?:억|만원|원|평|㎡|층|호|m2|㎾|kw|%)|(?:보증금|월차임|월세|관리비|권리금|전용면적|층수|해당층|E\/V)\s*[:：]|(?:수익률|건폐율|용적률|연면적|대지면적|방수|욕실수|층수|해당층)\s*[:：]?\s*\d|(?:주차장|화장실|엘리베이터|층고|셔터|상하차|야적공간)/i.test(clause);
      var promise = /(?:^연락\s*주세요[.!~\s]*$|맞춤형\s*매물\s*컨설팅|누구보다\s*빠르게\s*찾아|성공\s*파트너|함께\s*고민하겠|입지\s*분석부터\s*사후\s*관리|최적화.{0,10}조율|\d+일\s*\d+시간.{0,30}상담|평일.{0,60}친절히\s*안내|직접\s*찾지\s*마세요|의뢰주시면|철저한\s*입지.{0,30}권리분석|계약부터\s*입점까지\s*책임|최다\s*매물\s*확보|매물.{0,12}(?:다량|다수)\s*보유|(?:최상의|최대한의)\s*조건\s*조율|만족도\s*높은\s*중개\s*서비스|상가\s*전문\s*공인중개사와\s*준비|언제든(?:지)?\s*전화주시면|친절\s*상담\s*해드|(?:보증금|월세|권리금|렌트프리).{0,100}최대한\s*조율해\s*드립니다|가격\s*조건\s*끝까지\s*협의|고객(?:님)?(?:의|\s).{0,100}(?:고민|입장|성실))/.test(clause);
      var brokerInsurance = brokerage && /(?:책임|공제)\s*보험\s*가입/.test(clause) && !propertyContext;
      if ((promise && !concrete) || (brokerInsurance && !concrete) || (brokerage && !facts && !propertyContext && !concrete)) {
        changed = true;
        return "";
      }
      return clause;
    }).filter(Boolean);
    return {text: changed ? prefix + kept.join("\n") + suffix : raw, changed: changed};
  }
  function rawDescriptionHtmlV140(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function(character) {
      return {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[character];
    });
  }
  var attachmentBadgesV181={account:'',counts:new Map(),writes:new Map(),pending:new Set(),busy:false,timer:null,generation:0,ui:null};
  function attachmentAccountV181(){return String(global.JSAuthenticatedAccountEmail||'').trim().toLowerCase();}
  function attachmentScopeV181(){
    var account=attachmentAccountV181();
    if(account!==attachmentBadgesV181.account){attachmentBadgesV181.account=account;attachmentBadgesV181.counts.clear();attachmentBadgesV181.writes.clear();attachmentBadgesV181.pending.clear();attachmentBadgesV181.generation++;
      document.querySelectorAll('[data-listing-attachment-v181]').forEach(function(button){button.classList.remove('has-files');button.textContent='첨부';button.setAttribute('aria-label','첨부자료 열기');});}
    return account;
  }
  function attachmentCountV181(id,count){
    if(!attachmentScopeV181()||!Number.isInteger(count)||count<0||count>1000)return;
    attachmentBadgesV181.counts.set(id,count);
    while(attachmentBadgesV181.counts.size>500)attachmentBadgesV181.counts.delete(attachmentBadgesV181.counts.keys().next().value);
    document.querySelectorAll('[data-listing-attachment-v181]').forEach(function(button){if(button.dataset.listingAttachmentV181!==id)return;
      button.classList.toggle('has-files',count>0);button.textContent='첨부'+(count?' '+count:'');button.setAttribute('aria-label','첨부자료 열기'+(count?' ('+count+'개)':''));});
  }
  async function attachmentBadgesReadV181(){
    attachmentBadgesV181.timer=null;if(attachmentBadgesV181.busy||!attachmentScopeV181()||!attachmentBadgesV181.pending.size)return;
    var account=attachmentBadgesV181.account,generation=attachmentBadgesV181.generation,ids=Array.from(attachmentBadgesV181.pending).slice(0,24);
    var fences=ids.map(function(id){return attachmentBadgesV181.writes.get(id)||0;});
    ids.forEach(function(id){attachmentBadgesV181.pending.delete(id);});attachmentBadgesV181.busy=true;
    try{
      var result=await global.JSDataAccessV6.listingAttachments({ids:ids.join(',')},{signal:AbortSignal.timeout(8000),priority:'low'},account);
      if(result.ok&&attachmentAccountV181()===account&&generation===attachmentBadgesV181.generation)
        ids.forEach(function(id,index){if(fences[index]===(attachmentBadgesV181.writes.get(id)||0)&&Object.prototype.hasOwnProperty.call(result.counts||{},id))attachmentCountV181(id,result.counts[id]);});
    }catch(_e){/* Unknown remains neutral, never a fabricated zero or a page toast. */}
    finally{attachmentBadgesV181.busy=false;if(attachmentBadgesV181.pending.size)attachmentBadgesV181.timer=setTimeout(attachmentBadgesReadV181,150);}
  }
  function attachmentCountChangedV181(id,count){attachmentBadgesV181.writes.set(id,(attachmentBadgesV181.writes.get(id)||0)+1);attachmentCountV181(id,count);}
  global.addEventListener('js-auth-restored',attachmentScopeV181);
  global.addEventListener('js-auth-required',function(){attachmentBadgesV181.account='';attachmentBadgesV181.counts.clear();attachmentBadgesV181.generation++;document.querySelectorAll('[data-listing-attachment-v181]').forEach(function(button){button.classList.remove('has-files');button.textContent='첨부';});});
  function attachmentButtonHtmlV181(item){
    if(!global.JSListingTradeV1?.isBuildingSale?.(item))return '';
    var id=String(item&&item.propertyId||'');if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))return '';
    var account=attachmentScopeV181(),count=attachmentBadgesV181.counts.get(id);
    if(account&&count===undefined){attachmentBadgesV181.pending.add(id);if(!attachmentBadgesV181.timer)attachmentBadgesV181.timer=setTimeout(attachmentBadgesReadV181,150);}
    var label=[item.name||item.buildingName,item.address,item.room].filter(Boolean).join(' · ');
    return '<button type="button" class="attachment-entry-v181'+(count?' has-files':'')+'" data-attachment-market-v196="building_sale" data-listing-attachment-v181="'+esc(id)+'" data-attachment-label-v181="'+esc(label)+'" aria-label="첨부자료 열기'+(count?' ('+count+'개)':'')+'" onclick="event.stopPropagation();JSUnifiedListingsV8.openAttachments(this)">첨부'+(count?' '+count:'')+'</button>';
  }
  async function openAttachmentsV181(button){
    if(button?.dataset.attachmentMarketV196!=='building_sale')return;
    var id=button&&button.dataset.listingAttachmentV181,account=attachmentScopeV181();if(!id||!account)return;
    button.disabled=true;
    try{
      if(!global.JSListingAttachmentsV181){
        if(!attachmentBadgesV181.ui)attachmentBadgesV181.ui=new Promise(function(resolve,reject){
          var link=document.getElementById('listingAttachmentsModuleV181'),script=document.createElement('script');
          script.src=link?link.href:'/js/listing-attachments-v181.js?v=181';var timer=setTimeout(function(){script.remove();reject(Error('첨부창 연결이 지연됩니다. 다시 눌러 주세요.'));},8000);
          script.onload=function(){clearTimeout(timer);global.JSListingAttachmentsV181?resolve():reject(Error('첨부창을 열지 못했습니다.'));};
          script.onerror=function(){clearTimeout(timer);script.remove();reject(Error('첨부창 연결을 확인해 주세요.'));};document.head.appendChild(script);
        }).catch(function(error){attachmentBadgesV181.ui=null;throw error;});
        await attachmentBadgesV181.ui;
      }
      if(account===attachmentAccountV181()&&button.isConnected)global.JSListingAttachmentsV181.open({propertyId:id,account:account,sourceButton:button});
    }catch(error){if(account===attachmentAccountV181())alert(error.message);}
    finally{if(button.isConnected)button.disabled=false;}
  }
  function saleOccupancyMemoHtmlV180(value, item) {
    var raw = String(value == null ? "" : value);
    if (!item || (item.tradeType || item.trade_type) !== "sale" ||
        (item.saleCategory || item.sale_category) === "land") return rawDescriptionHtmlV140(raw);
    // Display only: annotate text before escaping it, never saved memo HTML.
    return raw.split(/(\r\n|[\r\n;；|•●■◆▶★※]|[,，](?=\s|[가-힣])|[.!?](?=\s|$))/).map(function(part) {
      var heading = /(?:층별|호실별|세대별)\s*(?:구성|현황|안내|내역)?|(?:임대|임차|입주|공실|호실|세대)\s*(?:현황|구성|내역)|현황도/.exec(part);
      var units = /(?:(?:지하|지상|B)\s*)?-?\d{1,3}(?:\s*층?\s*[~∼–-]\s*(?:지하|지상)?\s*\d{1,3})?\s*층|지층|옥탑층?|\d{2,4}(?:\s*[~∼–-]\s*\d{2,4})?\s*호(?:실)?|(?:(?:분리형|오픈형|복층)\s*)?(?:원룸|투룸|쓰리룸|[1-3]\.5\s*룸)\s*\d*|주인\s*(?:세대|거주)|(?:총\s*)?\d+\s*(?:가구|세대|호실)/gi;
      var match, start = heading ? heading.index : -1;
      while (start < 0 && (match = units.exec(part))) {
        var before = part.slice(0, match.index), after = part.slice(match.index + match[0].length);
        if (/[가-힣A-Za-z0-9]$/.test(before) || /총\s*$/.test(before)) continue;
        if (/층$/.test(match[0]) && after.trim() && !/^\s*(?:[:：=\-–—→(（]|원룸|투룸|쓰리룸|[1-3]\.5\s*룸|상가|점포|사무|주택|주인|공실|임대|임차|거주|입주|보증|보\s*\d|월세|월\s*\d|방|\d)/.test(after)) continue;
        start = match.index;
      }
      if (start < 0) return rawDescriptionHtmlV140(part);
      if (!heading && !/\d\s*층|\d\s*호(?:실)?|지층|옥탑/.test(part) && /원룸|투룸|쓰리룸|룸|주인/.test(match[0])) {
        var compact = /(?:(?:분리형|오픈형|복층)\s*)?(?:원룸|투룸|쓰리룸|[1-3]\.5\s*룸|주인\s*(?:세대|거주))(?:\s*\d+\s*(?:개|가구|세대|호실|실)?)?(?:\s*(?:입주\s*가능|공실|임대\s*중|거주\s*중))?/g;
        var pieces = [], cursor = 0, unit;
        while ((unit = compact.exec(part))) {
          if (/[가-힣A-Za-z0-9]$/.test(part.slice(0, unit.index))) continue;
          pieces.push(rawDescriptionHtmlV140(part.slice(cursor, unit.index)), '<mark class="sale-occupancy-highlight-v180">', rawDescriptionHtmlV140(unit[0]), '</mark>');
          cursor = unit.index + unit[0].length;
        }
        return pieces.join("") + rawDescriptionHtmlV140(part.slice(cursor));
      }
      var tail = part.slice(start), boundary = /\s+(?:(?:매매가?|매매\s*금액|대지(?:면적)?|연면적|준공|융자|대출|실투자(?:금)?|수익률|담당|상담|중개)\s*[:：\d]|(?:총\s*보증금|보증금\s*합계|월\s*(?:수입|임대수입)\s*합계))/.exec(tail);
      var end = boundary ? start + boundary.index : part.length;
      var selected = part.slice(start, end), trailing = selected.match(/\s*$/)[0];
      selected = selected.slice(0, selected.length - trailing.length);
      return rawDescriptionHtmlV140(part.slice(0, start)) + '<mark class="sale-occupancy-highlight-v180">' +
        rawDescriptionHtmlV140(selected) + '</mark>' + rawDescriptionHtmlV140(trailing + part.slice(end));
    }).join("");
  }
  function sourceDescriptionHtmlV140(value, original) {
    var raw = String(value == null ? "" : value);
    if (!original || original.masterFallback || !/^(?:네이버|당근|공실박스)$/.test(text(original.source))) return saleOccupancyMemoHtmlV180(raw, original);
    var result = cleanSourceDescriptionV140(raw);
    if (!result.changed) return saleOccupancyMemoHtmlV180(raw, original);
    return '<span class="source-description-clean-v140">' +
      (result.text.trim() ? saleOccupancyMemoHtmlV180(result.text, original) : '매물 설명은 원문에서 확인할 수 있습니다.') + '</span>' +
      '<details class="source-description-original-v140"><summary>수집 원문 보기</summary><div>' + rawDescriptionHtmlV140(raw) + '</div></details>';
  }
  function operatingMemoHtmlV140(item) {
    var raw = String(item && item.memo || "");
    // Unmarked management notes are user-owned. Their display and all edit/save
    // paths stay untouched; only source-generated visit memos are projected.
    return /^\s*\((?:임장가자|공실박스)\)/.test(raw)
      ? sourceDescriptionHtmlV140(raw, item) : saleOccupancyMemoHtmlV180(raw, item);
  }

  // Project only collector-marked text. Drafts and unmarked private notes
  // never pass through a promotion filter; raw provider evidence is preserved.
  function editableMemoTextV144(item) {
    var raw = String(item && item.memo || "");
    return /^\s*\((?:임장가자|공실박스)\)/.test(raw) && /^(?:네이버|당근|공실박스)$/.test(text(item && item.source))
      ? cleanSourceDescriptionV140(raw).text : raw;
  }
  function memoEditorRawHtmlV144(item) {
    var raw = String(item && item.memo || "");
    return editableMemoTextV144(item) !== raw ? '<details class="source-description-original-v140 memo-editor-original-v144"><summary>수집 원문 보기</summary><div>' + rawDescriptionHtmlV140(raw) + '</div></details>' : '';
  }

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toLocaleString("ko-KR", {maximumFractionDigits: 2}) : "-";
  }
  function detailDate(value) {
    var raw = text(value);
    if (!raw) return "";
    return typeof global.formatListRegistrationDate === "function"
      ? text(global.formatListRegistrationDate(raw))
      : raw;
  }
  function desktop() { return global.innerWidth > 768; }
  function isSourceUnavailable(original) {
    if (original && (original.active === 1 || original.active === "1")) return false;
    return !!(original && (original.sourceUnavailable === true || original.sourceUnavailable === 1 ||
      original.sourceUnavailable === "true" || original.active === 0 || original.active === "0"));
  }
  function isCandidateOriginal(original) {
    return isSourceUnavailable(original) && /^(?:legacy_candidate|census_missing)$/.test(text(original && original.availabilityKind)) && !!(original &&
      (original.candidateEligible === true || original.candidateEligible === 1 || original.candidateEligible === "true"));
  }
  function absenceConfirmationTime(original) {
    if (!isCandidateOriginal(original) || text(original.availabilityKind) !== "census_missing") return 0;
    var raw = text(original.absenceConfirmedAt);
    // Only the server-validated census timestamp is an absence confirmation.
    // Provider end dates, ordinary updates and legacy flags cannot stand in for it.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) return 0;
    var parsed = Date.parse(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  function absenceConfirmationDate(original) {
    var timestamp = absenceConfirmationTime(original);
    if (!timestamp) return "";
    // Explicit KST conversion keeps the displayed day stable on overseas devices.
    var date = new Date(timestamp + 9 * 60 * 60 * 1000);
    return String(date.getUTCFullYear()).slice(-2) + "." +
      String(date.getUTCMonth() + 1).padStart(2, "0") + "." + String(date.getUTCDate()).padStart(2, "0");
  }
  function detailDateMetadata(masterMeta, selected) {
    var registrationDate = detailDate(masterMeta && masterMeta.regDate);
    var candidate = isCandidateOriginal(selected);
    if (!registrationDate && !candidate) return "";
    return '<div class="unified-detail-meta-v8">' +
      (registrationDate ? '<span class="unified-detail-date-v1"><span>등록일</span><b>' + esc(registrationDate) + '</b></span>' : '') +
      (candidate ? '<span class="unified-detail-date-v1 absence-confirmed-date-v1"><span>미노출 확인일</span><b>' +
        esc(absenceConfirmationDate(selected) || "미확인") + '</b></span>' : '') + '</div>';
  }
  function publicOriginals(originals) {
    return (originals || []).filter(function(original) {
      return !isSourceUnavailable(original) || isCandidateOriginal(original);
    });
  }
  function sourcePriority(original, hasDaangn) {
    var key = sourceKey(original && original.source);
    var hasPhoto = thumbnailImagesV119(original).length > 0;
    if (hasDaangn) {
      if (key === "danggeun") return hasPhoto ? 0 : 1;
      return hasPhoto ? 2 : 3;
    }
    if (key === "naver" && hasPhoto) return 0;
    if (hasPhoto) return 1;
    if (key === "naver") return 2;
    return 3;
  }
  function orderOriginals(originals) {
    var values = originals || [];
    // Preserve the independent returned array even when no sorting is needed.
    if (values.length < 2) return values.slice();
    var hasDaangn = values.some(function(original) {
      return sourceKey(original && original.source) === "danggeun";
    });
    return values.map(function(original, index) {
      return {original: original, index: index};
    }).sort(function(left, right) {
      return Number(isSourceUnavailable(left.original)) - Number(isSourceUnavailable(right.original)) ||
        sourcePriority(left.original, hasDaangn) - sourcePriority(right.original, hasDaangn) ||
        left.index - right.index;
    }).map(function(entry) { return entry.original; });
  }
  function allOriginals(propertyId) { return orderOriginals(state.groups[text(propertyId)] || []); }
  function originalMetadataReady(propertyId) {
    var id = text(propertyId);
    return Object.prototype.hasOwnProperty.call(state.groups, id) || !!state.metadataCoverage[id];
  }
  function getOriginalMetadataStatus(propertyId) {
    var id = text(propertyId);
    var ready = id ? originalMetadataReady(id) : state.loaded;
    var phase = state.originalLoadPhase;
    if (phase === "ready" && !ready) phase = "stale";
    return {status: phase, ready: ready, hasKnownData: ready, pendingCount: state.pendingProofCount,
      retryable: phase === "error" || phase === "stale"};
  }
  function setOriginalLoadPhase(phase) {
    var pendingCount = state.pendingProofCount;
    if (state.originalLoadPhase === phase && state.lastPendingProofCount === pendingCount) return;
    state.originalLoadPhase = phase;
    state.lastPendingProofCount = pendingCount;
    if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
      global.dispatchEvent(new global.CustomEvent("js-original-metadata-status", {detail: getOriginalMetadataStatus()}));
    }
  }
  function missingOriginalLabel(propertyId) {
    var metadata = getOriginalMetadataStatus(propertyId);
    return metadata.status === "error" ? "사진 불러오기 실패" : metadata.status === "stale" ? "사진 불러오기 지연" : "사진 불러오는 중";
  }
  function sourceIdentity(original) {
    if (!original) return "";
    var provider = sourceKey(original.source);
    var id = text(original.providerSourceId || original.sourceListingId || original.sourceId)
      .replace(/::(?:lease|sale)$/, "").replace(/^네이버-/i, "");
    return id && /^(?:naver|danggeun|gongsil)$/.test(provider)
      ? provider + ":" + (text(original.tradeType) || "lease") + ":" + id : "";
  }
  function visibleOriginalsFrom(originals, propertyId, masterItem, alreadyOrdered) {
    var values = alreadyOrdered ? originals : orderOriginals(originals || []);
    if (global.doneOnly) {
      var master = masterItem || resolveMasterItem(propertyId);
      return master && text(master.state) === "계약완료" ? publicOriginals(values) : values.filter(isCandidateOriginal);
    }
    return global.hideDone !== false ? values.filter(function(original) { return !isSourceUnavailable(original); }) : publicOriginals(values);
  }
  function group(propertyId) { return visibleOriginalsFrom(allOriginals(propertyId), propertyId, null, true); }

  function displayedOriginalProjection(propertyId) {
    var items = Array.isArray(global.currentItems) ? global.currentItems : [];
    if (state.displayItemsArray !== items) {
      state.displayItemsArray = items;
      state.displayItemsById = Object.create(null);
      items.forEach(function(item) { state.displayItemsById[text(item.propertyId)] = item; });
    }
    var displayed = state.displayItemsById[text(propertyId)];
    // Read-only whole-building cards carry an empty originals array until their
    // exact masters are hydrated. Reproject the same displayed members/filters;
    // that placeholder must not shadow the now-available original groups.
    if (displayed && displayed.queryRowV152) {
      displayed = global.JSQueryListingsV152 && global.JSQueryListingsV152.materialize(displayed);
    }
    return displayed && Array.isArray(displayed.unifiedDisplayOriginalsV2)
      ? displayed.unifiedDisplayOriginalsV2 : null;
  }

  function displayedOriginals(propertyId) {
    return displayedOriginalProjection(propertyId) || group(propertyId);
  }

  function wholeBuildingKeyV55(item) {
    if (item && item.queryRowV152) return text(item.queryGroupKeyV152);
    if (!item || item.tradeType !== "sale" || item.saleCategory === "land" || text(item.state) === "계약완료") return "";
    var parser = global.JSParcelExternalLinksV1;
    var parcel = parser && parser.parseAddress(item.address);
    if (!parcel || parcel.regionOmitted || !/ [가-힣]+(?:구|군) /.test(parcel.query)) return "";
    var originals = publicOriginals(item.unifiedAllOriginalsV1 || []);
    if (!originals.some(function(original) { return !isSourceUnavailable(original); }) || originals.some(function(original) {
      var detail = original.saleSummary || original.saleDetails || {};
      var address = parser.parseAddress(original.address || item.address);
      return original.tradeType !== "sale" || original.saleCategory === "land" ||
        detail.saleExtent !== "whole_building" || detail.wholeBuildingGroupEligibleV55 !== true ||
        original.saleGroupingSeparatedV55 || detail.saleGroupingSeparatedV55 || original.hasManualRoomOverride ||
        /(?:^|,)(?:room|sale_details_json|sale_category|listing_type)(?:,|$)/.test(text(original.manualDisplayFields)) ||
        !address || address.query !== parcel.query;
    })) return "";
    return parcel.query;
  }

  // Collapse only the already-filtered view. Saved master IDs, source groups,
  // favorites, visit records and memo edits continue to address their own row.
  function collapseWholeBuildingSalesV55(items) {
    invalidatePersonalCoverGroupsV86();
    var buckets = Object.create(null), result = [];
    // Choose the same saved master before applying a view's price/yield sort.
    // Filtering may legitimately remove it; never borrow a filtered-out ad.
    (items || []).forEach(function(item) {
      var master = item.queryRowV152 ? item : resolveMasterItem(item.propertyId) || item;
      var key = wholeBuildingKeyV55(master);
      if (!key) { result.push(item); return; }
      var grouped = buckets[key];
      if (!grouped) {
        grouped = Object.assign({}, item, {wholeBuildingMembersV55: [text(item.propertyId)],
          unifiedDisplayOriginalsV2: (item.unifiedDisplayOriginalsV2 || item.unifiedOriginalsV8 || []).slice()});
        buckets[key] = grouped;
        result.push(grouped);
      } else {
        var queryCountV152 = Number(grouped.queryMatchedOriginalCountV152 || 0) + Number(item.queryMatchedOriginalCountV152 || 0);
        var querySourcesV152 = (grouped.sourceTypesV8 || []).concat(item.sourceTypesV8 || []);
        if (text(item.propertyId) < text(grouped.propertyId)) {
          var members = grouped.wholeBuildingMembersV55, originals = grouped.unifiedDisplayOriginalsV2;
          Object.assign(grouped, item);
          grouped.wholeBuildingMembersV55 = members;
          grouped.unifiedDisplayOriginalsV2 = originals;
        }
        if (grouped.queryRowV152) {
          grouped.queryMatchedOriginalCountV152 = queryCountV152;
          grouped.sourceTypesV8 = Array.from(new Set(querySourcesV152));
        }
        grouped.wholeBuildingMembersV55.push(text(item.propertyId));
        grouped.unifiedDisplayOriginalsV2 = grouped.unifiedDisplayOriginalsV2.concat(item.unifiedDisplayOriginalsV2 || item.unifiedOriginalsV8 || []);
      }
    });
    result.forEach(function(item) {
      if (!item.wholeBuildingMembersV55 || item.wholeBuildingMembersV55.length < 2) return;
      item.wholeBuildingMembersV55.sort();
      if (item.queryRowV152) {item.unifiedOriginalCountV8 = item.queryMatchedOriginalCountV152;return;}
      var seen = new Set();
      item.unifiedDisplayOriginalsV2 = item.unifiedDisplayOriginalsV2.filter(function(original) {
        var id = text(original.originalId);
        if (seen.has(id)) return false;
        seen.add(id); return true;
      }).map(function(original) { return Object.assign({}, original, {displayGroupPropertyIdV55: text(item.propertyId)}); });
      // Photo, condition, memo and default detail all start from the same ad.
      item.unifiedDisplayOriginalsV2.sort(function(a, b) {
        return Number(text(b.propertyId) === text(item.propertyId)) - Number(text(a.propertyId) === text(item.propertyId));
      });
      item.unifiedOriginalsV8 = item.unifiedDisplayOriginalsV2;
      item.unifiedOriginalCountV8 = item.unifiedDisplayOriginalsV2.length;
      item.sourceTypesV8 = item.unifiedDisplayOriginalsV2.map(function(original) { return sourceKey(original.source); });
    });
    return result;
  }

  function detailMembersV55(propertyId) {
    var items = Array.isArray(global.currentItems) ? global.currentItems : [];
    var displayed = items.filter(function(item) { return text(item.propertyId) === text(propertyId); })[0];
    return displayed && displayed.wholeBuildingMembersV55 && displayed.wholeBuildingMembersV55.length > 1
      ? displayed.wholeBuildingMembersV55.slice() : [text(propertyId)];
  }

  // Reuse the strict whole-building proof, independently of sorting, source
  // filters or the selected original. Never associate private photos by an
  // unverified address, a lease, land, unit, floor, share or separated record.
  function invalidatePersonalCoverGroupsV86() {
    state.personalCoverGroupKeysV86 = Object.create(null);
    state.personalCoverGroupRevisionV86 += 1;
  }
  function personalCoverGroupKeyV86(propertyId) {
    var id = text(propertyId), master = resolveMasterItem(id);
    if (!master) return "";
    if (!Object.prototype.hasOwnProperty.call(state.personalCoverGroupKeysV86, id)) {
      var key = wholeBuildingKeyV55(master);
      state.personalCoverGroupKeysV86[id] = key ? "whole-building-sale:" + key : "";
    }
    return state.personalCoverGroupKeysV86[id];
  }

  function groupedRecordsHtmlV55(propertyId) {
    var members = detailMembersV55(propertyId);
    if (members.length < 2) return "";
    return '<details class="unified-group-records-v55"><summary>저장된 메모·확인 상태 (' + members.length + '개 기록)</summary>' +
      members.map(function(id) {
        var master = resolveMasterItem(id);
        if (!master) return "";
        return '<section><strong>' + esc(master.name || master.address) + ' · ' + esc(master.source) + '</strong>' +
          '<p>' + esc(text(master.state) === "계약완료" ? "계약완료" : text(master.state)==='보류'?'보류':typeof global.isConfirmedVisitItem === "function" && global.isConfirmedVisitItem(master) ? "확인" : "미확인") + '</p><p style="white-space:pre-wrap">' + esc(master.memo || "저장된 메모 없음") + '</p>' +
          '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'edit\', \'' + encodeURIComponent(id) + '\')">이 기록 수정</button></section>';
      }).join("") + '</details>';
  }

  function detailOriginals(originals, propertyId) {
    var visible = visibleOriginalsFrom(originals, propertyId);
    var projection = displayedOriginalProjection(propertyId);
    // Direct/manual listings can obtain their first original only from detail.
    // Without a rendered subset, keep the valid detail instead of deleting it.
    if (!projection || !projection.length) return visible;
    if (global.doneOnly) {
      var byId = Object.create(null), byIdentity = Object.create(null);
      visible.forEach(function(original) {
        byId[text(original.originalId)] = original;
        var identity = sourceIdentity(original);
        if (identity) byIdentity[identity] = Object.prototype.hasOwnProperty.call(byIdentity, identity) ? null : original;
      });
      return projection.map(function(original) {
        return byId[text(original.originalId)] || byIdentity[sourceIdentity(original)];
      }).filter(Boolean);
    }
    var allowed = new Set(projection.map(function(original) { return text(original.originalId); }));
    var identities = new Set(projection.map(sourceIdentity).filter(Boolean));
    return visible.filter(function(original) {
      return allowed.has(text(original.originalId)) || !!sourceIdentity(original) && identities.has(sourceIdentity(original));
    });
  }
  function originalRoomLabel(original) {
    var master = resolveMasterItem(original && original.propertyId);
    var facts = displayRoomFactsV129(master, original || {});
    return typeof global.formatListingRoomForCardV653 === "function"
      ? global.formatListingRoomForCardV653(facts.room, facts.floor)
      : text(facts.room);
  }
  function thumbnailImagesV119(original) {
    var values = [];
    if (original && Array.isArray(original.images)) values = original.images.slice();
    if (original && original.thumbnail && values.indexOf(original.thumbnail) < 0) values.unshift(original.thumbnail);
    values = values.map(text).filter(function(url, index, all) {
      return url && !/\/origin\/profile\//i.test(url) && !/\/avatars\//i.test(url) &&
        !/[?&]service=karrotauth(?:&|$)/i.test(url) &&
        all.indexOf(url) === index;
    });
    if (sourceKey(original && original.source) === "danggeun") {
      var hasInside = values.some(function(url) {
        return /\/realty\/realty\/articles\//i.test(url) && /[?&]t=inside(?:&|$)/i.test(url);
      });
      if (hasInside) values = values.filter(function(url) {
        return !(/\/realty\/realty\/articles\//i.test(url) && /[?&]t=crop(?:&|$)/i.test(url));
      });
    }
    return values;
  }
  function originalImages(original) {
    var packed = original && original.photoPathsV119;
    if (typeof packed !== "string" || packed.slice(0, 3) !== "v1\n" || !text(original.thumbnail)) return thumbnailImagesV119(original);
    var first = text(original.thumbnail), images = [first], valid = true;
    if (packed.length > 3) packed.slice(3).split("\n").forEach(function(line) {
      var split = line.indexOf(" "), prefix = Number(line.slice(0, split));
      if (split < 1 || !/^\d+$/.test(line.slice(0, split)) || prefix > first.length) { valid = false; return; }
      images.push(first.slice(0, prefix) + line.slice(split + 1));
    });
    return valid ? thumbnailImagesV119(Object.assign({}, original, {images: images})) : thumbnailImagesV119(original);
  }
  function originalImage(original) {
    // Sorting and list thumbnails must not decode every advertisement's full
    // path list. Decode only when its detail/gallery actually needs photos.
    return text(thumbnailImagesV119(original)[0]);
  }

  var PHOTO_LIST_STORAGE_V118 = "js-original-photo-lists-v118";
  var photoListOwnerV118 = "", photoListsV118 = {};
  function photoListKeyV118(original, propertyId) {
    return JSON.stringify([text(original && original.propertyId) || text(propertyId),
      text(original && original.originalId), text(original && original.source),
      text(original && original.thumbnail), Number(original && original.photoCount) || 0]);
  }
  function photoListsForAccountV118() {
    var owner = text(global.JSAuthenticatedAccountEmail).toLowerCase();
    if (photoListOwnerV118 !== owner) {
      photoListOwnerV118 = owner;
      photoListsV118 = {};
      if (owner) try {
        var saved = JSON.parse(global.localStorage.getItem(PHOTO_LIST_STORAGE_V118) || "null");
        if (saved && saved.owner === owner && saved.entries && typeof saved.entries === "object") photoListsV118 = saved.entries;
      } catch (_) {}
    }
    return photoListsV118;
  }
  function cachedPhotosV118(original, propertyId) {
    var cached = photoListsForAccountV118()[photoListKeyV118(original, propertyId)];
    return cached && cached.savedAt > Date.now() - 24 * 60 * 60 * 1000 && Array.isArray(cached.images)
      ? originalImages({source: original && original.source, images: cached.images}) : [];
  }
  function rememberPhotosV118(original, propertyId, images) {
    if (!original || !text(original.originalId) || images.length < 2) return;
    var cache = photoListsForAccountV118();
    cache[photoListKeyV118(original, propertyId)] = {savedAt: Date.now(), images: images.slice(0, 150)};
    var keys = Object.keys(cache).sort(function(a, b) { return cache[b].savedAt - cache[a].savedAt; });
    keys.slice(60).forEach(function(key) { delete cache[key]; });
    if (photoListOwnerV118) try {
      var serialized = JSON.stringify({owner: photoListOwnerV118, entries: cache});
      if (serialized.length <= 512 * 1024) global.localStorage.setItem(PHOTO_LIST_STORAGE_V118, serialized);
    } catch (_) {} // Storage failure must never prevent photo navigation.
  }
  function clearPhotoListsV118() {
    clearPreparedPhotosV120();
    photoListOwnerV118 = "";
    photoListsV118 = {};
    try { global.localStorage.removeItem(PHOTO_LIST_STORAGE_V118); } catch (_) {}
  }

  function thumbnailProxyUrl(url) {
    try {
      var parsed = new URL(text(url));
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port &&
          /^(?:img\.kr\.gcp-karroter\.net|landthumb-phinf\.pstatic\.net|dnvefa72aowie\.cloudfront\.net|file1\.gongsilbox\.com)$/i.test(parsed.hostname)) {
        return "/api/listing-image?url=" + encodeURIComponent(parsed.toString());
      }
    } catch (ignore) {}
    return "";
  }

  function thumbnailDisplayImageUrlV69(url) {
    var value = text(url);
    try {
      var parsed = new URL(value);
      // These providers already supply a size/quality image transform. Keep
      // identity, crop mode and the saved original URL intact. Other providers
      // do not accept these parameters and must retain their exact URL.
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port &&
          /^(?:img\.kr\.gcp-karroter\.net|dnvefa72aowie\.cloudfront\.net)$/i.test(parsed.hostname) &&
          /^\d+x\d+$/.test(parsed.searchParams.get('s') || '')) {
        var dimensions = parsed.searchParams.get('s').split('x').map(Number);
        if (Math.max.apply(Math, dimensions) > 320) {
          parsed.searchParams.set('s', '320x320');
          parsed.searchParams.set('q', '80');
          return parsed.toString();
        }
      }
    } catch (_) {}
    return value;
  }

  var thumbnailObserverV69 = null, thumbnailObserverRootV69 = null;
  function prepareListThumbnailsV69() {
    var list = document.getElementById('list');
    if (!list || typeof list.querySelectorAll !== 'function') return;
    if (thumbnailObserverV69) thumbnailObserverV69.disconnect();
    var images = list.querySelectorAll('.unified-thumb-v8 img[data-thumbnail-pending-v69]');
    function activate(image, priority) {
      var source = image.getAttribute('data-thumbnail-pending-v69');
      if (!source) return;
      image.removeAttribute('data-thumbnail-pending-v69');
      image.setAttribute('fetchpriority', priority || 'auto');
      image.src = source;
    }
    if (typeof global.IntersectionObserver !== 'function') {
      images.forEach(function(image) { activate(image); });
      return;
    }
    var root = typeof global.getListingScrollContainerV2 === 'function'
      ? global.getListingScrollContainerV2() : document.getElementById('sidebar');
    if (!thumbnailObserverV69 || thumbnailObserverRootV69 !== root) {
      thumbnailObserverRootV69 = root;
      try {
        var observer = new global.IntersectionObserver(function(entries) {
          if (thumbnailObserverV69 !== observer) return;
          var prioritized = 0;
          entries.forEach(function(entry) {
            if (!entry.isIntersecting || !entry.target.isConnected || !list.contains(entry.target)) return;
            observer.unobserve(entry.target);
            activate(entry.target, prioritized++ < 2 ? 'high' : 'auto');
          });
        }, {root: root, rootMargin: '160px 0px', threshold: 0});
        thumbnailObserverV69 = observer;
      } catch (_) {
        thumbnailObserverV69 = null;
        images.forEach(function(image) { activate(image); });
        return;
      }
    }
    // Only the small virtual window is observed; disconnecting on window reuse
    // releases detached cards and never retains a full list of image nodes.
    images.forEach(function(image) { thumbnailObserverV69.observe(image); });
  }

  /*
   * 상세창 폭보다 훨씬 큰 당근 1440px 원본은 전환할 때마다 수신 시간이 길었습니다.
   * 상세/확대 보기에는 선명도가 충분한 960px 이미지를 사용하고 원본 링크는 그대로 보존합니다.
   */
  function detailDisplayImageUrl(url) {
    var value = text(url);
    if (!value) return "";
    if (/img\.kr\.gcp-karroter\.net/i.test(value)) {
      value = value.replace(/([?&])q=\d+/i, "$1q=88");
      value = value.replace(/([?&])s=\d+x\d+/i, "$1s=960x960");
    }
    // Display and adjacent preloads share the CDN URL. The image loader owns
    // a bounded intermediary recovery; do not put every photo behind it.
    return value;
  }

  function preloadDetailImage(url, highPriority) {
    var source = detailDisplayImageUrl(url);
    if (!source) return null;
    if (state.photoPreloads[source]) {
      state.photoPreloads[source].touched = Date.now();
      if (highPriority) {
        state.photoPreloads[source].priority = 1;
        try { state.photoPreloads[source].image.fetchPriority = "high"; } catch (ignore) {}
      }
      return state.photoPreloads[source].image;
    }

    var preload = new Image();
    preload.decoding = "async";
    preload.referrerPolicy = "no-referrer";
    try { preload.fetchPriority = highPriority ? "high" : "low"; } catch (ignore) {}
    // Keep only a tiny decoded working set, rather than discarding the prepared
    // node and asking a second node to load/decode the same image on each click.
    var entry = {image: preload, ready: false, pixels: 0, priority: highPriority ? 1 : 0, touched: Date.now()};
    state.photoPreloads[source] = entry;
    trimPreparedPhotosV120();
    if (state.photoPreloads[source] !== entry) return null;
    preload.onload = function() {
      preload.onload = null;
      preload.onerror = null;
      var decoded = typeof preload.decode === "function" ? preload.decode() : Promise.resolve();
      decoded.then(function() {
        if (state.photoPreloads[source] !== entry) return;
        entry.ready = !!preload.naturalWidth;
        entry.pixels = preload.naturalWidth * preload.naturalHeight;
        if (entry.pixels > 4_000_000) return discardPreparedPhotoV120(source, entry);
        trimPreparedPhotosV120();
      }).catch(function() { discardPreparedPhotoV120(source, entry); });
    };
    preload.onerror = function() {
      discardPreparedPhotoV120(source, entry);
    };
    preload.src = source;
    return preload;
  }

  function discardPreparedPhotoV120(source, entry) {
    if (state.photoPreloads[source] !== entry) return;
    delete state.photoPreloads[source];
    entry.image.onload = entry.image.onerror = null;
    if (!entry.image.isConnected) entry.image.removeAttribute("src");
  }

  function trimPreparedPhotosV120() {
    var keys = Object.keys(state.photoPreloads).sort(function(a, b) {
      return state.photoPreloads[a].priority - state.photoPreloads[b].priority ||
        state.photoPreloads[a].touched - state.photoPreloads[b].touched;
    });
    var pixels = keys.reduce(function(sum, key) { return sum + state.photoPreloads[key].pixels; }, 0);
    // At most four nodes and four million retained decoded pixels (~16 MB).
    // Oversized photos still use the existing browser/network loading path.
    while (keys.length > 4 || pixels > 4_000_000) {
      var key = keys.shift(), entry = state.photoPreloads[key];
      pixels -= entry.pixels;
      discardPreparedPhotoV120(key, entry);
    }
  }

  function clearPreparedPhotosV120() {
    Object.keys(state.photoPreloads).forEach(function(key) {
      discardPreparedPhotoV120(key, state.photoPreloads[key]);
    });
  }

  function showPreparedPhotoV120(container, index, render) {
    var images = container && container._imagesV8 || [];
    var safeIndex = wrapPhotoIndexV8141(index, images.length);
    var source = safeIndex === 0 ? text(images[safeIndex]) : detailDisplayImageUrl(images[safeIndex]);
    var entry = state.photoPreloads[source], previous = container && container.querySelector("img");
    if (!previous || !entry || !entry.ready || !entry.image.complete || !entry.image.naturalWidth) return false;
    cancelPhotoTransitionV1(container, true);
    delete state.photoPreloads[source];
    Array.prototype.forEach.call(previous.attributes, function(attribute) {
      if (attribute.name !== "src") entry.image.setAttribute(attribute.name, attribute.value);
    });
    previous.replaceWith(entry.image);
    previous.onload = previous.onerror = null;
    previous.removeAttribute("src");
    render(container, safeIndex);
    detailImageLoaded(entry.image);
    return true;
  }

  function adoptPendingPhotoV124(container, source) {
    var entry = state.photoPreloads[source], previous = container && container.querySelector("img");
    if (!entry || !previous || entry.image === previous) return previous;
    // A next-photo click can arrive before decode finishes. Keep the exact
    // in-flight node instead of starting the same URL again on another Image.
    delete state.photoPreloads[source];
    entry.image.onload = entry.image.onerror = null;
    if (previous._photoLoadCleanupV114) previous._photoLoadCleanupV114();
    Array.prototype.forEach.call(previous.attributes, function(attribute) {
      if (attribute.name !== "src") entry.image.setAttribute(attribute.name, attribute.value);
    });
    previous.replaceWith(entry.image);
    previous.onload = previous.onerror = null;
    previous.removeAttribute("src");
    return entry.image;
  }

  function apiGet(action, params, force) {
    if (!global.JSDataAccessV6 || typeof global.JSDataAccessV6.read !== "function") {
      return Promise.reject(new Error("공통 데이터 연결이 준비되지 않았습니다."));
    }
    var options = { errorMessage: "운영자료 조회 실패" };
    if (force) {
      options.cache = "reload";
      options.headers = {"X-JS-Force-Refresh": "1"};
    }
    return global.JSDataAccessV6.read(action, params, options).catch(function(error) {
      if (global.JSLocalMetricsV1) global.JSLocalMetricsV1.error("read");
      throw error;
    });
  }

  function needsDetail(originals, originalId) {
    originals = orderOriginals(originals);
    var selected = originals.filter(function(original) {
      return text(original.originalId) === text(originalId);
    })[0] || originals[0];
    if (!selected) return false;
    if (selected.tradeType === "sale" && !selected.saleDetails && !selected.masterFallback) return true;
    var imageCount = originalImages(selected).length;
    var declaredCount = Math.max(0, Number(selected.photoCount) || 0);
    if (!imageCount && !declaredCount) return false;
    return imageCount < Math.max(1, declaredCount);
  }

  function primeDetailImages(originals, originalId) {
    if (global.navigator && global.navigator.connection && global.navigator.connection.saveData) return;
    var ordered = orderOriginals(originals);
    var selected = ordered.filter(function(original) { return text(original.originalId) === text(originalId); })[0] || ordered[0];
    var images = originalImages(selected);
    if (images.length < 2) return;
    /* 상세를 열기 전 다음 장과 순환 이전 장을 함께 준비합니다. */
    [images[1], images[images.length - 1]].forEach(function(url, index, values) {
      if (url && values.indexOf(url) === index) preloadDetailImage(url, index === 0);
    });
  }

  function wrapPhotoIndexV8141(index, length) {
    var total = Math.max(0, Number(length) || 0);
    if (!total) return 0;
    return ((Number(index) || 0) % total + total) % total;
  }

  function preloadAdjacentDetailImages(images, index) {
    if (!Array.isArray(images) || images.length < 2) return;
    var safeIndex = wrapPhotoIndexV8141(index, images.length);
    var candidates = [
      images[(safeIndex + 1) % images.length],
      images[(safeIndex - 1 + images.length) % images.length]
    ];
    candidates.forEach(function(url, candidateIndex) {
      if (url && candidates.indexOf(url) === candidateIndex) preloadDetailImage(url, candidateIndex === 0);
    });
  }

  function bindPhotoSwipe(element, onStep) {
    if (!element || element._photoSwipeBoundV8 || typeof onStep !== "function") return;
    element._photoSwipeBoundV8 = true;
    var gesture = null;

    function resetGesture(immediate) {
      var image = element.querySelector("img");
      if (image) {
        image.style.transition = immediate ? "none" : "transform 180ms cubic-bezier(.22,.8,.35,1)";
        image.style.transform = "";
        image.style.opacity = "";
        global.setTimeout(function() {
          if (image) image.style.transition = "";
        }, immediate ? 0 : 200);
      }
      element.classList.remove("is-photo-dragging-v8");
      gesture = null;
    }

    element.addEventListener("pointerdown", function(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target && event.target.closest(".unified-detail-photo-nav-v8,.unified-gallery-nav-v8,.unified-photo-download-v73,.photo-load-status-v114,.close")) return;
      if (element._photoTransitionCleanupV1) element._photoTransitionCleanupV1(true);
      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        deltaX: 0,
        horizontal: false,
        captureTarget: event.target
      };
      /* 부모가 포인터를 잡으면 실제 사진 button의 click 대상이 부모로 바뀌므로 누른 요소가 직접 잡습니다. */
      var captureTarget = event.target && typeof event.target.setPointerCapture === "function"
        ? event.target : element;
      gesture.captureTarget = captureTarget;
      if (typeof captureTarget.setPointerCapture === "function") {
        try { captureTarget.setPointerCapture(event.pointerId); } catch (ignore) {}
      }
    });

    element.addEventListener("pointermove", function(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      var deltaX = event.clientX - gesture.startX;
      var deltaY = event.clientY - gesture.startY;
      if (!gesture.horizontal && Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      if (!gesture.horizontal && Math.abs(deltaY) > Math.abs(deltaX)) {
        resetGesture();
        return;
      }
      gesture.horizontal = true;
      gesture.deltaX = deltaX;
      event.preventDefault();
      element.classList.add("is-photo-dragging-v8");
      var image = element.querySelector("img");
      if (image) {
        image.style.transition = "none";
        image.style.transform = "translate3d(" + Math.round(deltaX * 0.32) + "px,0,0)";
        image.style.opacity = String(Math.max(.68, 1 - Math.abs(deltaX) / 420));
      }
    });

    function finish(event) {
      if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
      var deltaX = gesture.deltaX;
      var changed = gesture.horizontal && Math.abs(deltaX) >= 42;
      if (changed) {
        /* 드래그 직후 브라우저가 만드는 합성 click 한 번만 막고, 다음 실제 클릭은 즉시 허용합니다. */
        element._suppressNextPhotoClickV8140 = true;
        if (element._photoClickReleaseTimerV8140) global.clearTimeout(element._photoClickReleaseTimerV8140);
        element._photoClickReleaseTimerV8140 = global.setTimeout(function() {
          element._suppressNextPhotoClickV8140 = false;
          element._photoClickReleaseTimerV8140 = null;
        }, 180);
        resetGesture(true);
        onStep(deltaX < 0 ? 1 : -1);
        return;
      }
      resetGesture();
    }

    element.addEventListener("pointerup", finish);
    element.addEventListener("pointercancel", resetGesture);
    element.addEventListener("lostpointercapture", function() {
      if (gesture) resetGesture();
    });
    element.addEventListener("click", function(event) {
      if (!element._suppressNextPhotoClickV8140) return;
      element._suppressNextPhotoClickV8140 = false;
      if (element._photoClickReleaseTimerV8140) {
        global.clearTimeout(element._photoClickReleaseTimerV8140);
        element._photoClickReleaseTimerV8140 = null;
      }
      event.preventDefault();
      event.stopPropagation();
    }, true);
    element.addEventListener("dragstart", function(event) { event.preventDefault(); });
  }

  function cancelPhotoTransitionV1(container, disposeLoad) {
    var image = container && container.querySelector("img");
    if (disposeLoad && image && image._photoLoadCleanupV114) image._photoLoadCleanupV114();
    if (container && container._photoTransitionCleanupV1) container._photoTransitionCleanupV1();
    if (disposeLoad && container && container._photoTransitionGhostV1) {
      container._photoTransitionGhostV1.remove();
      delete container._photoTransitionGhostV1;
    }
  }

  // Own the image request separately from the short crossfade animation. A
  // slow or failed destination must not erase the last decoded photo.
  function loadPhotoV114(container, image, source, originalSource) {
    if (image._photoLoadCleanupV114) image._photoLoadCleanupV114();
    var photoStartedV124 = Date.now();
    container.setAttribute("data-photo-ready-ms", "pending");
    var notice = container.querySelector(".photo-load-status-v114");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "photo-load-status-v114";
      notice.setAttribute("role", "status");
      container.appendChild(notice);
    }
    var timer = null, hedgeTimer = null, probe = null, disposed = false;
    var finished = false, primaryFailed = false, alternateFailed = false, usingAlternate = false;
    var attempted = source;
    var alternate = thumbnailProxyUrl(source);
    if (!alternate && source !== originalSource) alternate = originalSource;
    if (alternate === source) alternate = "";
    function status(failed) {
      notice.hidden = false;
      notice.textContent = failed ? "사진을 불러오지 못했습니다. " : "사진 불러오는 중…";
      if (failed) {
        var retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "다시 시도";
        retry.onclick = function(event) {
          event.stopPropagation();
          loadPhotoV114(container, image, source, originalSource);
        };
        notice.appendChild(retry);
      }
    }
    function current() {
      return !disposed && image.isConnected && container.isConnected &&
        image.getAttribute("src") === attempted;
    }
    function stopProbe() {
      if (!probe) return;
      probe.onload = null;
      probe.onerror = null;
      probe.removeAttribute("src");
      probe = null;
    }
    function stopWaiting() {
      if (timer) global.clearTimeout(timer);
      if (hedgeTimer) global.clearTimeout(hedgeTimer);
      timer = hedgeTimer = null;
      stopProbe();
    }
    function loaded() {
      if (!current() || !image.complete || !image.naturalWidth) return;
      finished = true;
      stopWaiting();
      container.setAttribute("data-photo-ready-ms", String(Date.now() - photoStartedV124));
      notice.hidden = true;
      if (!container._photoTransitionCleanupV1 && container._photoTransitionGhostV1) {
        container._photoTransitionGhostV1.remove();
        delete container._photoTransitionGhostV1;
      }
    }
    function unavailable() {
      if (!current()) return cleanup();
      finished = true;
      stopWaiting();
      if (container._photoTransitionCleanupV1) container._photoTransitionCleanupV1(true);
      status(true);
    }
    function startAlternate() {
      if (!current() || finished || !alternate || probe || alternateFailed || usingAlternate) return;
      // Keep the original request alive: whichever route supplies this exact
      // photo first wins. One bounded probe belongs only to this selected image.
      probe = new Image();
      probe.decoding = "async";
      probe.referrerPolicy = "no-referrer";
      try { probe.fetchPriority = "high"; } catch (ignore) {}
      probe.onload = function() {
        if (!current() || finished) return stopProbe();
        if (image.complete && image.naturalWidth) return loaded();
        if (!probe.naturalWidth) return alternateError();
        usingAlternate = true;
        attempted = alternate;
        stopProbe();
        image.src = attempted;
        if (image.complete && image.naturalWidth) loaded();
      };
      function alternateError() {
        alternateFailed = true;
        stopProbe();
        if (primaryFailed && !finished) unavailable();
      }
      probe.onerror = alternateError;
      probe.src = alternate;
    }
    function failed() {
      if (!current() || finished) return;
      if (usingAlternate) return unavailable();
      primaryFailed = true;
      startAlternate();
      if (!alternate || alternateFailed) unavailable();
    }
    function cleanup() {
      disposed = true;
      stopWaiting();
      image.removeEventListener("load", loaded);
      image.removeEventListener("error", failed);
      if (image._photoLoadCleanupV114 === cleanup) delete image._photoLoadCleanupV114;
      notice.hidden = true;
    }
    image._photoLoadCleanupV114 = cleanup;
    image.addEventListener("load", loaded);
    image.addEventListener("error", failed);
    if (image.getAttribute("src") === source && image.complete && image.naturalWidth) loaded();
    else {
      status(false);
      timer = global.setTimeout(unavailable, 15000);
      if (alternate) hedgeTimer = global.setTimeout(startAlternate, 1200);
      if (image.getAttribute("src") !== source) image.src = source;
      if (image.complete && image.naturalWidth) loaded();
    }
  }

  function transitionPhotoV8140(container, direction, commit) {
    var image = container && container.querySelector("img");
    var step = Number(direction || 0) < 0 ? -1 : 1;
    var reduceMotion = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!image) { commit(); return; }
    var canAnimate = typeof image.animate === "function" && !reduceMotion;
    // Keep at most one outgoing frame. Rapid input advances the index once per
    // click and retargets the animation rather than restarting a delayed commit.
    if (container._photoTransitionCleanupV1) container._photoTransitionCleanupV1(true);
    var ghost = container._photoTransitionGhostV1;
    if (!ghost && image.complete && image.naturalWidth) {
      ghost = document.createElement("span");
      ghost.className = "photo-transition-ghost-v1";
      ghost.setAttribute("aria-hidden", "true");
      var appearance = global.getComputedStyle(image);
      Object.assign(ghost.style, {
        position: "absolute", left: image.offsetLeft + "px", top: image.offsetTop + "px", bottom: "auto",
        width: image.offsetWidth + "px", height: image.offsetHeight + "px", display: "block", margin: "0", padding: "0",
        backgroundImage: "url(" + JSON.stringify(image.currentSrc || image.src) + ")",
        backgroundSize: appearance.objectFit === "cover" ? "cover" : "contain",
        backgroundPosition: appearance.objectPosition, backgroundRepeat: "no-repeat",
        borderRadius: appearance.borderRadius, pointerEvents: "none", opacity: "1"
      });
      image.parentNode.insertBefore(ghost, image.nextSibling);
      container._photoTransitionGhostV1 = ghost;
    }
    var token = Number(container._photoTransitionTokenV8140 || 0) + 1;
    container._photoTransitionTokenV8140 = token;
    var incoming = null, outgoing = null, finished = false, started = false;
    function cleanup(preserveFrame) {
      if (finished) return;
      finished = true;
      image.removeEventListener("load", start);
      image.removeEventListener("error", fail);
      if (ghost && preserveFrame) {
        var current = global.getComputedStyle(ghost);
        ghost.style.opacity = current.opacity;
        ghost.style.transform = current.transform;
      }
      if (incoming) incoming.cancel();
      if (outgoing) outgoing.cancel();
      image.style.opacity = "";
      image.style.transform = "";
      image.style.transition = "";
      if (ghost && !preserveFrame) {
        ghost.remove();
        if (container._photoTransitionGhostV1 === ghost) delete container._photoTransitionGhostV1;
      }
      if (container._photoTransitionCleanupV1 === cleanup) delete container._photoTransitionCleanupV1;
    }
    function fail() { if (!image._photoLoadCleanupV114) cleanup(); }
    function start() {
      if (finished || started || container._photoTransitionTokenV8140 !== token) return;
      started = true;
      if (!image.isConnected || !container.isConnected || !canAnimate) return cleanup();
      var options = {duration: 380, easing: "cubic-bezier(.22,.61,.36,1)", fill: "both"};
      incoming = image.animate([
        {transform: "translate3d(" + (step * 16) + "px,0,0)", opacity: .85},
        {transform: "translate3d(0,0,0)", opacity: 1}
      ], options);
      if (ghost) outgoing = ghost.animate([
        {transform: ghost.style.transform || "translate3d(0,0,0)", opacity: Number(ghost.style.opacity || 1)},
        {transform: "translate3d(" + (-step * 12) + "px,0,0)", opacity: 0}
      ], options);
      Promise.all([incoming.finished, outgoing && outgoing.finished]).catch(function() {}).then(function() {
        if (container._photoTransitionTokenV8140 === token) cleanup();
      });
    }
    container._photoTransitionCleanupV1 = cleanup;
    image.style.transition = "none";
    image.style.transform = "";
    // The loaded old frame stays visible until the destination is available.
    if (ghost) image.style.opacity = "0";
    commit();
    // The renderer may adopt an already downloading adjacent Image. Bind the
    // transition to that live node, never to the outgoing detached image.
    image = container.querySelector("img") || image;
    image.style.transition = "none";
    if (ghost) image.style.opacity = "0";
    image.addEventListener("load", start, {once: true});
    image.addEventListener("error", fail, {once: true});
    if (finished) return;
    if (image.complete && image.naturalWidth) start();
    // loadPhotoV114 owns bounded request failure/retry; never drop a decoded
    // frame just because the network took longer than the animation.
  }

  function detailIsFresh(propertyId) {
    return Object.prototype.hasOwnProperty.call(state.detailCache, propertyId) &&
      Number.isFinite(state.detailCachedAt[propertyId]) &&
      Date.now() - state.detailCachedAt[propertyId] >= 0 &&
      Date.now() - state.detailCachedAt[propertyId] < DETAIL_CACHE_TTL;
  }

  function invalidateDetails() {
    state.detailGeneration += 1;
    state.detailRequestToken += 1;
    state.detailCache = {};
    state.detailCachedAt = {};
    state.detailRetryAt = {};
    state.detailPending = {};
    state.detailPendingForced = {};
    state.detailStatus = {};
    state.detailRefreshRetries = {};
  }

  function loadDetail(propertyId, force) {
    var members = detailMembersV55(propertyId);
    if (members.length < 2) return loadSingleDetailV55(propertyId, force);
    // At most three requests at once; a failed member never produces a
    // supposedly complete group. Each member retains its own cache/proof.
    var output = new Array(members.length), cursor = 0;
    function next() {
      var index = cursor++;
      if (index >= members.length) return Promise.resolve();
      return loadSingleDetailV55(members[index], force).then(function(originals) {
        output[index] = originals.map(function(original) { return Object.assign({}, original, {displayGroupPropertyIdV55: text(propertyId)}); });
        return next();
      });
    }
    return Promise.all(members.slice(0, 3).map(next)).then(function() { return orderOriginals([].concat.apply([], output)); });
  }

  function loadSingleDetailV55(propertyId, force) {
    propertyId = text(propertyId);
    if (!propertyId) return Promise.resolve([]);
    if (!force && detailIsFresh(propertyId)) {
      return Promise.resolve(state.detailCache[propertyId]);
    }
    if (state.detailPending[propertyId]) {
      if (!force || state.detailPendingForced[propertyId]) return state.detailPending[propertyId];
      // A normal hover prefetch may still be using R2. Its promise is not a
      // cache-bypassing verification, so wait and send one actual forced read.
      return state.detailPending[propertyId].catch(function() {}).then(function() { return loadSingleDetailV55(propertyId, true); });
    }
    if (!force && state.detailCache[propertyId] && Date.now() < Number(state.detailRetryAt[propertyId] || 0)) {
      return Promise.resolve(state.detailCache[propertyId]);
    }
    var generation = state.detailGeneration;
    var propertyGeneration = Number(state.detailPropertyGeneration[propertyId]) || 0;
    var request = apiGet("unifiedListingDetail", {propertyId: propertyId}, force).then(function(result) {
      if (!result || result.ok === false || !Array.isArray(result.originals)) {
        throw new Error(result && result.message || "매물 상세 응답을 확인하지 못했습니다.");
      }
      var originals = orderOriginals(result.originals || []);
      if (generation !== state.detailGeneration || propertyGeneration !== (Number(state.detailPropertyGeneration[propertyId]) || 0)) return originals;
      if (originals.length) {
        originals.forEach(function(original) { rememberPhotosV118(original, propertyId, originalImages(original)); });
        state.detailCache[propertyId] = originals;
        state.detailCachedAt[propertyId] = Date.now();
      } else {
        // An empty response does not prove that a CSV card has no sources.
        // Do not turn a transient mismatch into a five-minute empty cache.
        delete state.detailCache[propertyId];
        delete state.detailCachedAt[propertyId];
      }
      delete state.detailRetryAt[propertyId];
      if (state.detailPending[propertyId] === request) {
        delete state.detailPending[propertyId];
        delete state.detailPendingForced[propertyId];
      }
      primeDetailImages(visibleOriginalsFrom(originals, propertyId));
      return originals;
    }).catch(function(error) {
      if (generation === state.detailGeneration && propertyGeneration === (Number(state.detailPropertyGeneration[propertyId]) || 0)) {
        state.detailRetryAt[propertyId] = Date.now() + DETAIL_RETRY_DELAY;
      }
      if (state.detailPending[propertyId] === request) {
        delete state.detailPending[propertyId];
        delete state.detailPendingForced[propertyId];
      }
      throw error;
    });
    state.detailPending[propertyId] = request;
    state.detailPendingForced[propertyId] = !!force;
    return request;
  }

  function prefetch(encodedPropertyId, encodedOriginalId) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var originalId = decodeURIComponent(encodedOriginalId || "");
    var originals = group(propertyId);
    // Metadata can already contain every URL. Still start the next file when
    // the user points at/focuses/touches this card, before the detail opens.
    primeDetailImages(originals, originalId);
    if (!desktop() || !needsDetail(originals, originalId)) return Promise.resolve(originals);
    return loadDetail(propertyId).catch(function(error) {
      console.warn("상세 사진 선행 조회 실패", propertyId, error);
      return [];
    });
  }

  function scheduleDetailWarmup(items) {
    if (state.detailWarmupTimer && typeof global.clearTimeout === "function") {
      global.clearTimeout(state.detailWarmupTimer);
    }
    state.detailWarmupTimer = 0;
    state.detailWarmupIds = [];
    /*
     * 초기 목록 진입만으로 상세 8건과 사진 수십 장을 받지 않습니다.
     * 카드 hover/focus/pointerdown과 실제 상세 열기만 loadDetail을 시작합니다.
     */
    return items || [];
  }

  function scheduleContactWarmup(items) {
    var seen = {};
    state.contactWarmupIds = (items || []).filter(function(item) {
      var propertyId = text(item && item.propertyId);
      if (!propertyId || seen[propertyId] || Number(item && item.gongsilContactCountV8) <= 0 ||
          state.contactCache[propertyId] || state.contactPending[propertyId]) return false;
      seen[propertyId] = true;
      return true;
    }).map(function(item) { return text(item.propertyId); }).slice(0, 4);
    if (typeof global.setTimeout !== "function") return;
    if (state.contactWarmupTimer && typeof global.clearTimeout === "function") {
      global.clearTimeout(state.contactWarmupTimer);
    }
    if (!state.contactWarmupIds.length) return;
    state.contactWarmupTimer = global.setTimeout(function() {
      var ids = state.contactWarmupIds.slice();
      var cursor = 0;
      function worker() {
        if (cursor >= ids.length) return;
        var propertyId = ids[cursor++];
        loadContacts(propertyId).catch(function(error) {
          console.warn("연락처 유휴 조회 실패", propertyId, error);
        }).then(worker);
      }
      worker();
      if (ids.length > 1) global.setTimeout(worker, 140);
    }, 450);
  }

  function originalLoadStatus() {
    if (typeof document === "undefined") return;
    var banner = document.getElementById("unifiedOriginalLoadStatusV1");
    if (banner) banner.remove();
  }

  function expandUnifiedResult(result) {
    if (!result || result.ok === false || !result.groups || typeof result.groups !== "object" || Array.isArray(result.groups)) {
      throw new Error(result && result.message || "원본 매물 응답을 확인하지 못했습니다.");
    }
    var compact = /^compact-v\d+$/.test(result.format || "");
    if (compact && !Array.isArray(result.fields)) throw new Error("원본 매물 항목을 확인하지 못했습니다.");
    var expanded = {};
    Object.keys(result.groups).forEach(function(propertyId) {
      if (!Array.isArray(result.groups[propertyId])) throw new Error("원본 매물 목록을 확인하지 못했습니다.");
      expanded[propertyId] = result.groups[propertyId].map(function(values) {
        if (!compact) {
          if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("원본 매물 항목을 확인하지 못했습니다.");
          return values;
        }
        if (!Array.isArray(values)) throw new Error("원본 매물 항목을 확인하지 못했습니다.");
        var original = {propertyId: propertyId};
        result.fields.forEach(function(field, index) { original[field] = values[index]; });
        return original;
      });
    });
    return Object.assign({}, result, {groups: expanded, format: compact ? "expanded-v2" : result.format});
  }

  function invalidatePendingLoad() {
    state.loadGeneration += 1;
    state.loadPending = null;
    if (global.JSDataAccessV6 && typeof global.JSDataAccessV6.invalidateRead === "function") {
      global.JSDataAccessV6.invalidateRead("unifiedListings");
    }
  }

  async function expandNetworkResultV68(result) {
    if (!result || !/^compact-v\d+$/.test(result.format || '')) return expandUnifiedResult(result);
    if (result.ok === false || !Array.isArray(result.fields) || !result.groups ||
        typeof result.groups !== 'object' || Array.isArray(result.groups)) throw new Error('원본 매물 응답을 확인하지 못했습니다.');
    var ids = Object.keys(result.groups), started = Date.now(), count = 0;
    // This network result has a single consumer. Replace each compact row as
    // it is expanded so both representations never accumulate in full. State
    // is committed only after all rows and the load generation are validated.
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], rows = result.groups[id];
      if (!Array.isArray(rows)) throw new Error('원본 매물 목록을 확인하지 못했습니다.');
      for (var j = 0; j < rows.length; j++) {
        var values = rows[j];
        if (!Array.isArray(values)) throw new Error('원본 매물 항목을 확인하지 못했습니다.');
        var original = {propertyId: id};
        for (var k = 0; k < result.fields.length; k++) original[result.fields[k]] = values[k];
        rows[j] = original;
        if (++count % 128 === 0 && Date.now() - started >= 12 && typeof global.setTimeout === 'function') {
          await new Promise(function(resolve) { global.setTimeout(resolve, 0); });
          started = Date.now();
        }
      }
    }
    result.format = 'expanded-v2';
    return result;
  }

  function mergeScoped(result) {
    var expanded;
    try { expanded = expandUnifiedResult(result); } catch (_) { return false; }
    invalidatePendingLoad();
    var merged = Object.assign({}, state.groups);
    var searchIds = Object.assign({}, state.sourceSearchIds);
    Object.keys(expanded.groups).forEach(function(propertyId) {
      merged[propertyId] = expanded.groups[propertyId];
      delete state.sourceSnapshotProofKeys[propertyId];
      searchIds[propertyId] = (expanded.sourceSearchIds && expanded.sourceSearchIds[propertyId] || []).slice();
      state.detailPropertyGeneration[propertyId] = (Number(state.detailPropertyGeneration[propertyId]) || 0) + 1;
      delete state.detailCache[propertyId];
      delete state.detailCachedAt[propertyId];
      delete state.detailRetryAt[propertyId];
      delete state.detailPending[propertyId];
      delete state.contactCache[propertyId];
      delete state.contactPending[propertyId];
      if (state.openPropertyId === propertyId) state.detailRequestToken += 1;
    });
    state.groups = merged;
    state.sourceSearchIds = searchIds;
    adoptOpenPhotoPathsV119();
    // A scoped response is not a complete snapshot; never advertise its revision
    // as the revision of all original groups or mark a partial first load full.
    state.snapshotRevision = "";
    return true;
  }

  function attachCompatible(items, result, options) {
    var expanded = null;
    try { expanded = expandUnifiedResult(result); } catch (_) {}
    var keys = expanded && expanded.sourceSnapshotKeys;
    var propertyIds = expanded && expanded.sourceSnapshotPropertyIds;
    var supported = !!(keys && typeof keys === "object" && !Array.isArray(keys) &&
      propertyIds && typeof propertyIds === "object" && !Array.isArray(propertyIds));
    var own = Object.prototype.hasOwnProperty;
    var byPublicId = Object.create(null), duplicatePublicIds = Object.create(null), itemCounts = Object.create(null);
    var inputItems = Array.isArray(items) ? items : [];
    var matchedIds = [], inputIds = [], rejected = Object.create(null), accepted = [];
    inputItems.forEach(function(item) {
      var id = text(item && item.propertyId);
      if (!id) return;
      if (!itemCounts[id]) inputIds.push(id);
      itemCounts[id] = (itemCounts[id] || 0) + 1;
    });
    if (supported) Object.keys(propertyIds).forEach(function(internalId) {
      var publicId = propertyIds[internalId];
      if (!internalId || internalId !== text(internalId) || typeof publicId !== "string" || !publicId || publicId !== text(publicId)) return;
      if (own.call(byPublicId, publicId)) duplicatePublicIds[publicId] = true;
      else byPublicId[publicId] = internalId;
    });
    var merged = Object.assign(Object.create(null), state.groups), searchIds = Object.assign(Object.create(null), state.sourceSearchIds);
    inputItems.forEach(function(item) {
      var publicId = text(item && item.propertyId), internalId = byPublicId[publicId];
      if (!publicId || rejected[publicId]) return;
      var proof = item && item.sourceSnapshotKey;
      var rows = supported && internalId && own.call(expanded.groups, internalId) ? expanded.groups[internalId] : null;
      var search = supported && internalId && expanded.sourceSearchIds && expanded.sourceSearchIds[internalId];
      var valid = supported && itemCounts[publicId] === 1 && !duplicatePublicIds[publicId] &&
        typeof proof === "string" && /^sha256-v1:[a-f0-9]{64}$/.test(proof) &&
        own.call(keys, internalId) && keys[internalId] === proof && Array.isArray(rows) &&
        (search == null || Array.isArray(search) && search.every(function(value) { return typeof value === "string"; })) &&
        rows.every(function(original) {
          return typeof original.propertyId === "string" && (original.propertyId === internalId || original.propertyId === publicId);
        });
      var knownRows = state.groups[publicId] || [];
      if (valid && knownRows.length) {
        var incomingIndex = sourceOriginalIndex(rows);
        var missingKnownSource = knownRows.some(function(original) {
          return !sameSourceOriginal(incomingIndex, original);
        });
        // A full read can be an older R2 snapshot even if it matches its CSV.
        // Only the uncached scoped inventory may establish a removed source;
        // no response is allowed to regress an existing source's checked time.
        valid = !detailResponseIsOlder(publicId, rows) &&
          (!missingKnownSource || !!(options && options.scoped && options.scopedFresh));
      }
      if (!valid) { rejected[publicId] = true; return; }
      matchedIds.push(publicId);
      accepted.push({publicId: publicId, proof: proof, rows: rows, search: search});
    });
    var nextPending = options && options.scoped ? Object.assign(Object.create(null), state.pendingProofIds) : Object.create(null);
    inputIds.forEach(function(id) {
      if (rejected[id]) nextPending[id] = true;
      else delete nextPending[id];
    });
    var pendingIds = Object.keys(nextPending);
    var unknownIds = pendingIds.filter(function(id) { return !originalMetadataReady(id); });
    var complete = supported && !pendingIds.length && inputIds.length === inputItems.length;
    var outcome = {proofSupported: supported, matchedCount: matchedIds.length, matchedIds: matchedIds,
      pendingIds: pendingIds, unknownIds: unknownIds, complete: complete};
    if (options && options.validateOnly) return outcome;
    if (options && options.supersedePending && matchedIds.length) invalidatePendingLoad();
    accepted.forEach(function(entry) {
      var publicId = entry.publicId, proof = entry.proof, rows = entry.rows, search = entry.search;
      var financialProjectionChanged = rows.some(function(original) {
        var previous = (state.groups[publicId] || []).filter(function(row) { return text(row.originalId) === text(original.originalId); })[0];
        var currentDetail = original.saleSummary || original.saleDetails || {};
        var previousDetail = previous && (previous.saleSummary || previous.saleDetails) || {};
        return Number(currentDetail.financialDisplayVersion || 0) > Number(previousDetail.financialDisplayVersion || 0);
      });
      var photoProjectionChanged = rows.some(function(original) {
        var previous = (state.groups[publicId] || []).filter(function(row) { return text(row.originalId) === text(original.originalId); })[0];
        return !!original.photoPathsV119 && original.photoPathsV119 !== (previous && previous.photoPathsV119);
      });
      if (state.sourceSnapshotProofKeys[publicId] !== proof || !originalMetadataReady(publicId) || financialProjectionChanged) {
        // Most rows already use the public ID. Keep the validated objects in
        // that case instead of copying every field of the entire inventory.
        // A genuine internal/public ID remap still receives an isolated copy.
        merged[publicId] = rows.map(function(original) {
          return original.propertyId === publicId ? original : Object.assign({}, original, {propertyId: publicId});
        });
        searchIds[publicId] = (search || []).slice();
        state.detailPropertyGeneration[publicId] = (Number(state.detailPropertyGeneration[publicId]) || 0) + 1;
        delete state.detailCache[publicId];
        delete state.detailCachedAt[publicId];
        delete state.detailRetryAt[publicId];
        delete state.detailPending[publicId];
        delete state.detailPendingForced[publicId];
        delete state.contactCache[publicId];
        delete state.contactPending[publicId];
        if (state.openPropertyId === publicId) state.detailRequestToken += 1;
      } else if (photoProjectionChanged) {
        merged[publicId] = rows.map(function(original) {
          var previous = (state.groups[publicId] || []).filter(function(row) { return text(row.originalId) === text(original.originalId); })[0];
          return Object.assign({}, previous || original, {photoPathsV119: original.photoPathsV119,
            thumbnail: original.thumbnail, photoCount: original.photoCount});
        });
      }
      state.sourceSnapshotProofKeys[publicId] = proof;
      state.metadataCoverage[publicId] = true;
    });
    state.groups = merged;
    state.sourceSearchIds = searchIds;
    adoptOpenPhotoPathsV119();
    // Per-property proofs cannot certify the revision of the entire dataset.
    state.snapshotRevision = "";
    state.pendingProofIds = nextPending;
    state.pendingProofCount = pendingIds.length;
    var preserveGlobalStatus = !!(options && options.preserveGlobalStatus);
    if (complete && !preserveGlobalStatus) state.loaded = true;
    // The compatibility transaction publishes its final phase/count once.
    attach(inputItems, null, true);
    setOriginalLoadPhase(preserveGlobalStatus ? state.originalLoadPhase : complete ? "ready" : "pending");
    if (!preserveGlobalStatus) {
      originalLoadStatus();
    }
    return outcome;
  }

  function canCacheCompatible(items) {
    if (!state.loaded || state.originalLoadPhase !== "ready" || state.pendingProofCount || !Array.isArray(items)) return false;
    var seen = Object.create(null);
    return items.every(function(item) {
      var id = text(item && item.propertyId), proof = item && item.sourceSnapshotKey;
      if (!id || seen[id] || typeof proof !== "string" || !/^sha256-v1:[a-f0-9]{64}$/.test(proof) ||
          state.sourceSnapshotProofKeys[id] !== proof || !originalMetadataReady(id)) return false;
      seen[id] = true;
      return true;
    });
  }

  function load(force, options) {
    if (global.JSQueryListingsV152 && global.JSQueryListingsV152.enabled()) return global.JSQueryListingsV152.metadata();
    var requestedScopeV123 = global.JSDataAccessV6 && typeof global.JSDataAccessV6.listingsScope === "function"
      ? global.JSDataAccessV6.listingsScope() : "all";
    if (state.datasetScopeV123 === "lease" && requestedScopeV123 !== "lease") {
      invalidatePendingLoad(); state.loaded = false;
      state.groups = {}; state.sourceSearchIds = {}; state.metadataCoverage = Object.create(null);
      state.datasetScopeV123 = "all";
    }
    if (state.loadPending) return state.loadPending;
    // A staged CSV/original pair must consume the validated data-access read.
    // Memory groups omit the per-master proofs and may predate the new CSV.
    // warmInitialData already reuses a current persistent pair without a download.
    if (state.loaded && !force && !(options && options.deferCommit)) {
      return Promise.resolve({groups: state.groups, sourceSearchIds: state.sourceSearchIds, snapshotRevision: state.snapshotRevision});
    }
    var generation = state.loadGeneration;
    setOriginalLoadPhase("pending");
    var deferredCommit = !!(options && options.deferCommit);
    var pending = apiGet("unifiedListings", {}, force).then(async function(result) {
      result = await expandNetworkResultV68(result);
      if (generation !== state.loadGeneration) return {ok: false, superseded: true, groups: {}, snapshotRevision: ""};
      if (deferredCommit) return result;
      if (force) invalidateDetails();
      state.groups = result.groups || {};
      state.sourceSearchIds = result.sourceSearchIds || {};
      state.snapshotRevision = result.snapshotRevision || "";
      state.loaded = true;
      state.datasetScopeV123 = result.datasetScope || "all";
      state.pendingProofIds = Object.create(null);
      state.pendingProofCount = 0;
      state.sourceSnapshotProofKeys = Object.create(null);
      setOriginalLoadPhase("ready");
      originalLoadStatus();
      return result;
    }).catch(function(error) {
      if (generation !== state.loadGeneration) return {ok: false, superseded: true, groups: {}, snapshotRevision: ""};
      console.error("통합매물 원본 조회 실패", error);
      setOriginalLoadPhase("error");
      originalLoadStatus();
      return {ok: false, stale: state.loaded, groups: state.groups, sourceSearchIds: state.sourceSearchIds, snapshotRevision: state.snapshotRevision};
    }).finally(function() { if (state.loadPending === pending) state.loadPending = null; });
    state.loadPending = pending;
    return pending;
  }

  function attach(items, result, deferStatus) {
    invalidatePersonalCoverGroupsV86();
    if (result && result.groups) {
      if (state.groups !== result.groups) invalidateDetails();
      state.groups = result.groups;
      state.sourceSearchIds = result.sourceSearchIds || state.sourceSearchIds || {};
      if (result.ok !== false) {
        state.loaded = true;
        if (result.datasetScope) state.datasetScopeV123 = result.datasetScope;
        state.metadataCoverage = Object.create(null);
        state.pendingProofIds = Object.create(null);
        state.pendingProofCount = 0;
        state.sourceSnapshotProofKeys = Object.create(null);
        (items || []).forEach(function(item) {
          var id = text(item && item.propertyId);
          if (id) state.metadataCoverage[id] = true;
        });
        if (Object.prototype.hasOwnProperty.call(result, "snapshotRevision")) state.snapshotRevision = result.snapshotRevision || "";
        originalLoadStatus();
      }
    }
    indexMasterItems(items || []);
    (items || []).forEach(function(item) {
      var propertyId = text(item && item.propertyId);
      // A new CSV/master item can arrive after a scoped Today response. Track
      // its missing metadata even when the previous global phase was ready;
      // otherwise revision polling has no pending ID to recover. Explicit
      // full-snapshot empty coverage is known data, not an unknown source.
      if (propertyId && !originalMetadataReady(propertyId)) state.pendingProofIds[propertyId] = true;
      var all = allOriginals(item.propertyId);
      var originals = visibleOriginalsFrom(all, item.propertyId, item, true);
      // The master room is also a legacy favorite key. Overlay the currently
      // advertised floor/display room without rewriting that persisted key.
      var activeOriginals = all.filter(function(original) { return !isSourceUnavailable(original); });
      var sourceLink = text(item.sourceLink);
      var floorOriginal = activeOriginals.filter(function(original) {
        return sourceLink && text(original.link) === sourceLink;
      })[0] || activeOriginals[0];
      var saleFloor = text(item.tradeType).toLowerCase() === "sale" ||
        text(floorOriginal && floorOriginal.tradeType).toLowerCase() === "sale";
      if (!saleFloor && floorOriginal && Object.prototype.hasOwnProperty.call(floorOriginal, "floor")) {
        if (!item.sourceFloorVerifiedV1) {
          item.sourceFloorFallbackV1 = { present: Object.prototype.hasOwnProperty.call(item, "floor"), value: item.floor };
        }
        item.sourceFloorVerifiedV1 = true;
        item.floor = floorOriginal.floor;
        item.advertisedRoomV1 = text(floorOriginal.room);
      } else if (item.sourceFloorVerifiedV1) {
        if (item.sourceFloorFallbackV1 && item.sourceFloorFallbackV1.present) item.floor = item.sourceFloorFallbackV1.value;
        else delete item.floor;
        delete item.sourceFloorVerifiedV1;
        delete item.sourceFloorFallbackV1;
        delete item.advertisedRoomV1;
      }
      originals.forEach(function(original) {
        if (!original.buildingName) original.buildingName = item.name || "";
        if (!original.address) original.address = item.address || "";
        if (!original.type) original.type = item.type || "";
      });
      var locatedOriginal = originals.filter(function(original) {
        return original.latitude != null && original.latitude !== "" &&
          original.longitude != null && original.longitude !== "" &&
          Number.isFinite(Number(original.latitude)) && Number.isFinite(Number(original.longitude));
      })[0];
      if (locatedOriginal && (item.latitude == null || item.latitude === "" ||
          item.longitude == null || item.longitude === "")) {
        item.latitude = Number(locatedOriginal.latitude);
        item.longitude = Number(locatedOriginal.longitude);
      }
      state.masterMeta[text(item.propertyId)] = {
        regDate: text(item.regDate),
        buildingYear: text(item.buildingYear || item.approvalYear)
      };
      item.unifiedAllOriginalsV1 = all;
      item.unifiedOriginalMetadataPendingV1 = !originalMetadataReady(item.propertyId);
      item.unifiedActiveOriginalCountV1 = activeOriginals.length;
      item.unifiedEndedOriginalCountV1 = all.length - item.unifiedActiveOriginalCountV1;
      item.unifiedCandidateOriginalCountV2 = all.filter(isCandidateOriginal).length;
      item.sourceAllUnavailableV1 = all.length > 0 && item.unifiedActiveOriginalCountV1 === 0;
      item.unifiedOriginalsV8 = originals;
      item.sourceListingSearchV6579 = (state.sourceSearchIds[text(item.propertyId)] || []).slice();
      item.unifiedOriginalCountV8 = originals.length || (all.length || item.unifiedOriginalMetadataPendingV1 ? 0 : 1);
      item.thumbnailV8 = originals.length ? originalImage(originals[0]) : "";
      item.sourceTypesV8 = originals.map(function(original) { return sourceKey(original.source); });
      item.transactionCheckCandidateV8135 = isTransactionCandidate(item);
      item.transactionCheckMissingCountV8135 = item.transactionCheckCandidateV8135
        ? all.reduce(function(maximum, original) {
            return isSourceUnavailable(original) ? Math.max(maximum, Number(original && original.missingCount) || 1) : maximum;
          }, 0)
        : 0;
      item.gongsilContactCountV8 = originals.reduce(function(total, original) {
        return total + (sourceKey(original.source) === "gongsil" ? Math.max(0, Number(original.contactCount) || 0) : 0);
      }, 0);
    });
    state.pendingProofCount = Object.keys(state.pendingProofIds).length;
    if (!deferStatus) setOriginalLoadPhase(result && result.groups && result.ok !== false ? "ready" : state.originalLoadPhase);
    /* 자주 여는 상단 매물 사진은 기존처럼 선조회해 첫 클릭 속도를 유지합니다. */
    scheduleDetailWarmup(items);
    /* 연락처는 사용자가 카드나 전화 버튼을 가리킬 때만 선조회합니다. */
    return items;
  }

  function sourceKey(value) {
    // The stored provider labels dominate large inventories. Exact matches
    // avoid repeated trimming/regex work; aliases retain the existing parser.
    if (value === "네이버" || value === "naver") return "naver";
    if (value === "당근" || value === "daangn") return "danggeun";
    if (value === "공실박스" || value === "gongsil") return "gongsil";
    if (value === "직접") return "direct";
    value = text(value).toLowerCase();
    if (/당근|daangn|karrot/.test(value)) return "danggeun";
    if (/네이버|naver/.test(value)) return "naver";
    if (/공실|gongsil/.test(value)) return "gongsil";
    if (/직접/.test(value)) return "direct";
    return "unknown";
  }

  function matchesSource(item, selectedSource, options) {
    if (!selectedSource) return true;
    if (item && item.unifiedFilterOriginalV2) return sourceKey(item.unifiedFilterOriginalV2.source) === selectedSource;
    var sources = options && options.includeUnavailable
      ? (item && item.unifiedAllOriginalsV1 || []).map(function(original) { return sourceKey(original.source); })
      : item && item.sourceTypesV8 || [];
    return sources.length ? sources.indexOf(selectedSource) >= 0
      : !(item && (item.unifiedAllOriginalsV1 || []).length) && sourceKey(item && item.source) === selectedSource;
  }

  function isTransactionCandidate(item) {
    return !!(item && Number(item.unifiedCandidateOriginalCountV2 || 0) > 0 && text(item.state) !== "계약완료");
  }

  var financialColumnsV106 = {deposit:'deposit',rent:'monthly_rent',fee:'maintenance_fee',premium:'premium',area:'area_m2'};
  function manualFieldsV106(master,original) {
    return isCandidateOriginal(original) ? [] : text(original.manualDisplayFields).split(',').concat(master.manualFinancialFieldsV106 || []);
  }
  function financialDetailV106(original,propertyId) {
    if (!original || original.tradeType === 'sale') return original;
    var master = resolveMasterItem(original.propertyId || propertyId);
    if (!master) return original;
    var manual = manualFieldsV106(master,original), fields = Object.keys(financialColumnsV106).filter(function(key) { return manual.indexOf(financialColumnsV106[key]) >= 0; });
    if (!fields.length) return original;
    var displayed = Object.assign({},original,{manualFinancialDisplayV106:true});
    fields.forEach(function(key) { displayed[key] = master.displayValuePresence && master.displayValuePresence[key] === false ? null : master[key]; });
    return displayed;
  }
  function acceptSavedFinancialEditV106(master,result) {
    // List cards can be projections. Publish the accepted receipt to the exact
    // master too, so the next render cannot restore its old conditions.
    var owner = resolveMasterItem(master.propertyId) || master;
    ["name", "room", "deposit", "rent", "fee", "premium", "area", "landlordPhone", "tenantPhone",
      "memo", "state", "salePrice", "saleDetails"].forEach(function(key) {
      if (result.updated && Object.prototype.hasOwnProperty.call(result.updated, key)) owner[key] = result.updated[key];
    });
    if (result.updated && Array.isArray(result.updated.contacts)) owner.contactListRaw = JSON.stringify(result.updated.contacts);
    owner.displayValuePresence = Object.assign({}, master.displayValuePresence || owner.displayValuePresence || {});
    var allowed = Object.keys(financialColumnsV106).map(function(key) { return financialColumnsV106[key]; })
      .concat(["sale_price", "sale_details_json", "listing_type", "sale_category", "title", "building_name", "room", "landlord_phone", "tenant_phone"]);
    owner.manualFinancialFieldsV106 = Array.from(new Set((owner.manualFinancialFieldsV106 || []).concat(
      (Array.isArray(result.changedFields) ? result.changedFields : []).filter(function(field) { return allowed.indexOf(field) >= 0; }))));
    master.manualFinancialFieldsV106 = owner.manualFinancialFieldsV106.slice();
    if (state.openPropertyId === text(master.propertyId)) syncDetailPresentationV2(true);
  }
  function displayRoomFactsV129(master, original) {
    var manual = !!master && text(original.manualDisplayFields).split(',')
      .concat(master.manualFinancialFieldsV106 || []).indexOf("room") >= 0;
    var room = manual ? text(master.room) : text(original.room);
    var floor = original.floor;
    if (manual && /층|\dF\b|^(?:-?\d{1,2}|B\d{1,2})$/i.test(room.replace(/\s+/g, "")) &&
        typeof global.parseFloorNotationV612 === "function") {
      var parsed = global.parseFloorNotationV612(room, false);
      if (parsed !== null) floor = parsed;
    }
    return {room: room, floor: floor, manual: manual};
  }
  function originalDisplayItem(master, original) {
    // Manual values belong to the original's own master, never another member
    // chosen as the visible group card.
    var owner = resolveMasterItem(original.propertyId);
    if (owner && text(owner.propertyId) !== text(master.propertyId)) {
      master = Object.assign({}, owner, {propertyId: master.propertyId, key: master.key});
    }
    // A fresh own-property copy keeps each advertisement independent without
    // the slower Object.assign path for these wide master records.
    var item = {...master};
    // Keep operating memo on its owning master. A different source/price or
    // target cannot borrow it. Alternate ads need matching native unit evidence.
    if (master.tradeType === 'sale' && original.saleCategory !== 'land') {
      var ownLinkV203=text(master.sourceLink),primaryV203=(master.unifiedAllOriginalsV1||master.unifiedOriginalsV8||[]).find(function(o){return ownLinkV203&&text(o.link)===ownLinkV203;});
      var primaryTargetV203=primaryV203&&(primaryV203.saleSummary||primaryV203.saleDetails)||{},targetV203=original.saleSummary||original.saleDetails||{};
      var sameUnitV203=primaryTargetV203.saleExtent==='unit'&&targetV203.saleExtent==='unit'&&text(primaryTargetV203.saleTargetFloor)&&
        text(primaryTargetV203.saleTargetFloor)===text(targetV203.saleTargetFloor)&&text(primaryTargetV203.saleTargetRoom)===text(targetV203.saleTargetRoom);
      var memoOwnerV203=sourceKey(original.source)===sourceKey(master.source)&&Number(original.salePrice)===Number(master.salePrice)&&
        (ownLinkV203?text(original.link)===ownLinkV203||sameUnitV203:(master.unifiedOriginalsV8||[]).filter(function(o){return sourceKey(o.source)===sourceKey(original.source)&&Number(o.salePrice)===Number(original.salePrice);}).length===1);
      item.saleTargetMemoV203=memoOwnerV203?text(master.memo)||text(master.saleDetails&&master.saleDetails.descriptionText)
        :text(original.saleDetails&&original.saleDetails.descriptionText);
    }
    var manual = manualFieldsV106(master,original);
    item.displayValuePresence = Object.assign({}, master.displayValuePresence || {});
    var fields = {deposit:"deposit", rent:"monthly_rent", fee:"maintenance_fee", premium:"premium",
      area:"area_m2", salePrice:"sale_price", type:"listing_type", saleCategory:"sale_category"};
    Object.keys(fields).forEach(function(key) {
      if (manual.indexOf(fields[key]) >= 0) return;
      if (/^(?:deposit|rent|fee|premium|area|salePrice)$/.test(key)) {
        var known = original[key] != null && original[key] !== "" && Number.isFinite(Number(original[key]));
        item[key] = known ? Number(original[key]) : 0;
        item.displayValuePresence[key] = known;
      } else if (original[key] != null && original[key] !== "") item[key] = original[key];
    });
    if (original.saleSummary) {
      var manualSale = master.saleDetails && master.saleDetails.manualSaleFieldsV1;
      if (manual.indexOf("sale_details_json") < 0) item.saleDetails = original.saleSummary;
      else if (Array.isArray(manualSale)) {
        item.saleDetails = Object.assign({}, original.saleSummary);
        manualSale.forEach(function(key) { if (Object.prototype.hasOwnProperty.call(master.saleDetails,key)) item.saleDetails[key]=master.saleDetails[key]; });
        item.saleDetails.manualSaleFieldsV1 = manualSale.slice();
        if (manualSale.indexOf("monthlyIncome") >= 0) delete item.saleDetails.monthlyIncomeConflict;
      }
    }
    item.name = manual.indexOf("title") >= 0 || manual.indexOf("building_name") >= 0
      ? master.name : original.buildingName || master.name;
    item.source = original.source || master.source;
    item.sourceLink = original.link || master.sourceLink;
    item.sourceListingSearchV6579 = [original.sourceListingId, original.providerSourceId, original.sourceId]
      .map(text).filter(Boolean);
    var roomFacts = displayRoomFactsV129(master, original);
    item.advertisedRoomV1 = roomFacts.manual ? roomFacts.room
      : Object.prototype.hasOwnProperty.call(original, "floor")
        ? text(original.room) : original.room || master.advertisedRoomV1 || master.room;
    if (Object.prototype.hasOwnProperty.call(original, "floor") || roomFacts.floor != null) {
      item.floor = roomFacts.floor;
      item.sourceFloorVerifiedV1 = true;
    }
    item.unifiedFilterOriginalV2 = original;
    item.unifiedOriginalsV8 = [original];
    item.sourceTypesV8 = [sourceKey(original.source)];
    return item;
  }

  // Printing requests the selected original's complete, current financial
  // projection. Never borrow another ad merely because it shares an address.
  function printItem(item) {
    if (!item || item.tradeType !== "sale" || !text(item.propertyId)) return Promise.resolve(item);
    var selected = item.unifiedFilterOriginalV2 || (item.unifiedOriginalsV8 || [])[0];
    var id = text(selected && selected.originalId || item.originalId);
    return apiGet("unifiedListingDetail", {propertyId: text(selected && selected.propertyId) || item.propertyId}, true).then(function(result) {
      if (!result || result.ok === false || !Array.isArray(result.originals)) throw new Error("상세조건 조회 실패");
      var originals = result.originals;
      var matches = originals.filter(function(original) {
        if (original.tradeType !== "sale") return false;
        if (id) return text(original.originalId) === id;
        return sourceKey(original.source) === sourceKey(item.source) &&
          Number(original.salePrice) === Number(item.salePrice) &&
          (!text(item.sourceLink) || text(original.link) === text(item.sourceLink));
      });
      if (matches.length !== 1) throw new Error("선택한 원본의 최신 조건을 특정하지 못했습니다.");
      var original = matches[0], master = resolveMasterItem(item.propertyId) || item;
      var base = Object.assign({}, item);
      if (master.saleDetails && Array.isArray(master.saleDetails.manualSaleFieldsV1)) base.saleDetails = master.saleDetails;
      return originalDisplayItem(base, Object.assign({}, original, {saleSummary: original.saleDetails || original.saleSummary}));
    }).catch(function() {
      return Object.assign({}, item, {printReviewWarningV22: "최신 상세조건 조회 실패 · 현재 목록정보 기준. 보증금·임대수입 등은 원문에서 재확인하세요."});
    });
  }

  function filterItemForView(master, matches, view, matchesBeforeProjectionV150) {
    var all = master.unifiedAllOriginalsV1 || [];
    var manual = text(master.state) === "계약완료";
    if (manual && view === "active") return null;
    if (view === "active" && master.sourceAvailabilityV129 === "unavailable" &&
        (!all.length || state.pendingProofIds[text(master.propertyId)])) return null;
    // No originals yet is not proof of a source-less manual listing. A cold
    // CSV or unmatched per-master proof can otherwise flash an ended ad as
    // active until its bounded original read arrives after a map movement.
    if (!all.length && master.sourceSnapshotKey &&
        (!originalMetadataReady(master.propertyId) || state.pendingProofIds[text(master.propertyId)]) &&
        !/^(?:active|manual)$/.test(text(master.sourceAvailabilityV129))) return null;
    var originals = view === "completed" && !manual ? all.filter(isCandidateOriginal)
      : view === "active" ? all.filter(function(original) { return !isSourceUnavailable(original); }) : publicOriginals(all);
    var today = Number(global.newListingDays || 0) === 1 && global.JSTodayListingsV1;
    if (today && typeof today.matchesOriginal === "function") {
      originals = originals.filter(function(original) { return today.matchesOriginal(master, original); });
    }
    // Preserve explicit manual completion and source-less manual listings.
    if (manual && !today || !all.length) {
      if (!manual && view === "completed" || !matches(master)) return null;
      return Object.assign({}, master, {unifiedDisplayOriginalsV2: originals, unifiedAbsenceConfirmedTimeV1: 0});
    }
    var selected = null, matched = [], latestAbsenceTime = 0, latestAbsenceIndex = -1;
    originals.forEach(function(original) {
      // A source projection uses its own owner's coordinates, including ads
      // linked from another master. Reject only by that same location/address before
      // allocating the wide financial/display projection; no condition cache.
      if (matchesBeforeProjectionV150) {
        var ownerV150 = resolveMasterItem(original.propertyId);
        if (!matchesBeforeProjectionV150(ownerV150 && text(ownerV150.propertyId) !== text(master.propertyId) ? ownerV150 : master)) return;
      }
      var probe = originalDisplayItem(master, original);
      if (!matches(probe)) return;
      matched.push(original);
      if (!selected) selected = probe;
      if (view === "completed") {
        var absenceTime = absenceConfirmationTime(original);
        if (absenceTime > latestAbsenceTime) {
          latestAbsenceTime = absenceTime;
          latestAbsenceIndex = matched.length - 1;
          selected = probe;
        }
      }
    });
    if (!selected) return null;
    // Put only the newest matching candidate first. Keep equal/unknown dates
    // stable and never reorder the stored original group or its favorite key.
    if (latestAbsenceIndex > 0) matched.unshift(matched.splice(latestAbsenceIndex, 1)[0]);
    selected.unifiedDisplayOriginalsV2 = matched;
    selected.unifiedOriginalsV8 = matched;
    selected.unifiedOriginalCountV8 = matched.length;
    selected.sourceTypesV8 = matched.map(function(original) { return sourceKey(original.source); });
    selected.unifiedCandidateOriginalCountV2 = matched.filter(isCandidateOriginal).length;
    selected.transactionCheckCandidateV8135 = isTransactionCandidate(selected);
    selected.thumbnailV8 = originalImage(matched[0]);
    selected.unifiedAbsenceConfirmedTimeV1 = latestAbsenceTime;
    return selected;
  }

  function candidateSummary(options) {
    // Hydrated query pages are not the complete candidate inventory. The
    // operations panel's paged server fallback retains the correct scope.
    if (global.JSQueryListingsV152 && global.JSQueryListingsV152.enabled()) return {ready:false};
    var ready = state.loaded && !global.jsInitialFullListingsLoadingV1 &&
      !!global.map && typeof global.getFilteredItems === "function";
    var summary = {ready: ready, candidateCount: 0, candidateAdCount: 0, manualCompletedCount: 0,
      doneCount: 0, scopeLabel: "현재 지도·검색조건"};
    if (!ready) return summary;
    var includeRows = !!(options && options.includeRows);
    if (includeRows) summary.candidates = [];
    // Only the completion toggle is ignored. Market, price, favorites, source,
    // map bounds and the other search conditions remain the same as the map.
    var items = global.getFilteredItems({ignoreDone: true, availabilityView: "completed"});
    (items || []).forEach(function(item) {
      if (text(item.state) === "계약완료") {
        summary.manualCompletedCount += 1;
        return;
      }
      if (!isTransactionCandidate(item)) return;
      summary.candidateCount += 1;
      var originals = (item.unifiedDisplayOriginalsV2 || item.unifiedAllOriginalsV1 || []).filter(isCandidateOriginal);
      summary.candidateAdCount += originals.length;
      if (!includeRows) return;
      var first = originals[0] || {};
      var sources = [];
      originals.forEach(function(original) {
        var source = text(original.source);
        if (source && sources.indexOf(source) < 0) sources.push(source);
      });
      summary.candidates.push({
        propertyId: text(item.propertyId), title: item.name, address: item.address,
        room: item.advertisedRoomV1 || item.room, floor: item.floor, type: item.type,
        tradeType: item.tradeType || "lease", salePrice: item.salePrice,
        deposit: item.deposit, rent: item.rent, fee: item.fee, premium: item.premium, area: item.area,
        displayValuePresence: Object.assign({}, item.displayValuePresence || {}),
        mainSource: item.source, memo: item.memo, sourceUrl: text(item.sourceLink || first.link),
        thumbnail: originalImage(first), sourceCount: publicOriginals(item.unifiedAllOriginalsV1 || []).length, sources: sources,
        activeSourceCount: Number(item.unifiedActiveOriginalCountV1) || 0, sourceUnavailable: true,
        missingCount: item.transactionCheckMissingCountV8135 || 0,
        candidateKind: "source-candidates", candidateOriginalCount: originals.length,
        candidateOriginals: originals.map(function(original) {
          return Object.assign({}, original, {sourceId: original.providerSourceId || original.sourceListingId,
            sourceUrl: original.link});
        })
      });
    });
    summary.doneCount = summary.candidateCount + summary.manualCompletedCount;
    return summary;
  }

  function thumbnailDescriptorV159(item) {
    var originals=item?.unifiedDisplayOriginalsV2||item?.unifiedOriginalsV8||allOriginals(item?.propertyId),first=originals[0];
    var original=item?.queryRowV152?text(item.thumbnailV8):first?originalImage(first):'',cover=global.JSListingCoverV85?.urlFor(item,true)||'';
    return {source:cover||original,url:thumbnailDisplayImageUrlV69(cover||original),originalUrl:thumbnailDisplayImageUrlV69(original),cover:cover,
      originalId:item?.queryRowV152?item.querySelectedOriginalIdV152||'':first?.originalId||''};
  }
  function cardParts(item) {
    if(item?.queryRowV152){
      var originalThumb=text(item.thumbnailV8),cover=global.JSListingCoverV85?.urlFor(item,true)||'',thumb=cover||originalThumb;
      var summaryCountV157=Number(item.queryMatchedOriginalCountV152)||0,unavailable=item.sourceAllUnavailableV1===true;
      return {thumbnailState:thumb?'image':item.querySelectedPhotoCountV157===0?'empty':'unknown',sourceUnavailable:unavailable,badge:unavailable?'<span class="unified-badge-v8 source-unavailable">원본 광고 미노출 · 거래완료 후보</span>':'',
        sourceButton:'<button type="button" class="item-source-link-btn active" title="원본 광고 확인">'+(summaryCountV157>1?'동일매물 '+summaryCountV157+'개':'링크')+'</button>',
        thumbnail:'<button type="button" class="unified-thumb-v8 '+(thumb?'has-photo':'no-photo')+'" title="사진 크게 보기" data-cover-property-v85="'+esc(item.propertyId)+'" data-cover-original-v85="'+esc(thumbnailDisplayImageUrlV69(originalThumb))+'">'+
          (thumb?'<img src="'+esc(thumbnailDisplayImageUrlV69(thumb))+'" data-thumbnail-pending-v69="'+esc(thumbnailDisplayImageUrlV69(thumb))+'" data-thumbnail-source-v8144="'+esc(thumb)+'" '+
            (cover?'data-cover-image-v85="'+esc(cover)+'" data-cover-fallback-v85="'+esc(thumbnailDisplayImageUrlV69(originalThumb))+'" ':'')+
            'alt="매물 사진" decoding="async" referrerpolicy="no-referrer" onload="JSUnifiedListingsV8.thumbnailImageLoaded(this)" onerror="JSUnifiedListingsV8.thumbnailImageError(this)">':
            '<span>'+(item.querySelectedPhotoCountV157===0?'사진 없음':'사진 확인')+'</span>')+'</button>'};
    }
    var all = allOriginals(item && item.propertyId);
    var originals = item && Array.isArray(item.unifiedDisplayOriginalsV2) ? item.unifiedDisplayOriginalsV2
      : visibleOriginalsFrom(all, item && item.propertyId, item, true);
    var pending = !all.length && !originalMetadataReady(item && item.propertyId);
    var pendingLabel = pending ? missingOriginalLabel(item && item.propertyId) : "";
    var pendingRetryable = pending && getOriginalMetadataStatus(item && item.propertyId).retryable;
    var count = originals.length || (all.length || pending ? 0 : 1);
    var groupLabelV55 = item && item.wholeBuildingMembersV55 && item.wholeBuildingMembersV55.length > 1 ? "원본 광고 " : "동일매물 ";
    var sourceUnavailable = originals.length > 0 && originals.every(function(original) {
      return isCandidateOriginal(original);
    });
    var thumbnail = originals.length ? originalImage(originals[0]) : "";
    var originalThumbnailV85 = thumbnail;
    var personalThumbnailV85 = global.JSListingCoverV85 && global.JSListingCoverV85.urlFor(item, true);
    if (personalThumbnailV85) thumbnail = personalThumbnailV85;
    var photoPending = !thumbnail && originals.some(function(original) { return Number(original.photoCount) > 0; });
    var encodedId = encodeURIComponent(text(item && item.propertyId));
    var thumbnailMarkup = '<button type="button" class="unified-thumb-v8 ' +
      (thumbnail ? 'has-photo' : 'no-photo') + '" data-cover-property-v85="' + esc(item && item.propertyId) + '" data-cover-original-v85="' + esc(thumbnailDisplayImageUrlV69(originalThumbnailV85)) + '" title="' + (pending ? pendingLabel + (pendingRetryable ? ' · 다시 불러오기' : '') : photoPending ? '사진 확인 중' : '사진 크게 보기') + '" ' +
      'onpointerenter="JSUnifiedListingsV8.prefetch(\'' + encodedId + '\')" ' +
      'onfocus="JSUnifiedListingsV8.prefetch(\'' + encodedId + '\')" ' +
      'onpointerdown="JSUnifiedListingsV8.prefetch(\'' + encodedId + '\')" ' +
      'onclick="event.stopPropagation(); JSUnifiedListingsV8.toggleCardDetail(\'' + encodedId + '\')">' +
      (thumbnail ? '<img data-thumbnail-pending-v69="' + esc(thumbnailDisplayImageUrlV69(thumbnail)) + '" data-thumbnail-source-v8144="' + esc(thumbnail) +
        '" ' + (personalThumbnailV85 ? 'data-cover-image-v85="' + esc(personalThumbnailV85) + '" data-cover-fallback-v85="' + esc(thumbnailDisplayImageUrlV69(originalThumbnailV85)) + '" ' : '') + 'alt="매물 사진" loading="lazy" decoding="async" referrerpolicy="no-referrer" ' +
        'onload="JSUnifiedListingsV8.thumbnailImageLoaded(this)" ' +
        'onerror="' + (personalThumbnailV85 ? 'JSListingCoverV85.imageError(this)' : 'JSUnifiedListingsV8.thumbnailImageError(this)') + '">' : '<span>' + (pending ? pendingLabel : photoPending ? '사진 확인 중' : '사진 없음') + '</span>') +
      (sourceUnavailable
        ? '<em class="transaction-check-ribbon-v8135">원본 광고 미노출<b>거래완료 후보</b></em>'
        : '') +
      '</button>';
    var badge = pending ? '<span class="unified-badge-v8">' + pendingLabel + (pendingRetryable ? ' · 다시 불러오기' : '') + '</span>' : sourceUnavailable
      ? '<span class="unified-badge-v8 source-unavailable">원본 광고 미노출 · 거래완료 후보</span>'
      : count > 1
        ? '<span class="unified-badge-v8">' + groupLabelV55 + count + '개</span>'
        : '';
    var button;
    if (pending) {
      button = '<button type="button" class="item-source-link-btn" onclick="event.stopPropagation(); ' +
        'JSUnifiedListingsV8.open(\'' + encodedId + '\')">' + (pendingRetryable ? '다시 불러오기' : '사진·링크') + '</button>';
    } else if (sourceUnavailable) {
      button = '<button type="button" class="item-source-link-btn active transaction-check-button-v8135" ' +
        'title="원본 광고 미노출 내역 확인 · 실제 계약완료와 별도" ' +
        'onclick="event.stopPropagation(); if(window.openTransactionCandidateFromListingV1){' +
          'openTransactionCandidateFromListingV1(\'' + encodedId + '\');}">미노출 내역</button>';
    } else if (count > 1) {
      button = '<button type="button" class="item-source-link-btn active unified-expand-btn-v8" ' +
        'onclick="event.stopPropagation(); JSUnifiedListingsV8.toggle(\'' + encodedId + '\', this)">' +
        groupLabelV55 + count + '개</button>';
    } else {
      var link = originals.length ? text(originals[0].link) : text(item && item.sourceLink);
      button = link
        ? '<button type="button" class="item-source-link-btn active" onclick="event.stopPropagation(); ' +
          'JSUnifiedListingsV8.openExternalLink(\'' + encodedExternalLink(link) + '\')">링크</button>'
        : '<button type="button" class="item-source-link-btn disabled" disabled>링크</button>';
    }
    return {thumbnailState:thumbnail?'image':pending||photoPending?'unknown':'empty',thumbnail: thumbnailMarkup, badge: badge, sourceButton: button, sourceUnavailable: sourceUnavailable};
  }

  function conditionLine(original, hideArea) {
    if (text(original && original.tradeType).toLowerCase() === "sale") {
      return '<span class="listing-sale-condition-v1"><b>매매</b> ' + (global.JSSaleWorkbenchV1 ? global.JSSaleWorkbenchV1.price(original.salePrice) : number(original.salePrice)) +
        (hideArea ? '' : ' · ' + (global.JSListingTradeV1 ? global.JSListingTradeV1.saleAreaHtml(original) : '면적 미확인')) + '</span>';
    }
    return '<span><b>보</b> ' + number(original.deposit) + ' / <b>월</b> ' + number(original.rent) +
      ' · <b>관</b> ' + number(original.fee) + ' · <b>권</b> ' + number(original.premium) +
      ' · <b>평</b> ' + number(original.area) + '</span>';
  }

  function openExternalLink(encodedLink) {
    var link = "";
    try {
      link = decodeURIComponent(text(encodedLink));
    } catch (_) {
      return;
    }
    if (!/^https?:\/\//i.test(link)) return;
    var popup = global.open(link, "_blank", "noopener,noreferrer");
    if (popup) popup.opener = null;
  }

  function indexMasterItems(items) {
    if (state.masterItemsArray !== items) invalidatePersonalCoverGroupsV86();
    state.masterItemsArray = items;
    state.masterItemsById = Object.create(null);
    items.forEach(function(item) {
      var propertyId = text(item && item.propertyId);
      if (propertyId && !state.masterItemsById[propertyId]) state.masterItemsById[propertyId] = item;
    });
  }

  function resolveMasterItem(propertyId) {
    var items = Array.isArray(global.allItems) ? global.allItems : [];
    if (state.masterItemsArray !== items) indexMasterItems(items);
    return state.masterItemsById[text(propertyId)] || null;
  }

  function runDetailAction(action, encodedPropertyId) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var item = resolveMasterItem(propertyId);
    if (!item) {
      alert("현재 매물목록에서 해당 매물ID를 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.");
      return;
    }
    var encodedKey = encodeURIComponent(text(item.key));
    if (isPhoneDetailV2() && action === "contact" && typeof global.openListContactPopupV654 === "function") {
      global.openListContactPopupV654(encodeURIComponent("id:" + propertyId));
      return;
    }
    if (isPhoneDetailV2() && action === "favorite" && typeof global.openItemListDestinationPicker === "function") {
      // The phone folder picker is an app page beneath the full-screen detail.
      // Replace the detail only for this explicit save action; ordinary folder
      // browsing still keeps its detail above the folder for back navigation.
      closeDetailForOverlay();
      global.openItemListDestinationPicker(encodeURIComponent("property:" + propertyId));
      return;
    }
    if (action === "navigation" && typeof global.openKakaoNavigation === "function") {
      global.openKakaoNavigation(encodedKey);
      return;
    }
    if (action === "roadview" && typeof global.openKakaoRoadview === "function") {
      global.openKakaoRoadview(encodedKey);
      return;
    }
    if (action === "register" && typeof global.openBuildingRegisterV640 === "function") {
      global.openBuildingRegisterV640(encodedKey);
      return;
    }
    if (action === "edit" && typeof global.openPropertyEditModalV630 === "function") {
      global.openPropertyEditModalV630(encodeURIComponent("id:" + propertyId));
      return;
    }
    alert("선택한 기능을 아직 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  function originalRow(original, selected) {
    var encodedPropertyId = encodeURIComponent(text(original.displayGroupPropertyIdV55 || original.propertyId));
    var encodedOriginalId = encodeURIComponent(text(original.originalId));
    var thumbnail = originalImage(original);
    var buildingSale = global.JSListingTradeV1 && global.JSListingTradeV1.isBuildingSale && global.JSListingTradeV1.isBuildingSale(original);
    var financial = buildingSale && global.JSListingTradeV1.saleSummary(original);
    function amount(value) { return value != null && value !== "" && Number.isFinite(Number(value)) ? number(value) + "만원" : "미제공"; }
    return '<button type="button" class="unified-original-row-v8' + (selected ? ' selected' : '') + '" ' +
      'data-original-id="' + esc(original.originalId) + '" ' +
      'onpointerenter="JSUnifiedListingsV8.prefetch(\'' + encodedPropertyId + '\', \'' + encodedOriginalId + '\')" ' +
      'onfocus="JSUnifiedListingsV8.prefetch(\'' + encodedPropertyId + '\', \'' + encodedOriginalId + '\')" ' +
      'onclick="event.stopPropagation(); ' +
      'JSUnifiedListingsV8.open(\'' + encodedPropertyId + '\', \'' + encodedOriginalId + '\')">' +
      '<span class="unified-original-thumb-v8 ' + (thumbnail ? 'has-photo' : 'no-photo') + '">' +
        (thumbnail ? '<img src="' + esc(thumbnail) + '" alt="" loading="lazy" referrerpolicy="no-referrer" ' +
          'onerror="JSUnifiedListingsV8.imageError(this, false)">' : '') + '</span>' +
      '<span class="unified-original-body-v8"><span class="unified-original-head-v8"><b class="source-' +
        sourceKey(original.source) + '">' + esc(original.source) + '</b>' +
        (buildingSale ? '' : '<em>' + esc((global.JSListingTradeV1 && global.JSListingTradeV1.landUseLabel ? global.JSListingTradeV1.landUseLabel(original) : '') || originalRoomLabel(original) || '호실 -') + '</em>') + '</span>' +
        (isSourceUnavailable(original) ? '<small class="source-unavailable">원본 광고 미노출 · 거래완료 후보</small>' : '') +
        conditionLine(original) + (financial ? '<small>보증금 ' + esc(amount(financial.totalDeposit)) + ' · 월 임대수입 ' + esc(amount(financial.monthlyIncome)) + '</small>' : '') +
        '<small>' + esc(original.buildingName || original.address) + '</small></span>' +
      '</button>';
  }

  function toggle(encodedPropertyId, button) {
    if (!desktop()) return;
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var card = button && button.closest(".item");
    if (!card) return;
    var existing = card.querySelector(".unified-inline-originals-v8");
    if (existing) {
      existing.remove();
      card.classList.remove("unified-expanded-v8");
      button.textContent = "동일매물 " + displayedOriginals(propertyId).length + "개";
      return;
    }
    var wrapper = document.createElement("div");
    wrapper.className = "unified-inline-originals-v8";
    wrapper.innerHTML = displayedOriginals(propertyId).map(function(original) { return originalRow(original, false); }).join("");
    card.appendChild(wrapper);
    card.classList.add("unified-expanded-v8");
    button.textContent = "동일매물 닫기";
  }

  function ensureDrawer() {
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (drawer) return drawer;
    drawer = document.createElement("aside");
    drawer.id = "unifiedDetailDrawerV8";
    drawer.className = "unified-detail-drawer-v8";
    if (global.JSWideDetailV26) drawer.setAttribute('data-wide-detail-v26', '');
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-labelledby", "unifiedDetailTitleV8");
    drawer.setAttribute("aria-hidden", "true");
    drawer.innerHTML = '<header><div><strong id="unifiedDetailTitleV8">매물 상세</strong><span id="unifiedDetailSubtitleV8"></span></div>' +
      '<button type="button" aria-label="상세매물보기 닫기">×</button></header>' +
      '<div id="unifiedDetailBodyV8" class="unified-detail-body-v8"></div>';
    drawer.querySelector("header button").onclick = function(event) {
      event.preventDefault();
      event.stopPropagation();
      closeDetail();
    };
    document.body.appendChild(drawer);
    return drawer;
  }

  var detailCloseTimerV827 = null;

  function showDetailDrawerV827(drawer) {
    if (!drawer) return;
    var wasVisible = drawer.getAttribute("aria-hidden") !== "true";
    if (detailCloseTimerV827) {
      global.clearTimeout(detailCloseTimerV827);
      detailCloseTimerV827 = null;
    }
    drawer.classList.remove("closing-v827");
    drawer.setAttribute("aria-hidden", "false");
    if (drawer.classList.contains("open") || drawer.classList.contains("opening-v827")) return;
    drawer.classList.add("opening-v827");
    void drawer.offsetWidth;
    if (!wasVisible && global.JSDialogFocusV1) {
      global.JSDialogFocusV1.activate(drawer, drawer.querySelector("header button"));
    }
    global.requestAnimationFrame(function() {
      if (!drawer.classList.contains("opening-v827") || !state.openPropertyId) return;
      drawer.classList.add("open");
      drawer.classList.remove("opening-v827");
    });
  }

  function positionDrawer(drawer) {
    if (global.JSWideDetailV26 && global.JSWideDetailV26.position(drawer)) return;
    var sidebar = document.getElementById("sidebar");
    var toolbar = document.querySelector(".filters");
    drawer.style.right = (sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 620) + "px";
    drawer.style.top = Math.max(0, toolbar ? Math.round(toolbar.getBoundingClientRect().bottom) : 68) + "px";
    if (drawer.hasAttribute('data-sale-presentation-v2')) drawer.style.setProperty('--sale-dossier-available-v3', Math.max(280, global.innerWidth - (sidebar ? sidebar.getBoundingClientRect().width : 620) - 12) + 'px');
    else drawer.style.removeProperty('--sale-dossier-available-v3');
  }

  function phoneDetailFactsV2(selected) {
    var sale = text(selected.tradeType).toLowerCase() === "sale";
    function value(field) {
      return selected[field] == null || selected[field] === '' ? '미확인' : number(selected[field]);
    }
    var price = sale
      ? '매매 ' + esc(selected.salePrice == null || selected.salePrice === '' ? '미확인' :
        (global.JSSaleWorkbenchV1 ? global.JSSaleWorkbenchV1.price(selected.salePrice) : number(selected.salePrice)))
      : '보 ' + esc(value('deposit')) + ' / 월 ' + esc(value('rent'));
    var typeLabel = global.JSListingTradeV1 ? global.JSListingTradeV1.displayType(selected) : selected.type;
    var buildingSale = global.JSListingTradeV1 && global.JSListingTradeV1.isBuildingSale && global.JSListingTradeV1.isBuildingSale(selected);
    var landLabel = global.JSListingTradeV1 && global.JSListingTradeV1.landUseLabel
      ? global.JSListingTradeV1.landUseLabel(selected) : "";
    var facts = [['구분', typeLabel || '미확인']];
    if (landLabel) facts.push(['지목', landLabel.replace(/^지목(?::\s*|\s+)/, '')]);
    else if (!buildingSale) facts.push(['층·호실', selected.room || '미확인']);
    if (!sale) facts = facts.concat([
      ['면적', selected.area == null || selected.area === '' ? '미확인' : number(selected.area) + '평'],
      ['관리비', selected.fee == null || selected.fee === '' ? '미확인' : number(selected.fee) + '만원'],
      ['권리금', selected.premium == null || selected.premium === '' ? '미확인' : number(selected.premium) + '만원']
    ]);
    return '<div class="phone-detail-price-v2">' + price + '</div>' +
      '<dl class="phone-detail-facts-v2">' + facts.map(function(fact) {
        return '<div><dt>' + esc(fact[0]) + '</dt><dd>' + esc(fact[1]) + '</dd></div>';
      }).join('') + '</dl>';
  }

  function phoneDetailActionsV2(propertyId, selected) {
    var encodedId = encodeURIComponent(text(propertyId)).replace(/'/g, '%27');
    return '<nav class="phone-detail-actions-v2" aria-label="매물 상세 바로가기">' +
      '<button type="button" class="phone-detail-contact-v2" onclick="JSUnifiedListingsV8.runDetailAction(\'contact\', \'' + encodedId + '\')">전화</button>' +
      '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'navigation\', \'' + encodedId + '\')">길찾기</button>' +
      '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'favorite\', \'' + encodedId + '\')">찜하기</button>' +
      (selected && /^https?:\/\//i.test(text(selected.link))
        ? '<button type="button" aria-label="선택한 원본 링크 열기" onclick="JSUnifiedListingsV8.openExternalLink(\'' + encodedExternalLink(selected.link) + '\')">원본 ↗</button>'
        : '<button type="button" disabled title="등록된 원본 링크가 없습니다">원본 없음</button>') + '</nav>';
  }

  function detailStatusMessage(propertyId) {
    var status = state.detailStatus[text(propertyId)];
    if (status === "unavailable") return "현재 노출 중인 원본 광고가 없습니다. 거래완료만 보기의 미노출 후보에서 확인해 주세요.";
    if (status === "filtered") return "현재 검색조건에 맞는 원본 광고가 없습니다. 최신 조건을 목록에 반영했습니다.";
    if (status === "mismatch") return "선택한 원본의 최신 연결을 확인하지 못했습니다. 잠시 후 상세를 다시 열어 주세요.";
    if (status === "error") return "원본 최신 조회에 실패했습니다. 마지막 확인 자료를 유지합니다. 잠시 후 다시 열어 주세요.";
    return "원본 정보를 확인 중입니다.";
  }

  function detailPhotoPlaceholder(propertyId, photoCount) {
    return photoCount > 0 ? state.detailStatus[propertyId] === "pending" ? "사진 확인 중" : "사진 조회 불가" : "등록된 사진 없음";
  }

  function renderDetail(propertyId, originals, selectedOriginalId, layoutOptions) {
    originals = visibleOriginalsFrom(originals, propertyId);
    var selected = originals.filter(function(original) {
      return text(original.originalId) === text(selectedOriginalId);
    })[0] || originals[0];
    selected = financialDetailV106(selected,propertyId);
    var masterMeta = state.masterMeta[text(propertyId)] || {};
    var phoneDetail = isPhoneDetailV2();
    var drawer = ensureDrawer();
    drawer.__detailPresentationV2 = {phone: phoneDetail, propertyId: propertyId, originals: originals, originalId: selected && selected.originalId};
    positionDrawer(drawer);
    document.getElementById("unifiedDetailTitleV8").textContent = selected
      ? (selected.buildingName || selected.address || "매물 상세") : "매물 상세";
    document.getElementById("unifiedDetailSubtitleV8").textContent = originals.length > 1
      ? (detailMembersV55(propertyId).length > 1 ? "건물 전체 · 원본 광고 " : "동일 공간 원본 ") + originals.length + "개" : originals.length === 1 ? "원본매물 1개"
      : state.detailStatus[propertyId] === "unavailable" ? "현재 노출 광고 없음"
      : /^(?:mismatch|error|filtered)$/.test(state.detailStatus[propertyId]) ? "원본 연결 확인 필요" : "원본 확인 중";
    var images = originalImages(selected);
    if (images.length < 2 && Number(selected && selected.photoCount) > 1) {
      var cachedPhotos = cachedPhotosV118(selected, propertyId);
      if (cachedPhotos.length > 1) images = cachedPhotos;
    }
    var photoCount = images.length > 1 ? images.length : selected ? Math.max(images.length, Number(selected.photoCount) || 0) : 0;
    var encodedActionPropertyId = encodeURIComponent(text(selected && selected.propertyId) || text(propertyId));
    var buildingSale = selected && global.JSListingTradeV1 && global.JSListingTradeV1.isBuildingSale && global.JSListingTradeV1.isBuildingSale(selected);
    var salePresentation = selected && global.JSListingTradeV1 && global.JSListingTradeV1.isSale(selected);
    if (salePresentation) drawer.setAttribute('data-sale-presentation-v2', global.JSListingTradeV1.normalizedSaleCategory(selected) === 'land' ? 'land' : 'building');
    else drawer.removeAttribute('data-sale-presentation-v2');
    if (salePresentation) positionDrawer(drawer);
    var landLabel = selected && global.JSListingTradeV1 && global.JSListingTradeV1.landUseLabel
      ? global.JSListingTradeV1.landUseLabel(selected) : "";
    var body = document.getElementById("unifiedDetailBodyV8");
    var detailNotice = selected && /^(?:mismatch|error)$/.test(state.detailStatus[propertyId])
      ? '<div class="unified-empty-v8" role="status">' + esc(detailStatusMessage(propertyId)) + '</div>' : '';
    body.innerHTML = detailNotice + (!selected ? '<div class="unified-empty-v8" role="status">' + esc(detailStatusMessage(propertyId)) + '</div>' :
      '<section class="unified-detail-gallery-v8">' +
        (images.length ? '<button type="button" class="unified-detail-hero-v8" ' +
          'onclick="JSUnifiedListingsV8.openDetailGallery(this)">' +
            '<img alt="매물 대표 사진" referrerpolicy="no-referrer" ' +
              'onload="JSUnifiedListingsV8.detailImageLoaded(this)" ' +
              'onerror="JSUnifiedListingsV8.detailImageError(this)">' +
            '<span class="unified-detail-photo-count-v8" aria-live="polite"></span>' +
          '</button>' +
          '<button type="button" class="unified-detail-photo-nav-v8 prev" aria-label="이전 사진" ' +
            'onclick="event.stopPropagation(); JSUnifiedListingsV8.stepDetailPhoto(this, -1)">‹</button>' +
          '<button type="button" class="unified-detail-photo-nav-v8 next" aria-label="다음 사진" ' +
            'onclick="event.stopPropagation(); JSUnifiedListingsV8.stepDetailPhoto(this, 1)">›</button>' +
          '<button type="button" class="unified-photo-download-v73" aria-label="선택한 광고의 사진 전체 ZIP 다운로드" ' +
            'onclick="event.stopPropagation(); JSUnifiedListingsV8.downloadPhoto(this)">↓ 전체 저장</button>' :
          '<div class="unified-gallery-empty-v8">' + esc(detailPhotoPlaceholder(propertyId, photoCount)) + '</div>') +
      '</section>' +
      '<section class="unified-detail-summary-v8"><div class="unified-detail-source-address-v827">' +
        '<div class="unified-detail-source-row-v827"><span class="source-' + sourceKey(selected.source) + '">' +
          esc(selected.source) + '</span>' +
          (selected.link ? '<button type="button" class="unified-detail-source-link-v827" ' +
            'aria-label="선택한 원본 링크 열기" title="' + esc(selected.source) + ' 추출 원본 열기" ' +
            'onclick="JSUnifiedListingsV8.openExternalLink(\'' + encodedExternalLink(selected.link) + '\')">원본 링크 ↗</button>' : '') +
        '</div><strong>' + esc(selected.address) + (buildingSale ? '' : ' ' + esc(landLabel || originalRoomLabel(selected))) + '</strong>' + detailDateMetadata(masterMeta, selected) + '</div>' +
        (isSourceUnavailable(selected) ? '<p class="source-unavailable">원본 광고 미노출 · 거래완료 후보 · 실제 계약 여부는 별도 확인</p>' : '') +
        (salePresentation ? global.JSListingTradeV1.saleOverviewHtml(selected) : '') +
        (global.JSListingTradeV1 && global.JSListingTradeV1.buildingSaleAreaInfoHtml ? global.JSListingTradeV1.buildingSaleAreaInfoHtml(selected) : '') +
        (salePresentation && global.JSSaleWorkbenchV1 ? global.JSSaleWorkbenchV1.detailTools(selected, propertyId) : '') +
        (salePresentation ? '<div class="sale-photo-slot-v3" data-sale-section="photos"></div>' : '') +
        (salePresentation ? '' : phoneDetail ? phoneDetailFactsV2(selected) : '<p>' + conditionLine(selected, buildingSale) + '</p>') +
        (global.JSListingTradeV1 ? global.JSListingTradeV1.saleDetailsHtml(selected) : '') +
        (!phoneDetail && !salePresentation && global.JSSaleWorkbenchV1 ? global.JSSaleWorkbenchV1.detailTools(selected, propertyId) : '') +
        '<div class="unified-detail-utility-actions-v8" aria-label="매물 바로가기">' +
          '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'navigation\', \'' + encodedActionPropertyId + '\')">내비</button>' +
          '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'roadview\', \'' + encodedActionPropertyId + '\')">로드뷰</button>' +
          (!phoneDetail ? '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'register\', \'' + encodedActionPropertyId + '\')">대장</button>' +
          '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'edit\', \'' + encodedActionPropertyId + '\')">수정</button>' : '') +
        '</div>' +
        (selected.manualFinancialDisplayV106 ? '<p class="unified-detail-manual-condition-v106">직접 수정한 항목의 관리값을 표시합니다.</p>' : '') +
        (!phoneDetail ? '<div class="unified-detail-actions-v8" aria-label="원본매물 정리 작업">' +
          (!selected.masterFallback && originals.length > 1 ? '<button type="button" class="separate" onclick="JSUnifiedListingsV8.separate(\'' +
            encodeURIComponent(selected.originalId) + '\', ' + Number(selected.revision || 1) + ')">별도 매물 분리</button>' : '') +
          (!selected.masterFallback ? '<button type="button" class="move" onclick="JSUnifiedListingsV8.startMove(\'' +
            encodeURIComponent(selected.originalId) + '\', ' + Number(selected.revision || 1) + ')">원본 1개 합치기</button>' : '') +
          '<button type="button" class="move whole-master" onclick="JSUnifiedListingsV8.startWholeMasterMove(\'' +
            encodedActionPropertyId + '\')">대표 전체 합치기</button>' +
        '</div>' : '') +
        (selected.memo ? '<div class="unified-detail-memo-v8">' + sourceDescriptionHtmlV140(selected.memo, selected) + '</div>' : '') +
        (buildingSale?'<div class="detail-attachments-v181">'+attachmentButtonHtmlV181(Object.assign({},selected,{propertyId:propertyId}))+'</div>':'')+
      '</section>' +
      (originals.length > 1 ? '<section class="unified-detail-originals-v8"><h4>이 공간의 원본매물</h4>' +
        originals.map(function(original) { return originalRow(original, original.originalId === selected.originalId); }).join("") +
      '</section>' : '') + groupedRecordsHtmlV55(propertyId));
    var phoneActions = drawer.querySelector('.phone-detail-actions-v2');
    if (phoneActions) phoneActions.remove();
    if (phoneDetail && selected) drawer.insertAdjacentHTML('beforeend', phoneDetailActionsV2(text(selected.propertyId) || propertyId, selected));
    var detailGallery = body.querySelector(".unified-detail-gallery-v8");
    if (detailGallery && layoutOptions && layoutOptions.gallery) {
      detailGallery.replaceWith(layoutOptions.gallery);
    } else if (detailGallery && images.length) {
      detailGallery._imagesV8 = images.slice();
      detailGallery._photoCountV8 = photoCount;
      detailGallery._propertyIdV8 = propertyId;
      detailGallery._originalIdV8 = selected.originalId;
      detailGallery._sourcePropertyIdV116 = text(selected.propertyId) || propertyId;
      detailGallery._sourceNameV116 = text(selected.source);
      detailGallery._photoIdentityV118 = Object.assign({}, selected);
      detailGallery._downloadNameV73 = text(selected.address || selected.buildingName || propertyId);
      detailGallery._failedImagesV8 = {};
      bindPhotoSwipe(detailGallery, function(direction) {
        stepDetailPhoto(detailGallery.querySelector(direction < 0 ? ".prev" : ".next"), direction);
      });
      renderDetailPhoto(detailGallery, 0);
      var pendingStep = state.pendingDetailSteps[text(propertyId)];
      if (images.length > 1 && Number.isFinite(Number(pendingStep))) {
        delete state.pendingDetailSteps[text(propertyId)];
        renderDetailPhoto(detailGallery, Number(pendingStep));
      }
    }
    if (global.JSSalePropertyWorkspaceV3) global.JSSalePropertyWorkspaceV3.mountDetail(body, selected);
    if (global.JSSaleReviewFlowV12) global.JSSaleReviewFlowV12.mountNavigation(drawer);
    if (global.JSWideDetailV26) global.JSWideDetailV26.mount(body, selected);
    if (global.JSListingCoverV85) global.JSListingCoverV85.decorateDetail(body, {propertyId: propertyId});
    showDetailDrawerV827(drawer);
  }

  function syncDetailPresentationV2(force) {
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (!drawer || (!drawer.classList.contains("open") && !drawer.classList.contains("opening-v827"))) return;
    var saved = drawer.__detailPresentationV2;
    var body = document.getElementById("unifiedDetailBodyV8");
    if (!saved || !body || saved.phone === isPhoneDetailV2() && force !== true) { positionDrawer(drawer); return; }
    var gallery = body.querySelector(".unified-detail-gallery-v8");
    var scrollTop = body.scrollTop;
    var key = text(saved.propertyId) + ":" + text(saved.originalId);
    if (drawer.__layoutDraftKeyV2 !== key) drawer.__layoutDraftV2 = {};
    drawer.__layoutDraftKeyV2 = key;
    var drafts = drawer.__layoutDraftV2;
    var focused = document.activeElement;
    var focusKey = "";
    var selection = null;
    function fieldKey(field, index) { return field.id || field.name || field.tagName + ":" + index; }
    Array.prototype.forEach.call(body.querySelectorAll("input, select, textarea, details"), function(field, index) {
      var id = fieldKey(field, index);
      drafts[id] = {value: field.value, checked: field.checked, open: field.open};
      if (field === focused) {
        focusKey = id;
        selection = {start: field.selectionStart, end: field.selectionEnd};
      }
    });
    // Reuse the live gallery node: photo index, in-flight images and swipe
    // handlers survive. This is presentation only, with no detail fetch/save.
    renderDetail(saved.propertyId, saved.originals, saved.originalId, {gallery: gallery});
    Array.prototype.forEach.call(body.querySelectorAll("input, select, textarea, details"), function(field, index) {
      var id = fieldKey(field, index);
      var draft = drafts[id];
      if (!draft) return;
      if (typeof draft.value !== "undefined") field.value = draft.value;
      if (typeof draft.checked === "boolean") field.checked = draft.checked;
      if (typeof draft.open === "boolean") field.open = draft.open;
      if (focusKey === id) {
        field.focus({preventScroll: true});
        if (selection && selection.start != null && typeof field.setSelectionRange === "function") field.setSelectionRange(selection.start, selection.end);
      }
    });
    body.scrollTop = scrollTop;
  }

  function renderDetailPhoto(gallery, index) {
    var images = gallery && gallery._imagesV8 || [];
    if (!gallery || !images.length) return;
    var safeIndex = wrapPhotoIndexV8141(index, images.length);
    gallery._indexV8 = safeIndex;
    var image = gallery.querySelector(".unified-detail-hero-v8 img");
    if (image) {
      image.style.display = "block";
      /* 대표 썸네일은 이미 목록에서 받은 동일 URL을 써서 중복 다운로드를 피합니다. */
      var displaySource = safeIndex === 0 ? text(images[safeIndex]) : detailDisplayImageUrl(images[safeIndex]);
      image = adoptPendingPhotoV124(gallery, displaySource) || image;
      image.setAttribute("data-detail-source-v8144", text(images[safeIndex]));
      try { image.fetchPriority = "high"; } catch (ignore) {}
      loadPhotoV114(gallery, image, displaySource, text(images[safeIndex]));
      image.alt = "매물 사진 " + (safeIndex + 1) + " / " + images.length;
    }
    var counter = gallery.querySelector(".unified-detail-photo-count-v8");
    if (counter) counter.textContent = (safeIndex + 1) + " / " +
      Math.max(images.length, Number(gallery._photoCountV8) || 0);
    var photoCount = Math.max(images.length, Number(gallery._photoCountV8) || 0);
    gallery.querySelectorAll(".unified-detail-photo-nav-v8").forEach(function(button) {
      button.hidden = photoCount < 2;
      button.disabled = photoCount < 2;
    });
    preloadAdjacentDetailImages(images, safeIndex);
  }

  function stepDetailPhoto(button, direction) {
    var gallery = button && button.closest(".unified-detail-gallery-v8");
    if (!gallery) return;
    var images = gallery._imagesV8 || [];
    var photoCount = Math.max(images.length, Number(gallery._photoCountV8) || 0);
    if (images.length < 2 && photoCount > 1) {
      return loadSelectedPhotoListV116(gallery, direction);
    }
    if (showPreparedPhotoV120(gallery, Number(gallery._indexV8 || 0) + Number(direction || 0), renderDetailPhoto)) return;
    transitionPhotoV8140(gallery, direction, function() {
      renderDetailPhoto(gallery, Number(gallery._indexV8 || 0) + Number(direction || 0));
    });
  }

  function photoLookupKeyV116(propertyId, originalId) {
    return state.detailRequestToken + ":" + propertyId + ":" + originalId;
  }

  function loadSelectedPhotoListV116(gallery, direction) {
    var propertyId = text(gallery._propertyIdV8), originalId = text(gallery._originalIdV8);
    var sourcePropertyId = text(gallery._sourcePropertyIdV116) || propertyId;
    var requestToken = state.detailRequestToken;
    var key = photoLookupKeyV116(propertyId, originalId);
    var counter = gallery.querySelector(".unified-detail-photo-count-v8");
    if (state.openPropertyId !== propertyId || state.openOriginalId !== originalId) return;
    var pending = state.photoLookupsV116[key];
    if (pending) { pending.direction = direction; return pending.promise; }
    if (Date.now() < Number(gallery._photoLookupRetryAtV116 || 0)) {
      return;
    }
    if (counter) counter.textContent = "다음 사진 불러오는 중…";
    var entry = {direction: direction};
    function currentGallery() {
      if (requestToken !== state.detailRequestToken || state.openPropertyId !== propertyId || state.openOriginalId !== originalId) return null;
      var body = document.getElementById("unifiedDetailBodyV8");
      var live = body && body.querySelector(".unified-detail-gallery-v8");
      return live && text(live._originalIdV8) === originalId ? live : null;
    }
    function readPhotos() { return apiGet("unifiedListingPhotos", {propertyId: sourcePropertyId, originalId: originalId}); }
    entry.promise = readPhotos().catch(function(error) {
      var status = Number(error && error.status || 0);
      // One bounded read-only retry for transient server/connection failures.
      // Never retry authorization, a changed source binding or a 15s deadline.
      if (!currentGallery() || !(status >= 500 || !status && error && error.name === "TypeError")) throw error;
      return new Promise(function(resolve) { global.setTimeout(resolve, 250); }).then(function() {
        var live = currentGallery();
        return live && (live._imagesV8 || []).length < 2 ? readPhotos() : null;
      });
    }).then(function(result) {
      var live = currentGallery();
      if (!live) return;
      var images = result && Array.isArray(result.images) ? originalImages({source: gallery._sourceNameV116, images: result.images}) : [];
      if (!result || result.ok === false || text(result.originalId) !== originalId ||
          text(result.propertyId) !== sourcePropertyId || images.length < 2) {
        throw new Error("선택한 광고의 추가 사진 목록을 확인하지 못했습니다.");
      }
      if ((live._imagesV8 || []).length > 1) return;
      // A full-detail response may already have supplied newer photos while
      // this smaller request was pending. Keep its current valid URL list.
      if ((live._imagesV8 || []).length < 2) {
        live._imagesV8 = images;
        live._photoCountV8 = live._imagesV8.length;
      }
      rememberPhotosV118(live._photoIdentityV118, sourcePropertyId, live._imagesV8);
      live.removeAttribute("data-photo-list-error-v116");
      delete live._photoLookupRetryAtV116;
      renderDetailPhoto(live, entry.direction < 0 ? live._imagesV8.length - 1 : entry.direction > 0 ? 1 : 0);
    }).catch(function(error) {
      var live = currentGallery();
      if (!live || (live._imagesV8 || []).length > 1) return;
      live._photoLookupRetryAtV116 = Date.now() + 2000;
      var status = Number(error && error.status || 0);
      var code = status ? "PHOTO_HTTP_" + status : error && error.name === "TimeoutError" ? "PHOTO_TIMEOUT" : "PHOTO_LIST_FAILED";
      live.setAttribute("data-photo-list-error-v116", code);
      var label = live.querySelector(".unified-detail-photo-count-v8");
      if (label) label.textContent = "사진 목록 조회 실패 · 다음 버튼으로 재시도";
    }).finally(function() {
      if (state.photoLookupsV116[key] === entry) delete state.photoLookupsV116[key];
    });
    state.photoLookupsV116[key] = entry;
    return entry.promise;
  }

  function openDetailGallery(button) {
    if (button && button.closest(".unified-favorite-embedded-detail-v7")) return;
    var gallery = button && button.closest(".unified-detail-gallery-v8");
    if (!gallery) return;
    var propertyId = text(gallery._propertyIdV8), originalId = text(gallery._originalIdV8);
    var token = state.detailRequestToken;
    function show() {
      if (token !== state.detailRequestToken || state.openPropertyId !== propertyId || state.openOriginalId !== originalId) return;
      var body = document.getElementById("unifiedDetailBodyV8");
      var live = body && body.querySelector(".unified-detail-gallery-v8");
      if (!live || text(live._originalIdV8) !== originalId ||
          ((live._imagesV8 || []).length < 2 && Number(live._photoCountV8) > 1)) return;
      openGallery(encodeURIComponent(propertyId), encodeURIComponent(originalId), Number(live._indexV8 || 0), live);
    }
    if ((gallery._imagesV8 || []).length < 2 && Number(gallery._photoCountV8) > 1) {
      var request = loadSelectedPhotoListV116(gallery, 0);
      if (request) return request.then(show);
      return;
    }
    show();
  }

  function prepareOpenPhotosV118() {
    var body = document.getElementById("unifiedDetailBodyV8");
    var gallery = body && body.querySelector(".unified-detail-gallery-v8");
    // Only the selected ad, once per opening. A failed list is retried by an
    // explicit user action; rendering or periodic refresh cannot create loops.
    if (gallery && (gallery._imagesV8 || []).length < 2 && Number(gallery._photoCountV8) > 1) {
      loadSelectedPhotoListV116(gallery, 0);
    }
  }

  function adoptOpenPhotoPathsV119() {
    var body = state.openPropertyId && document.getElementById("unifiedDetailBodyV8");
    var gallery = body && body.querySelector(".unified-detail-gallery-v8");
    if (!gallery || (gallery._imagesV8 || []).length > 1) return;
    var sourcePropertyId = text(gallery._sourcePropertyIdV116) || state.openPropertyId;
    var original = (state.groups[sourcePropertyId] || []).filter(function(row) {
      return text(row.originalId) === text(gallery._originalIdV8) && text(row.source) === text(gallery._sourceNameV116);
    })[0];
    if (!original || !original.photoPathsV119) return;
    var images = originalImages(original);
    if (images.length < 2) return;
    var pending = state.photoLookupsV116[photoLookupKeyV116(state.openPropertyId, text(gallery._originalIdV8))];
    gallery._imagesV8 = images;
    gallery._photoCountV8 = images.length;
    gallery._photoIdentityV118 = Object.assign({}, original);
    gallery.removeAttribute("data-photo-list-error-v116");
    renderDetailPhoto(gallery, pending && pending.direction < 0 ? images.length - 1 : pending && pending.direction > 0 ? 1 : 0);
  }

  function detailImageError(image) {
    if (image && image._photoLoadCleanupV114) return;
    var gallery = image && image.closest(".unified-detail-gallery-v8");
    var images = gallery && gallery._imagesV8 || [];
    if (!gallery || !images.length) return imageError(image, false);
    var failed = gallery._failedImagesV8 || (gallery._failedImagesV8 = {});
    failed[images[Number(gallery._indexV8 || 0)]] = true;
    var nextIndex = -1;
    for (var step = 1; step <= images.length; step += 1) {
      var candidate = (Number(gallery._indexV8 || 0) + step) % images.length;
      if (!failed[images[candidate]]) { nextIndex = candidate; break; }
    }
    if (nextIndex >= 0) return renderDetailPhoto(gallery, nextIndex);
    gallery.innerHTML = '<div class="unified-gallery-empty-v8">사진을 불러오지 못했습니다.</div>';
  }

  function showDetailPhotoLookupFailure(propertyId, requestToken) {
    if (requestToken !== state.detailRequestToken || state.openPropertyId !== propertyId) return;
    var body = document.getElementById("unifiedDetailBodyV8");
    var gallery = body && body.querySelector(".unified-detail-gallery-v8");
    if (!gallery || (gallery._imagesV8 || []).length > 1 || Number(gallery._photoCountV8) < 2) return;
    var counter = gallery.querySelector(".unified-detail-photo-count-v8");
    if (state.photoLookupsV116[photoLookupKeyV116(propertyId, text(gallery._originalIdV8))]) return;
    if (gallery.hasAttribute("data-photo-list-error-v116")) return;
    if (counter) counter.textContent = "추가 사진 조회 실패 · 다음 버튼으로 재시도";
  }

  function synchronizeDetailOriginals(propertyId, originals) {
    var master = resolveMasterItem(propertyId);
    if (!master || !originals.length || state.groups[propertyId] === originals || originals.some(function(original) {
      return !text(original.originalId) || text(original.propertyId) && text(original.propertyId) !== propertyId;
    })) return false;
    var previousFacts = detailListFactsV121(master, state.groups[propertyId] || []);
    var nextFacts = detailListFactsV121(master, originals);
    var unchangedList = previousFacts !== null && previousFacts === nextFacts;
    // A clicked property's fresh original response is evidence for that property,
    // not a coherent replacement for the full CSV/original snapshot cache.
    state.groups[propertyId] = originals;
    delete state.sourceSnapshotProofKeys[propertyId];
    state.snapshotRevision = "";
    attach([master]);
    if (unchangedList) {
      // Keep current list projections pointing at the fresh source records,
      // without allocating/filtering the entire inventory for extra photos or
      // description text. Confirmed financial/availability changes still refilter.
      var displayed = (global.currentItems || []).filter(function(item) { return text(item.propertyId) === propertyId; })[0];
      if (displayed && Array.isArray(displayed.unifiedDisplayOriginalsV2)) {
        var incoming = sourceOriginalIndex(originals);
        var matched = displayed.unifiedDisplayOriginalsV2.map(function(original) { return sameSourceOriginal(incoming, original); });
        if (matched.every(Boolean)) {
          displayed.unifiedDisplayOriginalsV2 = matched;
          displayed.unifiedOriginalsV8 = matched;
          displayed.unifiedAllOriginalsV1 = master.unifiedAllOriginalsV1;
          displayed.unifiedFilterOriginalV2 = sameSourceOriginal(incoming, displayed.unifiedFilterOriginalV2) || matched[0];
        }
      }
      return false;
    }
    if (typeof global.applyFilter === "function") {
      global.applyFilter();
      return true;
    }
    return false;
  }

  function detailListFactsV121(master, originals) {
    // Sale grouping/finances and date-filter modes retain the complete existing
    // refresh path. Only skip a lease refresh when all projected list facts match.
    if (!originals.length || Number(global.newListingDays || 0) || text(master.tradeType) === "sale" ||
        originals.some(function(original) { return text(original.tradeType) === "sale"; })) return null;
    return JSON.stringify(originals.map(function(original) {
      var item = originalDisplayItem(master, original);
      var scalars = Object.keys(item).sort().filter(function(key) {
        var value = item[key];
        return value == null || /^(?:string|number|boolean)$/.test(typeof value);
      }).map(function(key) { return [key, item[key]]; });
      return {
        id: text(original.originalId), identity: sourceIdentity(original),
        parent: text(original.propertyId) || text(master.propertyId),
        scalars: scalars, presence: item.displayValuePresence,
        sourceIds: Array.from(new Set(item.sourceListingSearchV6579 || [])).sort(),
        thumbnail: originalImage(original), contacts: Number(original.contactCount) || 0,
        unavailable: isSourceUnavailable(original), candidate: isCandidateOriginal(original),
        absence: absenceConfirmationTime(original), missing: Number(original.missingCount) || 0,
        revision: Number(original.revision) || 1, fallback: !!original.masterFallback,
        availability: text(original.availabilityKind), manual: text(original.manualDisplayFields),
        latitude: text(original.latitude), longitude: text(original.longitude),
        address: text(original.address || master.address), disclosure: text(original.addressDisclosure),
        preserveRepresentative: !!original.preserveRepresentative, tradeType: text(original.tradeType)
      };
    }));
  }

  function sourceCheckedTime(original) {
    var raw = text(original && original.lastCheckedAt);
    if (!raw) return 0;
    var parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sourceOriginalIndex(originals) {
    var index = {ids: Object.create(null), identities: Object.create(null)};
    originals.forEach(function(original) {
      index.ids[text(original.originalId)] = original;
      var identity = sourceIdentity(original);
      if (identity) index.identities[identity] = Object.prototype.hasOwnProperty.call(index.identities, identity) ? null : original;
    });
    return index;
  }

  function sameSourceOriginal(index, target) {
    if (!target) return null;
    var exact = index.ids[text(target.originalId)];
    var identity = sourceIdentity(target);
    if (exact && (!identity || !sourceIdentity(exact) || sourceIdentity(exact) === identity)) return exact;
    return identity ? index.identities[identity] || null : null;
  }

  function detailResponseIsOlder(propertyId, originals) {
    var known = sourceOriginalIndex(state.groups[propertyId] || []);
    return originals.some(function(original) {
      var previous = sameSourceOriginal(known, original);
      if (!previous) return false;
      var oldTime = sourceCheckedTime(previous), newTime = sourceCheckedTime(original);
      if (oldTime && (!newTime || newTime < oldTime)) return true;
      // With no newer evidence, an old cache must not end a currently active
      // ad or resurrect an inactive one merely because its row ID still matches.
      return isSourceUnavailable(previous) !== isSourceUnavailable(original) && (!newTime || newTime <= oldTime);
    });
  }

  function prepareDetailOriginals(propertyId, originals, originalId, options) {
    if (detailMembersV55(propertyId).length > 1) {
      var members = detailMembersV55(propertyId), selectedGroupOriginal = null;
      var checked = [], retry = false;
      members.forEach(function(member) {
        var own = originals.filter(function(original) { return text(original.propertyId) === member; });
        var wanted = own.some(function(original) { return text(original.originalId) === originalId; }) ? originalId : "";
        // Validate and synchronize each actual parent independently. Never
        // replace one parent's raw source group with the union from the view.
        var prepared = prepareSingleDetailOriginalsV55(member, own, wanted, Object.assign({}, options, {groupedV55: true}));
        retry = retry || !!prepared.retry;
        checked = checked.concat(prepared.originals);
        if (wanted) selectedGroupOriginal = prepared.selected;
      });
      if (!retry && !(options && options.fromCache)) {
        var masters = members.map(resolveMasterItem).filter(Boolean);
        members.forEach(function(member) {
          state.groups[member] = originals.filter(function(original) { return text(original.propertyId) === member; });
          delete state.sourceSnapshotProofKeys[member];
        });
        state.snapshotRevision = "";
        attach(masters);
        if (typeof global.applyFilter === "function") global.applyFilter();
      }
      checked = detailOriginals(checked, propertyId).map(function(original) {
        return Object.assign({}, original, {displayGroupPropertyIdV55: propertyId});
      });
      if (originalId && !checked.some(function(original) { return text(original.originalId) === originalId; })) {
        state.detailStatus[propertyId] = "filtered";
        return {originals: [], retry: false};
      }
      state.detailStatus[propertyId] = retry ? "mismatch" : "";
      return {originals: checked, selected: selectedGroupOriginal || checked[0], retry: retry};
    }
    return prepareSingleDetailOriginalsV55(propertyId, originals, originalId, options);
  }

  function prepareSingleDetailOriginalsV55(propertyId, originals, originalId, options) {
    var before = displayedOriginalProjection(propertyId);
    var previous = (before || state.groups[propertyId] || []).filter(function(original) {
      return text(original.originalId) === originalId;
    })[0];
    var wantedIdentity = sourceIdentity(previous) || state.openOriginalIdentity;
    if (!originals.length) {
      state.detailStatus[propertyId] = "mismatch";
      return {originals: detailOriginals(state.groups[propertyId] || [], propertyId), retry: true};
    }
    var selectedExists = !originalId || originals.some(function(original) {
      var identity = sourceIdentity(original);
      return text(original.originalId) === originalId && (!wantedIdentity || !identity || identity === wantedIdentity) ||
        wantedIdentity && identity === wantedIdentity;
    });
    var incomingIndex = sourceOriginalIndex(originals);
    var missingKnownSource = (state.groups[propertyId] || []).some(function(original) {
      return !sameSourceOriginal(incomingIndex, original);
    });
    // A normal HTTP response can still be an old R2 snapshot containing only
    // the selected ad. Verify missing siblings with one forced current read
    // before replacing a newer complete group with that partial response.
    var unverifiedMissingSource = missingKnownSource && !(options && options.forceFresh);
    if (!selectedExists || unverifiedMissingSource || detailResponseIsOlder(propertyId, originals)) {
      state.detailStatus[propertyId] = "mismatch";
      delete state.detailCache[propertyId];
      delete state.detailCachedAt[propertyId];
      return {originals: detailOriginals(state.groups[propertyId] || [], propertyId), retry: true};
    }
    // A five-minute browser cache is presentation only. It cannot replace a
    // newer full-snapshot group, even when it happens to contain matching IDs.
    var fromCache = !!(options && options.fromCache);
    var refreshedList = !fromCache && !(options && options.groupedV55) && synchronizeDetailOriginals(propertyId, originals);
    var visible = detailOriginals(originals, propertyId);
    if (refreshedList && before && !displayedOriginalProjection(propertyId)) {
      visible = [];
      state.detailStatus[propertyId] = visibleOriginalsFrom(originals, propertyId).length ? "filtered" : "unavailable";
    } else if (!visible.length) {
      state.detailStatus[propertyId] = visibleOriginalsFrom(originals, propertyId).length ? "mismatch" : "unavailable";
    }
    var selected = visible.filter(function(original) { return text(original.originalId) === originalId; })[0];
    if (!selected && wantedIdentity) {
      var sameIdentity = visible.filter(function(original) { return sourceIdentity(original) === wantedIdentity; });
      if (sameIdentity.length === 1) selected = sameIdentity[0];
    }
    if (!selected && originalId && visible.length) {
      state.detailStatus[propertyId] = "mismatch";
      return {originals: [], retry: true};
    }
    if (visible.length) state.detailStatus[propertyId] = "";
    var knownIndex = fromCache ? sourceOriginalIndex(state.groups[propertyId] || []) : null;
    var needsCurrentPhoto = fromCache && visible.some(function(original) {
      var known = sameSourceOriginal(knownIndex, original);
      return known && !originalImage(known) && !!originalImage(original);
    });
    // Hover-prefetched detail can be fresh while the list still has an older
    // compact financial projection. Do not publish browser cache over a newer
    // snapshot: verify once through the existing forced-read path on open.
    var needsCurrentSaleFacts = fromCache && visible.some(function(original) {
      var known = sameSourceOriginal(knownIndex, original);
      if (!known || original.tradeType !== "sale") return false;
      var incoming = original.saleSummary || original.saleDetails || {};
      var current = known.saleSummary || known.saleDetails || {};
      return ["totalDeposit", "monthlyIncome", "monthlyNetIncome", "statedMonthlyIncome", "loanAmount",
        "investmentAmount", "advertisedYield", "descriptionUnitAssumptions", "rentalReference", "rentalScenarios", "rentalBreakdown"].some(function(key) {
        return JSON.stringify(incoming[key] == null ? null : incoming[key]) !==
          JSON.stringify(current[key] == null ? null : current[key]);
      });
    });
    return {originals: visible, selected: selected || visible[0],
      retry: needsCurrentPhoto || needsCurrentSaleFacts || state.detailStatus[propertyId] === "mismatch"};
  }

  function refreshOpenDetail(propertyId, originalId, requestToken, measurement, force) {
    return loadDetail(propertyId, force).then(function(originals) {
      if (requestToken !== state.detailRequestToken || state.openPropertyId !== propertyId ||
          state.openOriginalId !== originalId) return;
      var body = document.getElementById("unifiedDetailBodyV8");
      var active = document.activeElement;
      // Do not replace a form while the user is editing it. The fresh response
      // remains cached and is used the next time the card is opened.
      if (body && active && body.contains && body.contains(active) &&
          (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName || ""))) return;
      var prepared = prepareDetailOriginals(propertyId, originals, originalId, {forceFresh: !!force});
      if (prepared.retry && !force && !state.detailRefreshRetries[propertyId]) {
        state.detailRefreshRetries[propertyId] = 1;
        return refreshOpenDetail(propertyId, originalId, requestToken, measurement, true);
      }
      originals = prepared.originals;
      var gallery = body && body.querySelector(".unified-detail-gallery-v8");
      var photoIndex = gallery ? Number(gallery._indexV8 || 0) : 0;
      var scrollTop = body ? body.scrollTop : 0;
      var selected = prepared.selected || originals.filter(function(original) {
        return text(original.originalId) === originalId;
      })[0] || originals[0];
      state.openOriginalId = text(selected && selected.originalId);
      state.openOriginalIdentity = sourceIdentity(selected);
      var incomingPhotos = originalImages(selected), currentPhotos = gallery && gallery._imagesV8 || [];
      var samePhotos = incomingPhotos.length === currentPhotos.length && incomingPhotos.every(function(url, index) {
        return url === currentPhotos[index];
      });
      var keepPhotos = gallery && selected && text(gallery._originalIdV8) === state.openOriginalId &&
        text(gallery._sourcePropertyIdV116) === (text(selected.propertyId) || propertyId) &&
        text(gallery._sourceNameV116) === text(selected.source) &&
        (samePhotos || currentPhotos.length > 1 && incomingPhotos.length < 2 &&
          (state.detailStatus[propertyId] === "mismatch" || Number(selected.photoCount) > 1));
      if (keepPhotos) {
        gallery._photoIdentityV118 = Object.assign({}, selected);
        gallery._downloadNameV73 = text(selected.address || selected.buildingName || propertyId);
        if (incomingPhotos.length > 1) gallery._photoCountV8 = incomingPhotos.length;
      }
      renderDetail(propertyId, originals, state.openOriginalId, keepPhotos ? {gallery: gallery} : null);
      body = document.getElementById("unifiedDetailBodyV8");
      gallery = body && body.querySelector(".unified-detail-gallery-v8");
      if (gallery && photoIndex > 0 && !keepPhotos) renderDetailPhoto(gallery, photoIndex);
      if (Object.prototype.hasOwnProperty.call(state.pendingDetailSteps, propertyId)) {
        showDetailPhotoLookupFailure(propertyId, requestToken);
      }
      if (body) body.scrollTop = scrollTop;
      if (originals.length && global.JSLocalMetricsV1) global.JSLocalMetricsV1.finish(measurement);
    }).catch(function(error) {
      if (requestToken === state.detailRequestToken && state.openPropertyId === propertyId && state.openOriginalId === originalId) {
        state.detailStatus[propertyId] = "error";
        var body = document.getElementById("unifiedDetailBodyV8");
        var gallery = body && body.querySelector(".unified-detail-gallery-v8");
        var originals = displayedOriginals(propertyId);
        var keepGallery = gallery && text(gallery._originalIdV8) === originalId && originals.some(function(original) {
          return text(original.originalId) === originalId;
        });
        renderDetail(propertyId, originals, originalId, keepGallery ? {gallery: gallery} : null);
      }
      showDetailPhotoLookupFailure(propertyId, requestToken);
      console.warn("매물 상세 최신화 실패 · 기존 정보를 유지합니다.", error);
    });
  }

  function resetDetailOpeningScrollV34() {
    var body = document.getElementById("unifiedDetailBodyV8");
    if (!body) return;
    // A new user open starts at the photo/summary, including warm cached ads.
    // Do not reset from renderDetail: background refresh and rotation preserve
    // the position the user has already reached in the same open detail.
    if (typeof body.scrollTo === "function") body.scrollTo({top: 0, left: 0, behavior: "instant"});
    else body.scrollTop = 0;
    if (body._saleDossierSyncV3) body._saleDossierSyncV3();
  }

  function open(encodedPropertyId, encodedOriginalId) {
    if (global.JSQueryListingsV152 && global.JSQueryListingsV152.guardIds([decodeURIComponent(encodedPropertyId || "")], function() {open(encodedPropertyId, encodedOriginalId);})) return;
    var measurement = global.JSLocalMetricsV1 ? global.JSLocalMetricsV1.start("detail") : null;
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var originalId = decodeURIComponent(encodedOriginalId || "");
    var requestToken = ++state.detailRequestToken;
    state.detailPhotoRetryCount = 0;
    state.detailRefreshRetries[propertyId] = 0;
    state.detailStatus[propertyId] = "pending";
    delete state.pendingDetailSteps[propertyId];
    state.openPropertyId = propertyId;
    var initial = displayedOriginals(propertyId);
    var wanted = initial.filter(function(original) { return text(original.originalId) === originalId; })[0] || initial[0];
    state.openOriginalIdentity = sourceIdentity(wanted);
    var cached = detailMembersV55(propertyId).length > 1 ? null : state.detailCache[propertyId];
    if (cached) {
      var prepared = prepareDetailOriginals(propertyId, cached, originalId || text(wanted && wanted.originalId), {fromCache: true});
      cached = prepared.originals;
      state.openOriginalId = text(prepared.selected && prepared.selected.originalId) || originalId || text(cached[0] && cached[0].originalId);
      renderDetail(propertyId, cached, state.openOriginalId);
      prepareOpenPhotosV118();
      resetDetailOpeningScrollV34();
      if (cached.length && global.JSLocalMetricsV1) global.JSLocalMetricsV1.finish(measurement);
      if (prepared.retry || !detailIsFresh(propertyId)) return refreshOpenDetail(propertyId, state.openOriginalId, requestToken, measurement, prepared.retry);
      return;
    }
    if (!originalId && initial[0]) originalId = text(initial[0].originalId);
    state.openOriginalId = originalId;
    renderDetail(propertyId, initial, originalId);
    prepareOpenPhotosV118();
    resetDetailOpeningScrollV34();
    if (initial.length && global.JSLocalMetricsV1) global.JSLocalMetricsV1.finish(measurement);
    return refreshOpenDetail(propertyId, originalId, requestToken, measurement);
  }

  function loadContacts(propertyId) {
    propertyId = text(propertyId);
    if (!propertyId) return Promise.resolve({ok: true, propertyId: "", contactCount: 0, contacts: []});
    if (Object.prototype.hasOwnProperty.call(state.contactCache, propertyId)) {
      return Promise.resolve(state.contactCache[propertyId]);
    }
    if (state.contactPending[propertyId]) return state.contactPending[propertyId];
    var propertyGeneration = Number(state.detailPropertyGeneration[propertyId]) || 0;
    var request = apiGet("unifiedListingContacts", {propertyId: propertyId}).then(function(result) {
      if (propertyGeneration === (Number(state.detailPropertyGeneration[propertyId]) || 0)) state.contactCache[propertyId] = result;
      if (state.contactPending[propertyId] === request) delete state.contactPending[propertyId];
      return result;
    }, function(error) {
      if (state.contactPending[propertyId] === request) delete state.contactPending[propertyId];
      throw error;
    });
    state.contactPending[propertyId] = request;
    return request;
  }

  function getCachedContacts(propertyId) {
    propertyId = text(propertyId);
    return Object.prototype.hasOwnProperty.call(state.contactCache, propertyId)
      ? state.contactCache[propertyId]
      : null;
  }

  function tellCacheKey(query) {
    return text(query).toLowerCase().replace(/\s+/g, " ");
  }

  function getCachedTellContacts(query) {
    var key = tellCacheKey(query);
    var cached = state.tellCache[key];
    if (!cached || Date.now() - cached.at > 300000) {
      if (cached) delete state.tellCache[key];
      return null;
    }
    return cached.result;
  }

  function loadTellContacts(query) {
    query = text(query);
    var key = tellCacheKey(query);
    if (!key) return Promise.resolve({ok: true, query: "", contacts: []});
    var cached = getCachedTellContacts(query);
    if (cached) return Promise.resolve(cached);
    if (state.tellPending[key]) return state.tellPending[key];
    var request = apiGet("tellContacts", {query: query}).then(function(result) {
      state.tellCache[key] = {at: Date.now(), result: result};
      delete state.tellPending[key];
      var keys = Object.keys(state.tellCache);
      if (keys.length > 20) {
        keys.sort(function(left, right) { return state.tellCache[left].at - state.tellCache[right].at; })
          .slice(0, keys.length - 20).forEach(function(oldKey) { delete state.tellCache[oldKey]; });
      }
      return result;
    }, function(error) {
      delete state.tellPending[key];
      throw error;
    });
    state.tellPending[key] = request;
    return request;
  }

  function renderTellResults(results, result) {
    var contacts = result && result.contacts || [];
    results.innerHTML = contacts.length ? contacts.map(function(contact) {
      return '<a href="tel:' + esc(contact.phone) + '"><span><b>' + esc(contact.address) + ' ' +
        esc(contact.room) + '</b><small>' + esc(contact.buildingName) + ' · ' + esc(contact.role) +
        '</small></span><strong>' + esc(contact.phone) + '</strong></a>';
    }).join("") : '<p>검색되는 연락처가 없습니다.</p>';
  }

  function closeDetail() {
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    cancelPhotoTransitionV1(drawer && drawer.querySelector(".unified-detail-gallery-v8"), true);
    clearPreparedPhotosV120();
    if (!drawer) return;
    var wasVisible = drawer.getAttribute("aria-hidden") !== "true";
    if (detailCloseTimerV827) global.clearTimeout(detailCloseTimerV827);
    drawer.classList.remove("opening-v827");
    drawer.classList.add("closing-v827");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    detailCloseTimerV827 = global.setTimeout(function() {
      drawer.classList.remove("closing-v827");
      detailCloseTimerV827 = null;
    }, 300);
    state.openPropertyId = "";
    state.openOriginalId = "";
    state.detailRequestToken += 1;
    if (wasVisible && global.JSDialogFocusV1) global.JSDialogFocusV1.deactivate(drawer);
  }

  function closeDetailForOverlay() {
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    cancelPhotoTransitionV1(drawer && drawer.querySelector(".unified-detail-gallery-v8"), true);
    clearPreparedPhotosV120();
    if (detailCloseTimerV827) {
      global.clearTimeout(detailCloseTimerV827);
      detailCloseTimerV827 = null;
    }
    if (drawer) {
      drawer.classList.remove("open", "opening-v827", "closing-v827");
      drawer.setAttribute("aria-hidden", "true");
    }
    closeGallery(false);
    if (drawer && global.JSDialogFocusV1) global.JSDialogFocusV1.deactivate(drawer, {restore: false});
    // Compact headers keep their close button focused across body refreshes.
    // A market/overlay transition must not leave focus inside the hidden detail.
    var active = document.activeElement;
    if (active && typeof active.closest === "function" && typeof active.blur === "function" &&
        active.closest("#unifiedDetailDrawerV8,#unifiedGalleryV8")) active.blur();
    state.openPropertyId = "";
    state.openOriginalId = "";
    state.detailRequestToken += 1;
  }

  function isDetailOpenForPropertyV8143(propertyId) {
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    return !!drawer && drawer.getAttribute("aria-hidden") !== "true" &&
      text(state.openPropertyId) === text(propertyId);
  }

  function toggleCardDetail(encodedPropertyId) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    if (!propertyId) return false;
    if (isDetailOpenForPropertyV8143(propertyId)) {
      closeDetail();
      return false;
    }
    open(encodeURIComponent(propertyId));
    return true;
  }

  function imageError(image, showLabel) {
    if (!image) return;
    var parent = image.parentElement;
    image.remove();
    if (!parent) return;
    parent.classList.remove("has-photo");
    parent.classList.add("no-photo");
    if (showLabel && !parent.querySelector("span")) parent.insertAdjacentHTML("beforeend", "<span>사진 조회 실패</span>");
  }

  function thumbnailImageError(image) {
    if (!image || !image.parentElement) return;
    var original = text(image.getAttribute("data-thumbnail-source-v8144"));
    var proxy = thumbnailProxyUrl(original);
    image._jsThumbnailFailedV8144 = true;
    // If the provider's small variant is unavailable, retry the exact saved
    // photo before the existing once-only authenticated proxy recovery.
    if (original && thumbnailDisplayImageUrlV69(original) !== original &&
        !image._jsThumbnailOriginalTriedV69 && image.getAttribute('src') !== original && image.getAttribute('src') !== proxy) {
      image._jsThumbnailOriginalTriedV69 = true;
      image.src = original;
      return;
    }
    // Healthy thumbnails still load directly. Only a failed request uses the
    // existing authenticated image cache, once per thumbnail element.
    if (proxy && !image._jsThumbnailProxyTriedV8144 && image.getAttribute("src") !== proxy) {
      image._jsThumbnailProxyTriedV8144 = true;
      image.src = proxy;
      return;
    }
    // Phone cards declare display:block!important. Hide only this failed image
    // without letting its broken-image box cover the failure message.
    image.style.setProperty("display", "none", "important");
    var parent = image.parentElement;
    parent.classList.remove("has-photo");
    parent.classList.add("no-photo");
    if (!parent.querySelector("[data-thumbnail-error-v8144]")) {
      parent.insertAdjacentHTML("beforeend", '<span data-thumbnail-error-v8144>사진 불러오기 실패</span>');
    }
  }

  function thumbnailImageLoaded(image) {
    if (!image || !image.parentElement) return;
    image._jsThumbnailFailedV8144 = false;
    image.style.display = "";
    var parent = image.parentElement;
    parent.classList.remove("no-photo");
    parent.classList.add("has-photo");
    var label = parent.querySelector("[data-thumbnail-error-v8144]");
    if (label) label.remove();
    var sourceV159=image.getAttribute('src'),decodedV159=typeof image.decode==='function'?image.decode():Promise.resolve();
    decodedV159.then(function(){if(image.getAttribute('src')!==sourceV159)return;if(image.dataset)image.dataset.thumbnailDecodedV159='true';global.JSQueryThumbsV159?.measure();},function(){});
  }

  function detailImageLoaded(image) {
    if (!image) return;
    var original = text(image.getAttribute("data-detail-source-v8144"));
    var loadedSource = text(image.getAttribute("src"));
    if (!original || !loadedSource || (loadedSource !== original && loadedSource !== detailDisplayImageUrl(original) &&
        loadedSource !== thumbnailProxyUrl(original) && loadedSource !== thumbnailProxyUrl(detailDisplayImageUrl(original)))) return;
    // Repair only already-failed thumbnails of this exact photo. Do not
    // rerender the list or fetch other listings when a detail photo succeeds.
    document.querySelectorAll(".unified-thumb-v8 img[data-thumbnail-source-v8144]").forEach(function(thumbnail) {
      if (!thumbnail._jsThumbnailFailedV8144 || text(thumbnail.getAttribute("data-thumbnail-source-v8144")) !== original) return;
      var recovered = thumbnail._jsThumbnailRecoverySourcesV8144 || (thumbnail._jsThumbnailRecoverySourcesV8144 = []);
      if (recovered.indexOf(loadedSource) >= 0) return;
      recovered.push(loadedSource);
      if (loadedSource === thumbnailProxyUrl(original)) thumbnail._jsThumbnailProxyTriedV8144 = true;
      thumbnail.src = loadedSource;
    });
  }

  function setSaving(active, failed) {
    if (global.JSAsyncMutations && typeof global.JSAsyncMutations.setExternalState === "function") {
      global.JSAsyncMutations.setExternalState(!!active, !!failed);
      return;
    }
    var indicator = document.getElementById("asyncMutationStatusV1");
    if (indicator) indicator.className = "async-mutation-status-v1 " +
      (failed ? "failed" : (active ? "working" : "idle"));
  }

  var mergeNoticeTimerV8139 = null;
  function showMergeNoticeV8139(message, stateName, persistent) {
    var notice = document.getElementById("unifiedMergeNoticeV8139");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "unifiedMergeNoticeV8139";
      notice.className = "unified-merge-notice-v8139";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      document.body.appendChild(notice);
    }
    if (mergeNoticeTimerV8139) {
      global.clearTimeout(mergeNoticeTimerV8139);
      mergeNoticeTimerV8139 = null;
    }
    notice.className = "unified-merge-notice-v8139 " + text(stateName || "working");
    notice.textContent = text(message);
    notice.hidden = false;
    if (!persistent) {
      mergeNoticeTimerV8139 = global.setTimeout(function() {
        notice.hidden = true;
        mergeNoticeTimerV8139 = null;
      }, 4200);
    }
    return notice;
  }

  function refreshAfterMoveV8139(result, consolidateWholeMaster, cacheInvalidatedV94) {
    return Promise.resolve(cacheInvalidatedV94).then(function() {
      if (global.JSListingRefreshV1 && typeof global.JSListingRefreshV1.refreshMoved === "function" && result.affectedPropertyIds) {
        return global.JSListingRefreshV1.refreshMoved(result).then(function(applied) {
          if (!applied) throw new Error("변경 매물 조회를 다시 확인해 주세요.");
          return true;
        });
      }
      if (global.JSListingRefreshV1 && typeof global.JSListingRefreshV1.reloadAfterMutation === "function") {
        return global.JSListingRefreshV1.reloadAfterMutation();
      }
      return load(true);
    }).then(function(refreshed) {
      if (refreshed === false || refreshed && refreshed.ok === false) throw new Error("최신 목록 조회 실패");
      if (global.JSListingRefreshV1 && typeof global.JSListingRefreshV1.reloadAfterMutation === "function") return result;
      if (typeof global.loadSheet !== "function") return result;
      return Promise.resolve(global.loadSheet(true)).then(function(applied) {
        if (applied === false) throw new Error("최신 목록 조회 실패");
        return result;
      });
    }).then(function() {
      if (state.pendingProofCount || state.originalLoadPhase !== "ready") {
        showMergeNoticeV8139("저장은 완료됐습니다. 최신 원본 연결을 확인하고 있습니다.", "warning", false);
        return result;
      }
      showMergeNoticeV8139(consolidateWholeMaster
        ? "대표매물 통합 완료 · 최신 목록 반영도 끝났습니다."
        : "매물 변경 완료 · 최신 목록 반영도 끝났습니다.", "success", false);
      return result;
    }).catch(function(error) {
      console.warn("[대표매물] 저장 후 목록 동기화 실패", error);
      showMergeNoticeV8139("저장은 완료됐지만 최신 목록 동기화가 지연됩니다. 잠시 후 새로고침해 주세요.", "warning", false);
      return result;
    });
  }

  function removeConsolidatedMasterFromView(sourceMasterId, targetMasterId) {
    sourceMasterId = text(sourceMasterId);
    targetMasterId = text(targetMasterId);
    if (!sourceMasterId || !targetMasterId || sourceMasterId === targetMasterId) return;

    var sourceOriginals = state.groups[sourceMasterId] || [];
    var targetOriginals = state.groups[targetMasterId] || [];
    var seenOriginals = {};
    state.groups[targetMasterId] = targetOriginals.concat(sourceOriginals).filter(function(original) {
      var key = text(original && original.originalId) || [
        text(original && original.source), text(original && original.sourceId)
      ].join(":");
      if (!key || seenOriginals[key]) return false;
      seenOriginals[key] = true;
      if (original) original.propertyId = targetMasterId;
      return true;
    });
    delete state.groups[sourceMasterId];

    ["allItems", "currentItems", "visibleListItems"].forEach(function(name) {
      if (!Array.isArray(global[name])) return;
      global[name] = global[name].filter(function(item) {
        return text(item && item.propertyId) !== sourceMasterId;
      });
    });
    if (text(global.selectedItemKey) || text(global.selectedListCardIdV845)) {
      var selectedStillExists = (global.allItems || []).some(function(item) {
        if (text(global.selectedListCardIdV845) && typeof global.getLinkedSelectionCardIdV845 === "function") {
          return text(global.getLinkedSelectionCardIdV845(item)) === text(global.selectedListCardIdV845);
        }
        return text(item && item.key) === text(global.selectedItemKey);
      });
      if (!selectedStillExists) {
        if (typeof global.clearLinkedListingSelectionV845 === "function") {
          global.clearLinkedListingSelectionV845();
        } else {
          global.selectedItemKey = null;
          global.selectedListCardIdV845 = null;
        }
      }
    }
    attach(global.allItems || [], {groups: state.groups});
    if (typeof global.applyFilter === "function") global.applyFilter();
  }

  function move(originalId, targetMasterId, revision, sourceMasterId) {
    var requestId = "move-original-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    var consolidateWholeMaster = text(sourceMasterId) && targetMasterId !== "NEW";
    setSaving(true, false);
    var action = consolidateWholeMaster ? "consolidateExistingMasters" : "moveOriginalListing";
    var payload = consolidateWholeMaster
      ? {requestId:requestId, primaryMasterId:targetMasterId, duplicateMasterIds:[sourceMasterId]}
      : {requestId:requestId, originalId:originalId, targetMasterId:targetMasterId, expectedRevision:revision};
    var request = global.JSDataAccessV6 && typeof global.JSDataAccessV6.mutate === "function"
      ? global.JSDataAccessV6.mutate(action, payload, { errorMessage: "저장 요청 실패" })
      : Promise.reject(new Error("공통 데이터 연결이 준비되지 않았습니다."));
    return request.then(function(result) {
      var persisted = consolidateWholeMaster
        ? Number(result && result.consolidated || 0) > 0
        : result && result.persisted === true;
      if (!result || result.ok === false || !persisted) throw new Error(result && result.message || "D1 저장 확인 실패");
      // Invalidate synchronously before announcing success. Other tabs and a
      // reload must reject the old full snapshot, even if IDB deletion is slow.
      var cacheInvalidatedV94 = global.JSInitialListingsCacheV1 &&
        typeof global.JSInitialListingsCacheV1.clear === "function" ? global.JSInitialListingsCacheV1.clear() : null;
      invalidatePendingLoad();
      setSaving(false, false);
      if (consolidateWholeMaster) removeConsolidatedMasterFromView(sourceMasterId, targetMasterId);
      if (!result.affectedPropertyIds) state.loaded = false;
      invalidateDetails();
      state.pendingMove = null;
      setMoveBannerSaving(false);
      var moveBanner = document.getElementById("unifiedMoveBannerV8");
      if (moveBanner) moveBanner.hidden = true;
      closeDetail();
      showMergeNoticeV8139(result && result.separated
        ? "별도 매물 분리 완료 · 최신 목록을 동기화하고 있습니다."
        : (consolidateWholeMaster
          ? "대표매물 통합 완료 · 이전 카드를 제거했고 최신 목록을 동기화하고 있습니다."
          : "원본매물 이동 완료 · 최신 목록을 동기화하고 있습니다."), "success syncing", true);
      /*
       * 서버가 저장과 캐시 무효화를 확인한 순간 사용자에게 완료를 알린다.
       * 전체 통합정보와 전체 CSV 재조회는 수 초 걸릴 수 있으므로 안내를
       * 지연시키지 않고 백그라운드에서 이어 간다.
       */
      refreshAfterMoveV8139(result, consolidateWholeMaster, cacheInvalidatedV94);
      return result;
    }).catch(function(error) {
      setSaving(false, true);
      setMoveBannerSaving(false);
      showMergeNoticeV8139(error.message || "통합매물 변경에 실패했습니다.", "failed", false);
      throw error;
    });
  }

  function separate(encodedOriginalId, revision) {
    var originalId = decodeURIComponent(encodedOriginalId || "");
    if (!confirm("이 원본매물을 별도의 실제 공간으로 분리할까요?")) return;
    move(originalId, "NEW", revision);
  }

  function startMove(encodedOriginalId, revision) {
    if (!confirm("현재 상세창의 원본매물 1개만 다른 대표매물에 합치시겠습니까?\n\n같은 묶음의 나머지 원본매물은 그대로 유지됩니다.")) return;
    state.pendingMove = {mode: "original", originalId: decodeURIComponent(encodedOriginalId || ""), revision: revision,
      sourcePropertyId: text(state.openPropertyId)};
    closeDetail();
    var banner = ensureMoveBanner();
    setMoveBannerSaving(false);
    banner.hidden = false;
  }

  function startWholeMasterMove(encodedPropertyId) {
    var sourcePropertyId = decodeURIComponent(encodedPropertyId || "") || text(state.openPropertyId);
    if (!sourcePropertyId) return;
    if (!confirm("현재 대표매물 전체를 다른 대표매물에 합치시겠습니까?\n\n현재 매물의 모든 원본·사진·연결정보가 이동하고 현재 대표카드는 제거됩니다. 대상 매물의 대표정보와 임대조건은 그대로 유지됩니다.")) return;
    state.pendingMove = {mode: "whole", sourcePropertyId: sourcePropertyId};
    closeDetail();
    var banner = ensureMoveBanner();
    setMoveBannerSaving(false);
    banner.hidden = false;
  }

  function setMoveBannerSaving(saving) {
    var banner = document.getElementById("unifiedMoveBannerV8");
    if (!banner) return;
    var message = banner.querySelector("strong");
    var cancel = banner.querySelector("button");
    banner.classList.toggle("saving", !!saving);
    if (message) message.textContent = saving
      ? "통합 저장·D1 확인 중입니다."
      : (state.pendingMove && state.pendingMove.mode === "whole"
        ? "전체를 합칠 대상 대표매물 카드 또는 체크박스를 클릭하세요."
        : "원본 1개를 합칠 대상 매물 카드 또는 체크박스를 클릭하세요.");
    if (cancel) cancel.disabled = !!saving;
  }

  function ensureMoveBanner() {
    var banner = document.getElementById("unifiedMoveBannerV8");
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = "unifiedMoveBannerV8";
    banner.className = "unified-move-banner-v8";
    banner.innerHTML = '<strong>이동할 통합매물 카드 또는 체크박스를 클릭하세요.</strong><button type="button">취소</button>';
    banner.querySelector("button").onclick = function() { state.pendingMove = null; banner.hidden = true; };
    document.body.appendChild(banner);
    return banner;
  }

  function handleCardClick(item, event) {
    var propertyId = text(item && item.propertyId);
    if (state.pendingMove) {
      var pending = state.pendingMove;
      if (!propertyId) return false;
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (pending.sourcePropertyId && pending.sourcePropertyId === propertyId) {
        alert("이미 이 통합매물에 연결된 원본입니다. 다른 통합매물을 선택해 주세요.");
        return true;
      }
      var wholeMaster = pending.mode === "whole";
      var confirmed = wholeMaster
        ? confirm("선택한 매물을 대표로 유지하고 현재 대표매물 전체를 합칠까요?\n\n현재 대표카드는 제거되며 이 작업은 화면에서 되돌릴 수 없습니다.")
        : confirm("선택한 원본매물 1개만 이 매물에 합칠까요?\n\n기존 묶음의 나머지 원본매물은 이동하지 않습니다.");
      if (confirmed) {
        setMoveBannerSaving(true);
        if (wholeMaster) move("", propertyId, 1, pending.sourcePropertyId);
        else move(pending.originalId, propertyId, pending.revision);
      }
      return true;
    }
    if (event && event.target && event.target.closest("button,input,label,a,textarea,select")) return false;
    if (isDetailOpenForPropertyV8143(propertyId)) {
      closeDetail();
      return true;
    }
    if (typeof global.selectListingOnMapV844 === "function") {
      global.selectListingOnMapV844(item);
    }
    open(encodeURIComponent(propertyId));
    return true;
  }

  function openGallery(encodedPropertyId, encodedOriginalId, startIndex, liveGallery) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var originalId = decodeURIComponent(encodedOriginalId || "");
    var originals = visibleOriginalsFrom(state.detailCache[propertyId] || allOriginals(propertyId), propertyId);
    var original = originals.filter(function(entry) { return entry.originalId === originalId; })[0];
    var images = liveGallery && text(liveGallery._propertyIdV8) === propertyId &&
      text(liveGallery._originalIdV8) === originalId ? (liveGallery._imagesV8 || []).slice() : originalImages(original);
    if (!images.length) return;
    var modal = document.getElementById("unifiedGalleryV8");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "unifiedGalleryV8";
      modal.className = "unified-gallery-modal-v8";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "매물 사진 크게 보기");
      modal.setAttribute("aria-hidden", "true");
      modal.innerHTML = '<button class="close" type="button" aria-label="사진 크게 보기 닫기">×</button>' +
        '<button class="unified-gallery-nav-v8 prev" type="button" aria-label="이전 사진">‹</button>' +
        '<img alt="매물 사진" referrerpolicy="no-referrer">' +
        '<button class="unified-gallery-nav-v8 next" type="button" aria-label="다음 사진">›</button>' +
        '<span></span>' +
        '<button type="button" class="unified-photo-download-v73" aria-label="선택한 광고의 사진 전체 ZIP 다운로드">↓ 전체 저장</button>';
      modal.querySelector(".close").onclick = function(event) {
        event.stopPropagation();
        closeGallery();
      };
      modal.querySelector(".prev").onclick = function(event) {
        event.stopPropagation();
        stepGallery(-1);
      };
      modal.querySelector(".next").onclick = function(event) {
        event.stopPropagation();
        stepGallery(1);
      };
      modal.querySelector(".unified-photo-download-v73").onclick = function(event) {
        event.stopPropagation();
        downloadPhotoV73(this);
      };
      modal.onclick = function(event) {
        if (event.target === modal) closeGallery();
      };
      modal.addEventListener("keydown", function(event) {
        if (!modal.classList.contains("open") || !global.JSDialogFocusV1) return;
        global.JSDialogFocusV1.handleKeydown(modal, event, closeGallery);
      });
      document.body.appendChild(modal);
    }
    cancelPhotoTransitionV1(modal, true);
    var index = wrapPhotoIndexV8141(startIndex, images.length);
    modal._imagesV8 = images.slice();
    modal._propertyIdV8 = propertyId;
    modal._originalIdV8 = originalId;
    modal._photoCountV8 = Math.max(images.length, Number(original && original.photoCount) || 0);
    modal._downloadNameV73 = text(original && (original.address || original.buildingName) || propertyId);
    bindPhotoSwipe(modal, function(direction) { stepGallery(direction); });
    renderGalleryImage(modal, index);
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    if (global.JSDialogFocusV1) global.JSDialogFocusV1.activate(modal, modal.querySelector(".close"));
  }

  function renderGalleryImage(modal, index) {
    var images = modal && modal._imagesV8 || [];
    if (!modal || !images.length) return;
    var safeIndex = wrapPhotoIndexV8141(index, images.length);
    modal._indexV8 = safeIndex;
    var displaySource = safeIndex === 0 ? text(images[safeIndex]) : detailDisplayImageUrl(images[safeIndex]);
    var modalImage = modal.querySelector("img");
    modalImage = adoptPendingPhotoV124(modal, displaySource) || modalImage;
    try { modalImage.fetchPriority = "high"; } catch (ignore) {}
    loadPhotoV114(modal, modalImage, displaySource, text(images[safeIndex]));
    modal.querySelector("span:not(.photo-transition-ghost-v1)").textContent = (safeIndex + 1) + " / " + images.length;
    modal.querySelector(".prev").disabled = images.length < 2;
    modal.querySelector(".next").disabled = images.length < 2;
    preloadAdjacentDetailImages(images, safeIndex);
  }

  function stepGallery(direction) {
    var modal = document.getElementById("unifiedGalleryV8");
    if (!modal || !modal.classList.contains("open")) return;
    if (showPreparedPhotoV120(modal, Number(modal._indexV8 || 0) + Number(direction || 0), renderGalleryImage)) return;
    transitionPhotoV8140(modal, direction, function() {
      renderGalleryImage(modal, Number(modal._indexV8 || 0) + Number(direction || 0));
    });
  }

  var photoDownloadPendingV73 = false;
  var photoDownloadNoticeTimerV73 = null;
  function photoDownloadUrlV73(value) {
    if (!text(value)) return "";
    try {
      var url = new URL(text(value), global.location.href);
      if (url.username || url.password) return "";
      if (url.origin === global.location.origin && /^https?:$/.test(url.protocol)) return url.href;
      return thumbnailProxyUrl(url.href);
    } catch (ignore) { return ""; }
  }

  function photoDownloadFilenameV73(name, index, contentType) {
    var extensions = {"image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/gif":"gif",
      "image/avif":"avif", "image/bmp":"bmp", "image/svg+xml":"svg", "image/tiff":"tiff"};
    var extension = extensions[text(contentType).split(";")[0].trim().toLowerCase()];
    if (!extension) return "";
    var label = text(name).replace(/[<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, "_").split("").map(function(character) {
      var code = character.charCodeAt(0);
      return code < 32 || code === 127 ? "_" : character;
    }).join("").slice(0, 80).replace(/[.\s]+$/, "") || "매물";
    return "JS부동산_" + label + "_사진_" + String(Math.max(0, Number(index) || 0) + 1).padStart(2, "0") + "." + extension;
  }

  function photoDownloadNoticeV73(message) {
    var notice = document.getElementById("unifiedPhotoDownloadNoticeV73");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "unifiedPhotoDownloadNoticeV73";
      notice.className = "unified-photo-download-notice-v73";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      document.body.appendChild(notice);
    }
    global.clearTimeout(photoDownloadNoticeTimerV73);
    notice.textContent = message;
    notice.hidden = false;
    photoDownloadNoticeTimerV73 = global.setTimeout(function() { notice.hidden = true; }, 5000);
  }

  function photoZipV74(entries) {
    // ZIP STORE: preserve the collected image bytes, UTF-8 names and CRC-32.
    // No compression library or third-party requests are needed for photos.
    var parts = [], directory = [], offset = 0, directorySize = 0, table = new Uint32Array(256);
    for (var code = 0; code < 256; code += 1) {
      var value = code;
      for (var bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
      table[code] = value >>> 0;
    }
    entries.forEach(function(entry) {
      var name = new TextEncoder().encode(entry.name), bytes = entry.bytes;
      var crc = 0xffffffff;
      for (var i = 0; i < bytes.length; i += 1) {
        crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 255];
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      var local = new Uint8Array(30), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x800, true); lv.setUint16(12, 33, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, bytes.length, true);
      lv.setUint32(22, bytes.length, true); lv.setUint16(26, name.length, true);
      var central = new Uint8Array(46), cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x800, true); cv.setUint16(14, 33, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, bytes.length, true);
      cv.setUint32(24, bytes.length, true); cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      parts.push(local, name, bytes); directory.push(central, name);
      offset += local.length + name.length + bytes.length;
      directorySize += central.length + name.length;
    });
    var end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true); ev.setUint32(12, directorySize, true);
    ev.setUint32(16, offset, true);
    return new Blob(parts.concat(directory, [end]), {type: "application/zip"});
  }

  async function downloadPhotoV73(button) {
    if (photoDownloadPendingV73) return;
    var gallery = button && button.closest(".unified-detail-gallery-v8,#unifiedGalleryV8");
    if (!gallery) return;
    // Snapshot the ad before awaiting. Changing photos or ads must not mix files.
    var name = gallery._downloadNameV73, propertyId = text(gallery._propertyIdV8);
    var originalId = text(gallery._originalIdV8), images = (gallery._imagesV8 || []).slice();
    var expected = Math.max(images.length, Number(gallery._photoCountV8) || 0);
    var controller = new AbortController();
    var timer = global.setTimeout(function() { controller.abort(); }, 180000);
    var imageTimer, entries = [], totalBytes = 0;
    photoDownloadPendingV73 = true;
    function progress(label) {
      document.querySelectorAll(".unified-photo-download-v73").forEach(function(node) {
        node.disabled = true; node.textContent = label;
      });
    }
    async function detailPhotos(force) {
      // Bound detail hydration as well as each photo request; leave the shared
      // cache request intact for other consumers when this download times out.
      var timeout;
      try {
        return await Promise.race([loadDetail(propertyId, force), new Promise(function(resolve, reject) {
          timeout = global.setTimeout(function() { reject(new Error("전체 사진 목록 조회가 늦어 중단했습니다. 다시 눌러 주세요.")); }, 30000);
        })]);
      } finally { global.clearTimeout(timeout); }
    }
    progress("사진 확인 중…");
    try {
      if (!global.JSDataAccessV6 || typeof global.JSDataAccessV6.readImageBlob !== "function") throw new Error("사진 다운로드 연결이 준비되지 않았습니다. 새로고침 후 다시 눌러 주세요.");
      // List cards can carry only one thumbnail while photoCount is ten.
      // Reuse the normal detail request, then verify once against fresh detail.
      var originals = await detailPhotos(false);
      var selected = originals.filter(function(original) { return text(original.originalId) === originalId; })[0];
      if (selected) {
        images = originalImages(selected);
        expected = Math.max(expected, Number(selected.photoCount) || 0, images.length);
      }
      if (images.length < expected) {
        originals = await detailPhotos(true);
        selected = originals.filter(function(original) { return text(original.originalId) === originalId; })[0];
        images = selected ? originalImages(selected) : [];
        expected = Math.max(expected, Number(selected && selected.photoCount) || 0, images.length);
      }
      if (!selected || !images.length || images.length < expected) throw new Error("전체 사진 " + expected + "장 중 " + images.length + "장만 확인됩니다. 누락 없이 저장하려면 잠시 후 다시 눌러 주세요.");
      if (images.length > 100) throw new Error("사진이 100장을 초과해 전체 저장을 준비하지 못했습니다.");
      for (var index = 0; index < images.length; index += 1) {
        if (controller.signal.aborted) throw new Error("사진 다운로드 시간이 초과되었습니다.");
        var url = photoDownloadUrlV73(images[index]);
        if (!url) throw new Error((index + 1) + "번째 사진 주소를 확인하지 못해 전체 저장을 중단했습니다.");
        progress("저장 준비 " + index + "/" + images.length);
        imageTimer = global.setTimeout(function() { controller.abort(); }, 30000);
        var photo = await global.JSDataAccessV6.readImageBlob(url, {signal: controller.signal});
        global.clearTimeout(imageTimer);
        var filename = photoDownloadFilenameV73(name, index, photo.contentType);
        if (!filename) throw new Error((index + 1) + "번째 사진 형식을 지원하지 않습니다.");
        totalBytes += photo.blob.size;
        if (totalBytes > 120 * 1024 * 1024) throw new Error("사진 전체 용량이 120MB를 초과해 저장을 중단했습니다.");
        entries.push({name: filename, bytes: new Uint8Array(await photo.blob.arrayBuffer())});
      }
      progress("ZIP 준비 중…");
      var objectUrl = URL.createObjectURL(photoZipV74(entries));
      var anchor = document.createElement("a");
      anchor.href = objectUrl; anchor.download = photoDownloadFilenameV73(name, 0, "image/jpeg").replace(/_사진_01\.jpg$/, "_사진전체_" + entries.length + "장.zip");
      document.body.appendChild(anchor);
      try { anchor.click(); } finally {
        anchor.remove();
        global.setTimeout(function() { URL.revokeObjectURL(objectUrl); }, 60000);
      }
      photoDownloadNoticeV73("사진 " + entries.length + "장 전체 ZIP 다운로드를 요청했습니다. 브라우저 다운로드 목록에서 확인해 주세요.");
    } catch (error) {
      var message = text(error && error.message);
      photoDownloadNoticeV73(controller.signal.aborted ? "사진 다운로드 응답이 늦어 중단했습니다. 다시 눌러 주세요." :
        "전체 사진 저장을 중단했습니다 (" + entries.length + "/" + expected + "장 준비). " + (/[가-힣]/.test(message) ? message : "네트워크 연결을 확인하고 다시 눌러 주세요."));
    } finally {
      controller.abort(); global.clearTimeout(timer); global.clearTimeout(imageTimer); photoDownloadPendingV73 = false;
      document.querySelectorAll(".unified-photo-download-v73").forEach(function(node) {
        node.disabled = false; node.textContent = "↓ 전체 저장";
      });
    }
  }

  function closeGallery(restoreFocus) {
    var modal = document.getElementById("unifiedGalleryV8");
    if (!modal) return;
    cancelPhotoTransitionV1(modal, true);
    var wasOpen = modal.classList.contains("open");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (!drawer || drawer.getAttribute("aria-hidden") === "true") clearPreparedPhotosV120();
    if (wasOpen && global.JSDialogFocusV1) {
      global.JSDialogFocusV1.deactivate(modal, {restore: restoreFocus !== false});
    }
  }

  function closeTell(restoreFocus) {
    var modal = document.getElementById("tellModalV8");
    if (!modal) return;
    var wasOpen = modal.classList.contains("open");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    state.tellRequestToken += 1;
    if (wasOpen && global.JSDialogFocusV1) {
      global.JSDialogFocusV1.deactivate(modal, {restore: restoreFocus !== false});
    }
  }

  function resolveTellReturnFocusV8(detailDrawer) {
    var active = document.activeElement;
    var trigger = document.querySelector("button.search-tell-v8[onclick*='JSUnifiedListingsV8.openTell']");
    var activeIsInsideDetail = !!(detailDrawer && active && detailDrawer.contains(active));
    var candidate = (!active || active === document.body || activeIsInsideDetail) ? trigger : active;
    if (!global.JSDialogFocusV1 || typeof global.JSDialogFocusV1.isRestorable !== "function") {
      return candidate || trigger || null;
    }
    if (global.JSDialogFocusV1.isRestorable(candidate)) return candidate;
    return global.JSDialogFocusV1.isRestorable(trigger) ? trigger : null;
  }

  function openTell() {
    if (!desktop()) return;
    var detailDrawer = document.getElementById("unifiedDetailDrawerV8");
    var returnFocus = resolveTellReturnFocusV8(detailDrawer);
    closeDetailForOverlay();
    var modal = document.getElementById("tellModalV8");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "tellModalV8";
      modal.className = "tell-modal-v8";
      modal.setAttribute("aria-hidden", "true");
      modal.innerHTML = '<div class="tell-backdrop-v8" aria-hidden="true"></div>' +
        '<section role="dialog" aria-modal="true" aria-labelledby="tellModalTitleV8"><header><div>' +
        '<strong id="tellModalTitleV8">Tell 주소 연락처</strong>' +
        '<span>공실박스에서 수집된 번호를 매물 상태와 관계없이 조회합니다.</span></div>' +
        '<button type="button" aria-label="Tell 연락처 검색 닫기">×</button></header>' +
        '<form><input type="search" placeholder="예: 월평동 1197" autocomplete="off"><button type="submit">검색</button></form>' +
        '<div class="tell-results-v8"><p>주소를 입력해 주세요.</p></div></section>';
      modal.querySelector("header button").onclick = function() { closeTell(); };
      modal.querySelector(".tell-backdrop-v8").onclick = function() { closeTell(); };
      modal.addEventListener("keydown", function(event) {
        if (!modal.classList.contains("open") || !global.JSDialogFocusV1) return;
        global.JSDialogFocusV1.handleKeydown(modal, event, closeTell);
      });
      modal.querySelector("input").oninput = function() {
        var query = text(this.value);
        if (state.tellInputTimer && typeof global.clearTimeout === "function") {
          global.clearTimeout(state.tellInputTimer);
        }
        if (query.length < 2 || typeof global.setTimeout !== "function") return;
        state.tellInputTimer = global.setTimeout(function() {
          loadTellContacts(query).catch(function() {});
        }, 320);
      };
      modal.querySelector("form").onsubmit = function(event) {
        event.preventDefault();
        var query = text(modal.querySelector("input").value);
        var results = modal.querySelector(".tell-results-v8");
        if (!query) return;
        var cached = getCachedTellContacts(query);
        var requestToken = ++state.tellRequestToken;
        if (cached) renderTellResults(results, cached);
        else results.innerHTML = '<p>조회 중…</p>';
        loadTellContacts(query).then(function(result) {
          if (requestToken !== state.tellRequestToken || text(modal.querySelector("input").value) !== query) return;
          renderTellResults(results, result);
        }).catch(function(error) {
          if (requestToken === state.tellRequestToken) results.innerHTML = '<p>' + esc(error.message) + '</p>';
        });
      };
      document.body.appendChild(modal);
    }
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    if (global.JSDialogFocusV1) {
      global.JSDialogFocusV1.activate(modal, modal.querySelector("input"), {returnFocus: returnFocus});
    }
  }

  global.addEventListener("focus", function() {
    if (state.openPropertyId && !detailIsFresh(state.openPropertyId)) {
      refreshOpenDetail(state.openPropertyId, state.openOriginalId, state.detailRequestToken);
    }
  });

  global.addEventListener("js-async-mutation-finished", function(event) {
    var detail = event && event.detail || {};
    if (detail.ok && /^(toggleDone|updateProperty|deleteProperty|moveOriginalListing|consolidateExistingMasters)$/.test(detail.action || "")) {
      invalidateDetails();
    }
  });

  global.addEventListener("resize", syncDetailPresentationV2);
  global.addEventListener("js-phone-device-change", syncDetailPresentationV2);

  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("click", function(event) {
    var button = event.target && event.target.closest
      ? event.target.closest("button, [role='button']") : null;
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (!button || !drawer || drawer.contains(button) ||
        (!drawer.classList.contains("open") && !drawer.classList.contains("opening-v827"))) return;
    var action = text(button.getAttribute("onclick"));
    var opensOtherMenu = /(?:openOperationsCenter|openListManager|openQuickAddModal|startAiVisitPreview|JSUnifiedListingsV8\.openTell|toggleDetailFilter|toggleV6ActionMenu|toggleSortDropdown)/.test(action) ||
      button.matches("[data-mobile-action='quick-add'], [data-mobile-action='favorites'], [data-mobile-action='dashboard'], [data-mobile-action='filter']");
    if (opensOtherMenu) {
      closeDetailForOverlay();
    }
  }, true);

  global.addEventListener("keydown", function(event) {
    if (event.defaultPrevented || event.isComposing || (document.querySelector && document.querySelector("dialog[open]"))) return;
    var tellModal = document.getElementById("tellModalV8");
    if (tellModal && tellModal.classList.contains("open")) {
      if (event.key === "Escape") closeTell();
      return;
    }
    var gallery = document.getElementById("unifiedGalleryV8");
    if (gallery && gallery.classList.contains("open")) {
      if (event.key === "ArrowLeft") stepGallery(-1);
      if (event.key === "ArrowRight") stepGallery(1);
      if (event.key === "Escape") closeGallery();
      return;
    }
    var detailDrawer = document.getElementById("unifiedDetailDrawerV8");
    if (detailDrawer && detailDrawer.classList.contains("open") &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      var detailGallery = detailDrawer.querySelector(".unified-detail-gallery-v8");
      if (detailGallery && detailGallery._imagesV8 && detailGallery._imagesV8.length > 1) {
        event.preventDefault();
        renderDetailPhoto(detailGallery, Number(detailGallery._indexV8 || 0) +
          (event.key === "ArrowLeft" ? -1 : 1));
      }
      return;
    }
    if (event.key === "Escape") closeDetail();
  });

  global.JSUnifiedListingsV8 = {
    attachmentButtonHtml:attachmentButtonHtmlV181,openAttachments:openAttachmentsV181,attachmentCountChanged:attachmentCountChangedV181,
    cleanSourceDescription: cleanSourceDescriptionV140,
    sourceDescriptionHtml: sourceDescriptionHtmlV140, editableMemoText:editableMemoTextV144, memoEditorRawHtml:memoEditorRawHtmlV144,
    operatingMemoHtml: operatingMemoHtmlV140,
    clearPhotoCache: clearPhotoListsV118,
    acceptSavedFinancialEdit: acceptSavedFinancialEditV106,
    finishSelectedMerge: function(result) {
      if(result&&result.persisted){attachmentBadgesV181.counts.clear();attachmentBadgesV181.generation++;}
      if (result && result.persisted === true && typeof result.primaryOperatingMemo === "string") {
        var primary = resolveMasterItem(result.primaryPropertyId || result.primaryMasterId);
        if (primary) {
          primary.memo = result.primaryOperatingMemo;
          if (!global.JSQueryListingsV152?.active?.() && typeof global.applyFilter === "function") global.applyFilter();
        }
      }
      invalidatePendingLoad(); invalidateDetails(); closeDetail();
      showMergeNoticeV8139("선택매물 병합 저장 완료 · 변경된 매물을 반영하고 있습니다.", "success syncing", true);
      return refreshAfterMoveV8139(result, true, null);
    },
    prepareListThumbnails: prepareListThumbnailsV69,
    load: load, attach: attach, attachCompatible: attachCompatible, canCacheCompatible: canCacheCompatible,
    mergeScoped: mergeScoped, invalidatePendingLoad: invalidatePendingLoad,
    markSnapshotStale: function() { setOriginalLoadPhase("stale"); originalLoadStatus(); },
    getOriginalMetadataStatus: getOriginalMetadataStatus,
    pendingCompatibleIds: function() { return Object.keys(state.pendingProofIds); },
    cardParts: cardParts, matchesSource: matchesSource,
    allOriginals: allOriginals, queryGroupKeyV152: wholeBuildingKeyV55, visibleOriginals: group, refreshOriginalVisibility: function(items) { return attach(items); },
    isSourceUnavailable: isSourceUnavailable,
    isCandidateOriginal: isCandidateOriginal, filterItemForView: filterItemForView,
    collapseWholeBuildingSalesV55: collapseWholeBuildingSalesV55,
    personalCoverGroupKeyV86: personalCoverGroupKeyV86,
    personalCoverGroupRevisionV86: function() { return state.personalCoverGroupRevisionV86; },
    isTransactionCandidate: isTransactionCandidate, candidateSummary: candidateSummary,
    toggle: toggle, toggleCardDetail: toggleCardDetail, open: open, prefetch: prefetch, close: closeDetail,
    isOpenForProperty: isDetailOpenForPropertyV8143,
    closeForOverlay: closeDetailForOverlay, handleCardClick: handleCardClick,
    openGallery: openGallery, downloadPhoto: downloadPhotoV73, separate: separate, startMove: startMove,
    startWholeMasterMove: startWholeMasterMove, openTell: openTell,
    loadContacts: loadContacts, getCachedContacts: getCachedContacts, printItem: printItem,
    imageError: imageError, thumbnailImageError: thumbnailImageError, thumbnailImageLoaded: thumbnailImageLoaded,thumbnailDescriptorV159:thumbnailDescriptorV159,
    detailImageLoaded: detailImageLoaded, renderDetailPhoto: renderDetailPhoto, stepDetailPhoto: stepDetailPhoto,
    openDetailGallery: openDetailGallery, detailImageError: detailImageError,
    runDetailAction: runDetailAction, openExternalLink: openExternalLink
  };
})(window);
