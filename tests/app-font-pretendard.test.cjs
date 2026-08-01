const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("css/app-font-v1.css", "utf8");

assert.match(
  html,
  /pretendard@v1\.3\.9\/dist\/web\/variable\/pretendardvariable-dynamic-subset\.min\.css/
);
assert.match(html, /css\/app-font-v1\.css\?v=1\.0\.0-pretendard/);
assert.ok(
  html.indexOf("css/app-font-v1.css") > html.indexOf("css/permit-diagnosis-v1.css"),
  "the app font override must load after component styles"
);
assert.match(css, /--js-app-font:\s*"Pretendard Variable", Pretendard/);
assert.match(css, /button,[\s\S]*?input,[\s\S]*?select,[\s\S]*?textarea/);
assert.match(css, /\.circle-marker[\s\S]*?font-family: var\(--js-app-font\) !important/);

console.log("Pretendard app font tests passed");
