const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const mapQuick = fs.readFileSync("js/map-quick-tools-v657.js", "utf8");

function periodRuntime() {
  const start = script.indexOf("function isTodayRegistration");
  const end = script.indexOf("function renderNextListChunk", start);
  assert.ok(start >= 0 && end > start, "new listing period runtime should be extractable");
  return script.slice(start, end);
}

test("view menus expose mutually exclusive today, 3, 7 and 15 day choices", () => {
  const ids = ["todayNewBtn", "newListing3DaysBtn", "newListing7DaysBtn", "newListing15DaysBtn"];
  let lastIndex = -1;
  ids.forEach((id) => {
    const index = html.indexOf(`id="${id}"`);
    assert.ok(index > lastIndex, `${id} should follow the shorter period`);
    lastIndex = index;
  });
  assert.match(html, /오늘 신규매물/);
  assert.match(html, /최근 3일 신규매물/);
  assert.match(html, /최근 7일 신규매물/);
  assert.match(html, /최근 15일 신규매물/);
  assert.match(html, /id="newListing3DaysBtn"[^>]+role="menuitemradio"/);
  assert.match(html, /id="mapQuickNew15DaysBtn"[^>]+role="menuitemradio"/);
  assert.match(html, /script\.js[^"']+new-listing-periods-v1=1/);
  assert.match(html, /map-quick-tools-v657\.js[^"']+new-listing-periods-v1=1/);
  assert.match(html, /style\.css[^"']+new-listing-periods-v1=1/);
});

test("registration date filter includes today and the preceding calendar days only", () => {
  const context = { console, Date };
  vm.createContext(context);
  vm.runInContext(periodRuntime(), context);
  const now = new Date(2026, 8, 1, 18, 30);

  assert.equal(context.isRegistrationWithinDays("26.09.01", 1, now), true);
  assert.equal(context.isRegistrationWithinDays("2026-08-31 23:59", 1, now), false);
  assert.equal(context.isRegistrationWithinDays("2026-08-30", 3, now), true);
  assert.equal(context.isRegistrationWithinDays("2026-08-29", 3, now), false);
  assert.equal(context.isRegistrationWithinDays("2026/08/26", 7, now), true);
  assert.equal(context.isRegistrationWithinDays("2026/08/25", 7, now), false);
  assert.equal(context.isRegistrationWithinDays("2026.08.18", 15, now), true);
  assert.equal(context.isRegistrationWithinDays("2026.08.17", 15, now), false);
  assert.equal(context.isRegistrationWithinDays("2026.09.02", 15, now), false);
  assert.equal(context.isRegistrationWithinDays("2026.02.30", 15, now), false);
});

test("selecting a period replaces the previous period and selecting it again clears it", () => {
  let refreshes = 0;
  const context = {
    console,
    Date,
    newListingDays: 0,
    todayNewOnly: false,
    syncFilterToggleControlsV844() {},
    applyFilter() { refreshes += 1; }
  };
  vm.createContext(context);
  vm.runInContext(periodRuntime(), context);

  context.toggleNewListingDays(3);
  assert.equal(context.newListingDays, 3);
  assert.equal(context.todayNewOnly, false);
  context.toggleNewListingDays(15);
  assert.equal(context.newListingDays, 15);
  context.toggleNewListingDays(15);
  assert.equal(context.newListingDays, 0);
  context.toggleTodayNewOnly();
  assert.equal(context.newListingDays, 1);
  assert.equal(context.todayNewOnly, true);
  assert.equal(refreshes, 4);
});

test("main list and map quick state share the selected period", () => {
  assert.match(script, /!newListingDays \|\| isRegistrationWithinDays\(item\.regDate, newListingDays\)/);
  assert.match(script, /newListingDays === 1 \? "오늘 신규매물" : "최근 " \+ newListingDays \+ "일 신규매물"/);
  for (const days of [1, 3, 7, 15]) {
    assert.match(mapQuick, new RegExp(`Number\\(window\\.newListingDays \\|\\| 0\\) === ${days}`));
  }
});
