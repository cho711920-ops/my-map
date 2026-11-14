import { test, expect } from "@playwright/test";

test('memo roles fill blank contact fields, preserve typed numbers, and stay on the selected master',async({page,context},info)=>{
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  const before=await page.evaluate(()=>{
    const item=allItems.find(i=>i.tradeType!=='sale');window.__memoContactItemV224=item;
    item.landlordPhone='';item.tenantPhone='';item.manualFinancialFieldsV106=[];
    item.memo='[26.11.13]임01011112222\n사장님 01022223333 / 사모 01033334444\n관리 0421234567 / 세입자 01044445555';
    const untouched=JSON.stringify(allItems.filter(i=>i!==item));openPropertyEditModalV630(encodeURIComponent('id:'+item.propertyId));return untouched;
  });
  await expect(page.locator('#peLandlordPhoneV630')).toHaveValue('010-1111-2222');
  await expect(page.locator('#peTenantPhoneV630')).toHaveValue('010-4444-5555');
  for(const role of ['임대인','사장','사모','관리','세입자'])await expect(page.locator('#propertyEditMemoContactsV224')).toContainText(role);
  await page.locator('#peMemoV630').fill('임대인 01055556666\n세입자 01077778888\n관리실 0421234567');
  await expect(page.locator('#peLandlordPhoneV630')).toHaveValue('010-5555-6666');
  await expect(page.locator('#peTenantPhoneV630')).toHaveValue('010-7777-8888');
  await expect(page.locator('#peMemoV630')).toBeFocused();
  await page.locator('#peTenantPhoneV630').fill('010-8888-9999');
  await page.locator('#peMemoV630').fill('임대인 01055556666\n세입자 01000001111');
  await expect(page.locator('#peTenantPhoneV630')).toHaveValue('010-8888-9999');
  await page.evaluate(()=>{window.postSafeMutationV654=async(action,body)=>{window.__contactWriteV224={action,body};throw Error('합성 저장 실패');};});
  await page.locator('#propertyEditSaveBtnV630').click();
  await expect(page.locator('#propertyEditStatusV630')).toContainText('입력 내용은 유지됩니다');
  const write=await page.evaluate(()=>window.__contactWriteV224);
  expect(write.action).toBe('updateProperty');expect(write.body.originalValues[9]).toBe('');
  expect(write.body.key.propertyId).toBe(await page.evaluate(()=>window.__memoContactItemV224.propertyId));
  expect(write.body.updated.landlordPhone).toBe('010-5555-6666');expect(write.body.updated.tenantPhone).toBe('010-8888-9999');
  expect(write.body.editedFields).toContain('landlordPhone');expect(write.body.editedFields).toContain('tenantPhone');
  await page.screenshot({path:info.outputPath('memo-contact-roles-v224.png')});
  await page.evaluate(()=>closePropertyEditModalV630());
  expect(await page.evaluate(()=>JSON.stringify(allItems.filter(i=>i!==window.__memoContactItemV224)))).toBe(before);
  expect(await page.evaluate(()=>window.__memoContactItemV224.landlordPhone)).toBe('');
  await page.evaluate(()=>{
    const item=window.__memoContactItemV224;item.landlordPhone='010-1212-3434';item.tenantPhone='';item.manualFinancialFieldsV106=['tenant_phone'];
    openPropertyEditModalV630(encodeURIComponent('id:'+item.propertyId));
  });
  await expect(page.locator('#peLandlordPhoneV630')).toHaveValue('010-1212-3434');
  // A historical empty column must not suppress the explicitly labelled memo.
  await expect(page.locator('#peTenantPhoneV630')).toHaveValue('010-4444-5555');
  await page.locator('#peTenantPhoneV630').fill('');
  await page.locator('#peMemoV630').fill('세입자 01066667777');
  await expect(page.locator('#peTenantPhoneV630')).toHaveValue('');
});

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
