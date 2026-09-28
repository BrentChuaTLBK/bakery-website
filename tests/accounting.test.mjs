import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {accountingTotals,parseAccountingAmount,monthRange,accountingSheetName} from '../assets/ordering/accounting.js';
import {buildAccountingWorkbook} from '../assets/ordering/accounting-export.js';
import {xlsxParts} from './helpers/xlsx-parts.mjs';

export const fixture={start:'2026-09-01',end:'2026-09-25',generated_at:'2026-09-25T00:00:00Z',legacy_count:0,
 categories:[{id:'website',name:'Website sales',kind:'sale',system_key:'website',revision:1},{id:'discount',name:'Discounts',kind:'expense',system_key:'discount',revision:1},{id:'fee',name:'Delivery fees',kind:'sale',system_key:'delivery_fee',revision:1},{id:'cost',name:'Delivery costs',kind:'expense',system_key:'delivery_cost',revision:1},{id:'cakes',name:'Custom cakes',kind:'sale',system_key:null,revision:1},{id:'ingredients',name:'Ingredients',kind:'expense',system_key:null,revision:1}],
 entries:[{id:'1',category_id:'website',entry_date:'2026-09-22',amount_cents:100000,note:'Payment approved',source:'Website',order_id:'delivery',reference:'TLB-A2B3C4'},{id:'2',category_id:'discount',entry_date:'2026-09-22',amount_cents:5000,note:'Payment approved',source:'Website'},{id:'3',category_id:'fee',entry_date:'2026-09-22',amount_cents:15000,note:'Payment approved',source:'Website'},{id:'delivery',category_id:'cost',entry_date:'2026-09-23',amount_cents:22550,note:'Courier',source:'Delivery cost',order_id:'delivery',reference:'TLB-A2B3C4',revision:1},{id:'4',category_id:'cakes',entry_date:'2026-09-23',amount_cents:250000,note:'Celebration cake',source:'Manual',revision:1},{id:'5',category_id:'ingredients',entry_date:'2026-09-24',amount_cents:25025,note:'=HYPERLINK("https://example.test","literal")',source:'Manual',revision:1}],
 deliveries:[{order_id:'delivery',reference:'TLB-A2B3C4',approval_date:'2026-09-22',fee_cents:15000,cost_cents:22550,cost_date:'2026-09-23',status:'completed',refund_label:false},{order_id:'missing',reference:'TLB-Z9Y8X7',approval_date:'2026-09-24',fee_cents:0,cost_cents:null,cost_date:null,status:'confirmed',refund_label:false}]
};
fixture.entries.forEach(e=>e.kind=fixture.categories.find(c=>c.id===e.category_id).kind);
fixture.summary=fixture.categories.map(c=>({id:c.id,name:c.name,sales_cents:fixture.entries.filter(e=>e.category_id===c.id&&e.kind==='sale').reduce((s,e)=>s+e.amount_cents,0),expense_cents:fixture.entries.filter(e=>e.category_id===c.id&&e.kind==='expense').reduce((s,e)=>s+e.amount_cents,0)}));
fixture.entries.find(e=>e.id==='4').client_name='=A1';
fixture.entries.find(e=>e.id==='4').payment_method='gcash';

test('net subtracts each expense once and missing delivery costs stay unknown',()=>{
 assert.deepEqual(accountingTotals(fixture),{sales:365000,expenses:52575,net:312425,deliveryDifference:-7550,missingCosts:1});
});
test('money parsing is exact, rejects fractions beyond cents and preserves blank/zero',()=>{
 assert.equal(parseAccountingAmount('0.29'),29);assert.equal(parseAccountingAmount('100.1'),10010);
 assert.equal(parseAccountingAmount('',true),null);assert.equal(parseAccountingAmount('0',true),0);
 for(const value of ['-1','1.001','1e4','Infinity','1,000','99999999',''])assert.throws(()=>parseAccountingAmount(value));
 assert.deepEqual(monthRange('2024-02'),{start:'2024-02-01',end:'2024-02-29'});assert.throws(()=>monthRange('2024-13'));
});
test('Excel worksheet names handle unsafe characters, collisions and reserved names',()=>{
 const used=new Set(['summary']);
 const names=['Summary','Summary','A/B','A:B','a:b','History',"'Cake'",'x'.repeat(100)].map(n=>accountingSheetName(n,used));
 assert.equal(new Set(names.map(n=>n.toLowerCase())).size,names.length);
 assert.equal(names.every(n=>n.length<=31&&!/[\\/*?:\[\]]/.test(n)),true);
});
test('real XLSX roundtrip keeps category sheets, formulas, currency, dates and hostile text literal',async()=>{
 const require=createRequire(import.meta.url);
 const ExcelJS=require(process.env.EXCELJS_TEST_PATH||resolve(import.meta.dirname,'../work/exceljs-4.4.0.min.cjs'));
 const wb=buildAccountingWorkbook(fixture,ExcelJS),bytes=await wb.xlsx.writeBuffer();
 assert.equal(String.fromCharCode(...bytes.slice(0,2)),'PK');
 const saved=new ExcelJS.Workbook();await saved.xlsx.load(bytes);
 assert.equal(saved.worksheets.length,fixture.categories.length+2);
 const expense=saved.getWorksheet('Ingredients');assert.equal(expense.getCell('F13').value,fixture.entries.at(-1).note);assert.equal(expense.getCell('F13').type,3);
 assert.equal(expense.getCell('G13').value,250.25);assert.ok(expense.getCell('A13').value instanceof Date);
 const cake=saved.getWorksheet('Custom cakes');assert.equal(cake.getCell('D6').value,'Client name');assert.equal(cake.getCell('D7').value,'=A1');assert.equal(cake.getCell('D7').type,3);assert.equal(cake.getCell('E7').value,'GCash');assert.equal(cake.getCell('G8').value.formula,'SUM(G7:G7)');assert.equal(cake.columnCount,7);assert.equal(Object.keys(cake.tables).length,2);
 assert.equal(expense.getCell('E13').value,'Not recorded');
 const summary=saved.getWorksheet('Summary');const total=summary.getRow(12);assert.equal(total.getCell(1).value,'Overall total');
 assert.equal(total.getCell(4).value.result,3124.25);assert.equal(total.getCell(4).value.formula,'SUM(D6:D11)');
 const delivery=saved.getWorksheet('Delivery comparison');assert.equal(delivery.getCell('F6').value.result,-75.5);assert.equal(delivery.getCell('E7').value,'Not recorded');assert.equal(delivery.getCell('F7').value,null);
 for(const sheet of saved.worksheets)assert.equal(sheet.views[0].state,'frozen');
});
test('Delivery exports one category with separate income and expense tables and unchanged totals',async()=>{
 const require=createRequire(import.meta.url),ExcelJS=require(process.env.EXCELJS_TEST_PATH||resolve(import.meta.dirname,'../work/exceljs-4.4.0.min.cjs'));
 const report=structuredClone(fixture),before=accountingTotals(report);
 report.categories=report.categories.filter(c=>c.id!=='cost');report.categories.find(c=>c.id==='fee').name='Delivery';
 report.entries.forEach(e=>{if(e.category_id==='cost')e.category_id='fee';});
 report.summary=report.summary.filter(c=>c.id!=='cost');Object.assign(report.summary.find(c=>c.id==='fee'),{name:'Delivery',expense_cents:22550});
 assert.deepEqual(accountingTotals(report),before);
 const wb=buildAccountingWorkbook(report,ExcelJS),sheet=wb.getWorksheet('Delivery');
 assert.ok(sheet);assert.equal(wb.getWorksheet('Delivery fees'),undefined);assert.equal(wb.getWorksheet('Delivery costs'),undefined);
 assert.equal(sheet.getCell('A5').value,'Sales / income');assert.equal(sheet.getCell('A11').value,'Expenses');assert.equal(sheet.getCell('G7').value,150);assert.equal(sheet.getCell('G13').value,225.5);
 const rows=[];wb.getWorksheet('Summary').eachRow(r=>{if(r.getCell(1).value==='Delivery')rows.push(r);});assert.equal(rows.length,1);assert.equal(rows[0].getCell(4).value.result,-75.5);
 sheet.eachRow(r=>r.eachCell(c=>assert.notEqual(c.value,'Net')));
 const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(await wb.xlsx.writeBuffer());assert.ok(reopened.getWorksheet('Delivery'));
});

test('exported table borders and alignment survive saving, including blank cells and totals',async()=>{
 const require=createRequire(import.meta.url),ExcelJS=require(process.env.EXCELJS_TEST_PATH||resolve(import.meta.dirname,'../work/exceljs-4.4.0.min.cjs'));
 const workbook=buildAccountingWorkbook(fixture,ExcelJS),saved=new ExcelJS.Workbook();
 await saved.xlsx.load(await workbook.xlsx.writeBuffer());
 for(const sheet of saved.worksheets){
  const summary=sheet.name==='Summary',delivery=sheet.name==='Delivery comparison';
  const ranges=summary?[[5,12]]:delivery?[[5,7]]:[[6,8],[12,14]];
  const amounts=summary?[2,3,4]:delivery?[4,5,6]:[7],width=summary?4:7;
  for(const [first,last] of ranges)for(let row=first;row<=last;row++)for(let column=1;column<=width;column++){
   const cell=sheet.getCell(row,column),label=`${sheet.name}!${cell.address}`;
   for(const side of ['top','bottom','left','right'])assert.equal(cell.border[side]?.style,'thin',`${label} has its ${side} border`);
   assert.equal(cell.alignment.vertical,'middle',label);
   assert.equal(cell.alignment.horizontal,cell.value==='No entries in this timeframe'?'center':amounts.includes(column)?'right':'left',label);
   if(!delivery&&row===last)assert.equal(cell.fill.fgColor.argb,'FFF1E6D6',`${label} is part of the complete total band`);
  }
  assert.equal(sheet.getCell('A4').border?.bottom,undefined,'Spacing above tables has no added grid');
 }
 const cake=saved.getWorksheet('Custom cakes');
 assert.equal(cake.getCell('F13').value,'No entries in this timeframe');
 assert.equal(cake.getCell('B13').value,null);
 assert.equal(cake.getCell('G14').value.formula,'SUM(G13:G13)');
 assert.ok(cake.getRow(8).height>=40,'The total label has room to wrap without shrinking the font');
 assert.equal(cake.getCell('A13').isMerged,false,'Empty rows remain valid filterable table rows');
});

test('a shared category exports two independently filterable tables and one summary row',async()=>{
 const require=createRequire(import.meta.url),ExcelJS=require(process.env.EXCELJS_TEST_PATH||resolve(import.meta.dirname,'../work/exceljs-4.4.0.min.cjs'));
 const report=structuredClone(fixture);report.entries.push({id:'mixed',category_id:'cakes',entry_date:'2026-09-24',kind:'expense',amount_cents:12525,note:'Ingredients for cakes',source:'Manual'});
 report.summary.find(c=>c.id==='cakes').expense_cents=12525;
 const wb=buildAccountingWorkbook(report,ExcelJS),sheet=wb.getWorksheet('Custom cakes'),summary=wb.getWorksheet('Summary');
 assert.equal(Object.keys(sheet.tables).length,2);assert.equal(sheet.getCell('A5').value,'Sales / income');assert.equal(sheet.getCell('A11').value,'Expenses');
 assert.equal(sheet.getCell('G7').value,2500);assert.equal(sheet.getCell('G13').value,125.25);
 assert.equal(sheet.getCell('G8').value.result,2500);assert.equal(sheet.getCell('G14').value.result,125.25);
 const rows=[];summary.eachRow(row=>{if(row.getCell(1).value==='Custom cakes')rows.push(row);});assert.equal(rows.length,1);
 assert.equal(rows[0].getCell(2).value.result,2500);assert.equal(rows[0].getCell(3).value.result,125.25);assert.equal(rows[0].getCell(4).value.result,2374.75);
 sheet.eachRow(row=>row.eachCell(cell=>assert.notEqual(cell.value,'Net')));
});

test('serialized Excel tables mark formula totals correctly for mixed and empty categories',async()=>{
 const require=createRequire(import.meta.url),ExcelJS=require(process.env.EXCELJS_TEST_PATH||resolve(import.meta.dirname,'../work/exceljs-4.4.0.min.cjs'));
 const mixed=structuredClone(fixture);
 mixed.entries.push({id:'mixed-xml',category_id:'cakes',entry_date:'2026-09-24',kind:'expense',amount_cents:12525,source:'Manual'},
  {id:'second-sale',category_id:'cakes',entry_date:'2026-09-25',kind:'sale',amount_cents:5000,source:'Manual'});
 Object.assign(mixed.summary.find(c=>c.id==='cakes'),{expense_cents:12525,sales_cents:255000});
 const empty=structuredClone(fixture);empty.entries=[];empty.deliveries=[];
 empty.summary.forEach(c=>{c.sales_cents=0;c.expense_cents=0;});
 for(const report of [mixed,empty]){
  const parts=xlsxParts(await buildAccountingWorkbook(report,ExcelJS).xlsx.writeBuffer());let checked=0;
  for(const [name,rels] of parts){
   if(!/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name))continue;
   const sheet=parts.get(name.replace('/_rels/','/').replace(/\.rels$/,''));
   for(const match of rels.matchAll(/Target="\.\.\/tables\/([^"/]+\.xml)"/g)){
    const table=parts.get('xl/tables/'+match[1]),range=table.match(/\bref="A(\d+):G(\d+)"/);
    assert.ok(range);const first=Number(range[1])+1,total=Number(range[2]);
    assert.ok(total>first,'An empty period still includes a blank data row');
    const column=table.match(/<tableColumn\b[^>]*\bname="Amount"[^>]*(?:\/>|>[\s\S]*?<\/tableColumn>)/)?.[0];
    assert.match(column,/totalsRowFunction="custom"/,'Amount total is declared in the table XML, not only in the cell');
    const cell=sheet.match(new RegExp('<c\\b[^>]*\\br="G'+total+'"[^>]*>([\\s\\S]*?)</c>'))?.[1];
    const actual=cell?.match(/<f[^>]*>(.*?)<\/f>/)?.[1];
    assert.equal(actual,`SUM(G${first}:G${total-1})`,'The worksheet stores the declared custom calculation');
    assert.ok(Number.isFinite(Number(cell.match(/<v>(.*?)<\/v>/)?.[1])),'A numeric cached total is retained, including zero');
    checked++;
   }
  }
  assert.equal(checked,report.summary.length*2,'Every income and expense table is checked');
 }
 const noCategories={...empty,summary:[],categories:[]};
 const workbook=buildAccountingWorkbook(noCategories,ExcelJS);assert.equal(workbook.worksheets.length,2);
 assert.equal(workbook.getWorksheet('Summary').getCell('D6').value.formula,'0');
 assert.equal([...xlsxParts(await workbook.xlsx.writeBuffer()).keys()].filter(n=>/^xl\/tables\/.*\.xml$/.test(n)).length,0);
});
