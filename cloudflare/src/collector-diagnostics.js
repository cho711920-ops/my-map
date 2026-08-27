// Bounded operational diagnostics only; never persist request URLs/credentials.
export function collectorDiagnostics(value) {
  const seen = new Set();
  const clean = value => String(value ?? "")
    .replace(/https?:\/\/[^\s]+/gi, "[요청주소]")
    .replace(/(?:bearer\s+\S+|(?:token|password|collectorKey|authorization)\s*[:=]\s*\S+)/gi, "[인증정보]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[이메일]")
    .replace(/\b0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}\b/g, "[연락처]")
    .replace(/[\r\n\t]+/g, " ").slice(0, 240);
  return (Array.isArray(value) ? value : []).slice(0, 600).map(item => ({
    stage: ["목록조회", "필수정보", "상세조회", "저장"].includes(item?.stage) ? item.stage : "상세조회",
    sourceId: /^[\w-]{1,64}$/.test(String(item?.sourceId || "")) ? String(item.sourceId) : "",
    message: clean(item?.message || "사유 미기록")
  })).filter(item => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 200);
}
