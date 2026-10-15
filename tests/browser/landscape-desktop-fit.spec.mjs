import {test, expect} from "@playwright/test";

test.beforeEach(({browserName}, info) => test.skip(info.project.name !== "desktop", "Dedicated device contexts run once."));
const ua = "Mozilla/5.0 (Linux; Android 16) Chrome/140.0 Safari/537.36";
for (const [width, height] of [[740,360],[930,530],[1100,720]]) {
  test(`PC layout scales all controls together to ${width}px with one header row and usable taps`, async ({browser, baseURL}, info) => {
    const context = await browser.newContext({viewport:{width,height},screen:{width,height},userAgent:ua,isMobile:true,hasTouch:true,serviceWorkers:"block"});
    await context.route("**/*", r => new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort());
    try {
      const page = await context.newPage();
      const writes=[];
      page.on("request", r => {if(new URL(r.url()).pathname.startsWith("/api/") && r.method() !== "GET") writes.push(r.method());});
      await page.goto(baseURL);
      await expect(page.locator("html")).toHaveAttribute("data-fixture-ready","true");
      await expect(page.locator("html")).toHaveClass(/js-landscape-desktop-fit-v1/);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1280);
      await expect.poll(() => page.evaluate(() => visualViewport.scale)).toBeCloseTo(width/1280,3);
      await page.locator("#fixtureControls").evaluate(el => el.hidden=true);
      const data = await page.evaluate(() => {
        const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();
        return {search:box("#keyword"), actions:box(".v6-toolbar-secondary"), filter:box("#detailBtn"), map:box("#map"), rail:box("#mapQuickTools"), sidebar:box("#sidebar"), doc:document.documentElement.scrollWidth, width:innerWidth,height:innerHeight};
      });
      expect(data.doc).toBeLessThanOrEqual(1281);
      expect(data.search.y).toBeLessThan(16);
      expect(data.actions.y).toBeLessThan(16);
      expect(data.filter.y).toBeLessThan(16);
      expect(data.map.y).toBeLessThanOrEqual(61);
      expect(data.rail.right).toBeLessThanOrEqual(data.map.right+1);
      expect(data.sidebar.right).toBeLessThanOrEqual(1281);
      expect(data.map.bottom).toBeLessThanOrEqual(data.height+1);
      expect(data.sidebar.bottom).toBeLessThanOrEqual(data.height+1);
      await page.locator("#keyword").fill("괴정");
      await page.locator("#keyword").press("Enter");
      await expect(page.locator("#list .item")).toHaveCount(1);
      await page.locator("#detailBtn").tap();
      await expect(page.locator("#v6DetailSheetPortal")).toHaveClass(/open/);
      await page.locator(".v6-detail-sheet-close").tap();
      await page.locator("#list .item-building-name").first().tap();
      await expect(page.locator("#unifiedDetailDrawerV8")).toHaveAttribute("aria-hidden","false");
      await page.getByRole("button",{name:"상세매물보기 닫기",exact:true}).tap();
      await expect(page.locator("#unifiedDetailDrawerV8")).toBeHidden();
      await page.screenshot({path:info.outputPath("pc-fit-"+width+".png")});
      expect(writes).toEqual([]);
    } finally {await context.close();}
  });
}
