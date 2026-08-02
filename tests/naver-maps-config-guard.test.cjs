const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

(async function run() {
  const apiUrl = pathToFileURL(path.resolve(__dirname, "..", "api", "naver-maps-config.js"));
  const { default: handler } = await import(apiUrl.href);
  const previous = process.env.NAVER_MAPS_NCP_KEY_ID;

  try {
    process.env.NAVER_MAPS_NCP_KEY_ID = "X-NCP-APIGW-API-KEY-ID";
    const invalidResponse = createResponse();
    handler({ method: "GET" }, invalidResponse);
    assert.equal(invalidResponse.statusCode, 503);
    assert.deepEqual(invalidResponse.body, {
      enabled: false,
      error: "NAVER_MAPS_INVALID_CONFIG"
    });

    process.env.NAVER_MAPS_NCP_KEY_ID = "validClientId";
    const validResponse = createResponse();
    handler({ method: "GET" }, validResponse);
    assert.equal(validResponse.statusCode, 200);
    assert.equal(validResponse.body.enabled, true);
    assert.equal(validResponse.body.ncpKeyId, "validClientId");
    assert.equal(validResponse.headers["Cache-Control"], "no-store, max-age=0");
  } finally {
    if (previous === undefined) delete process.env.NAVER_MAPS_NCP_KEY_ID;
    else process.env.NAVER_MAPS_NCP_KEY_ID = previous;
  }

  console.log("NAVER Maps config guard tests passed");
})().catch(function(error) {
  console.error(error);
  process.exitCode = 1;
});
