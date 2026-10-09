import { test, expect } from "@playwright/test";

test("conflict preserves the edit draft and requires explicit comparison before retry", async ({ page }) => {
  const writes = [];
  let latest;
  await page.route("**/api/data**", async route => {
    const request = route.request();
    const body = request.method() === "POST" ? request.postDataJSON() : {};
    const action = body.action || new URL(request.url()).searchParams.get("action");
    if (action === "updateProperty") {
      writes.push(body);
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({
        ok: false, code: "PROPERTY_EDIT_CONFLICT", message: "합성 동시수정 충돌"
      }) });
    }
    if (action === "listingChanges") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items: [latest] }) });
    }
    return route.continue();
  });
  await page.goto("/");
  await page.waitForFunction(() => typeof window.openPropertyEditModalV630 === "function" && window.allItems?.length);
  latest = await page.evaluate(() => {
    const item = window.allItems[0];
    item.room = "101호"; item.state = ""; item.memo = "열 때 메모";
    window.openPropertyEditModalV630(encodeURIComponent("id:" + item.propertyId));
    // A shared live item can change after the form opened. Its initial values
    // must remain frozen until the user explicitly compares and rebases.
    item.room = "102호"; item.state = "계약완료";
    return { property_id: item.propertyId, title: item.name, address: item.address,
      room: "102호", status: "계약완료", operating_memo: "열 때 메모", listing_type: item.type,
      deposit: item.deposit, monthly_rent: item.rent, maintenance_fee: item.fee,
      premium: item.premium, area_m2: item.area, landlord_phone: item.landlordPhone,
      tenant_phone: item.tenantPhone, contacts_json: "[]", main_source: item.source };
  });
  await page.locator("#peRoomV630").fill("103호");
  await page.locator("#peMemoV630").fill("저장하려던 메모 초안");
  await page.locator("#propertyEditSaveBtnV630").click();
  await expect(page.locator("#propertyEditConflictV1")).toBeVisible();
  await expect(page.locator("#propertyEditModalV630")).toHaveClass(/open/);
  await expect(page.locator("#peRoomV630")).toHaveValue("103호");
  await expect(page.locator("#peMemoV630")).toHaveValue("저장하려던 메모 초안");
  expect(writes).toHaveLength(1);
  expect(writes[0].originalValues[2]).toBe("101호");
  expect(writes[0].originalValues[12]).toBe("");
  await expect(page.getByRole("checkbox", { name: "호실 내 입력 유지", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "상태 내 입력 유지", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "메모 내 입력 유지", exact: true })).toBeChecked();
  await page.locator("#propertyEditSaveBtnV630").click();
  expect(writes).toHaveLength(1);
  await expect(page.locator("#propertyEditStatusV630")).toContainText("먼저 최신 값 비교");
  await page.getByRole("button", { name: "선택한 값으로 편집 계속 (아직 저장 안 함)", exact: true }).click();
  await expect(page.locator("#peRoomV630")).toHaveValue("102호");
  await expect(page.locator("#peStateV630")).toHaveValue("계약완료");
  await expect(page.locator("#peMemoV630")).toHaveValue("저장하려던 메모 초안");
  await expect(page.locator("#propertyEditConflictV1")).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(await page.evaluate(() => window.propertyEditOriginalValuesV1[2])).toBe("102호");
  expect(await page.evaluate(() => window.propertyEditOriginalValuesV1[12])).toBe("계약완료");
});

test("explicitly keeping my conflicting input only rebases it and never saves automatically", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.openPropertyEditModalV630 === "function" && window.allItems?.length);
  await page.evaluate(async () => {
    const item = window.allItems[0]; item.room = "101호"; item.state = "";
    window.openPropertyEditModalV630(encodeURIComponent("id:" + item.propertyId));
    document.getElementById("peRoomV630").value = "103호";
    window.JSDataAccessV6 = { ...window.JSDataAccessV6, read: async () => ({ items: [{ property_id: item.propertyId,
      title: item.name, address: item.address, room: "102호", status: "active", operating_memo: "",
      listing_type: item.type, deposit: item.deposit, monthly_rent: item.rent, maintenance_fee: item.fee,
      premium: item.premium, area_m2: item.area, contacts_json: "[]" }] }) };
    await window.showPropertyEditConflictV1({ room: "103호" });
  });
  await page.getByRole("checkbox", { name: "호실 내 입력 유지", exact: true }).check();
  await page.getByRole("button", { name: "선택한 값으로 편집 계속 (아직 저장 안 함)", exact: true }).click();
  await expect(page.locator("#peRoomV630")).toHaveValue("103호");
  expect(await page.evaluate(() => window.propertyEditOriginalValuesV1[2])).toBe("102호");
  await expect(page.locator("#propertyEditStatusV630")).toContainText("저장을 눌러");
  await expect(page.locator("#propertyEditModalV630")).toHaveClass(/open/);
});
