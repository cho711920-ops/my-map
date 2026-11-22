// Follow the lease card's visible More menu while preserving sale controls.
export async function clickCardEditorV283(page,card){
  if(await card.locator('.lease-more-button-v283').count()){
    await card.locator('.lease-more-button-v283').click();
    const popup=page.locator('.lease-popup-v283');
    // A stale/account-blocked card intentionally opens no menu. Its caller
    // still asserts whether the editor must open or remain blocked.
    if(await popup.isVisible())await popup.getByRole('button',{name:'수정',exact:true}).click();
  }else await card.locator('.item-edit-btn-v630').click();
}
