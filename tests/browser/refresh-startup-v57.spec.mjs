import {test,expect} from '@playwright/test';

test('complete CSV parsing preserves source values and leaves list selection and reading position intact',async({page,context})=>{
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  const result=await page.evaluate(()=>{
    var before={count:visibleListItems.length,selected:selectedPrintKeys.slice(),scroll:document.getElementById('sidebar').scrollTop};
    var rows=Array.from({length:34000},(_,i)=>[String(i),'대전 서구 테스트동 '+i,'메모, 원문\r\n"보존"',JSON.stringify({monthlyIncome:215,totalDeposit:14500})]);
    var csv=rows.map(row=>row.map(cell=>'"'+cell.replaceAll('"','""')+'"').join(',')).join('\r\n');
    var started=performance.now(),parsed=parseCSVRecordsV655(csv);
    return {before,after:{count:visibleListItems.length,selected:selectedPrintKeys.slice(),scroll:document.getElementById('sidebar').scrollTop},
      count:parsed.length,first:parsed[0],last:parsed.at(-1),ms:performance.now()-started};
  });
  expect(result.count).toBe(34000);expect(result.last[0]).toBe('33999');
  expect(result.first.slice(1)).toEqual(['대전 서구 테스트동 0','메모, 원문\n"보존"','{"monthlyIncome":215,"totalDeposit":14500}']);
  expect(result.after).toEqual(result.before);
  console.log('synthetic-complete-CSV-ms',Math.round(result.ms));
});
