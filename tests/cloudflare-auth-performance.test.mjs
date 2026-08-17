import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync("index.html", "utf8");
const auth = fs.readFileSync("js/auth-gate-v1.js", "utf8");
const authCss = fs.readFileSync("css/auth-gate-v1.css", "utf8");
const mobileCss = fs.readFileSync("css/mobile-app-v1.css", "utf8");
const headers = fs.readFileSync("_headers", "utf8");
const build = fs.readFileSync("tools/build-cloudflare-assets.mjs", "utf8");

test("only authentication assets execute before the session is approved", () => {
  assert.match(html, /<template id="jsAuthenticatedHeadAssets">[\s\S]*?dapi\.kakao\.com[\s\S]*?<\/template>/);
  assert.match(html, /<template id="jsAuthenticatedApplication">[\s\S]*?id="wrap" inert aria-hidden="true"[\s\S]*?<\/template>/);
  assert.match(html, /<template id="jsAuthenticatedBodyAssets">[\s\S]*?js\/data-access-v6\.js[\s\S]*?js\/map\.js[\s\S]*?<\/template>/);
  assert.match(auth, /if \(response\.ok\) \{[\s\S]*?await unlock\(result\.email\)/);
  assert.match(auth, /appendAuthenticatedApplication\(\);[\s\S]*?await appendAuthenticatedHeadAssets\(\);[\s\S]*?await appendAuthenticatedBodyAssets\(\)/);
  assert.match(auth, /const scripts = \[\][\s\S]*?document\.head\.appendChild\(node\.cloneNode\(true\)\)[\s\S]*?for \(const script of scripts\)/);
  assert.match(auth, /JSDataAccessV6\.warmInitialData\(\)/);
});

test("the authentication gate isolates the application and fits mobile viewports", () => {
  assert.match(auth, /application\.inert = !!locked/);
  assert.match(auth, /application\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(auth, /gate\.setAttribute\("aria-modal", "true"\)/);
  assert.match(authCss, /width: min\(420px, calc\(100vw - 40px\)\)/);
  assert.match(authCss, /\.js-auth-google iframe[\s\S]*?max-width: 100% !important/);
  assert.match(mobileCss, /#listToolbar > \.list-toolbar-control[\s\S]*?min-height: 44px !important/);
});

test("versioned assets receive immutable caching and security headers", () => {
  assert.doesNotMatch(html, /(?:src|href)="(?:js|css)\/[^"]+\.(?:js|css)"/);
  assert.match(headers, /\/js\/\*[\s\S]*?max-age=31536000, immutable/);
  assert.match(headers, /\/css\/\*[\s\S]*?max-age=31536000, immutable/);
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /Strict-Transport-Security:/);
  assert.match(build, /"_headers"/);
});
