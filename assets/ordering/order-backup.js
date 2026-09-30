// Shared by the download UI and the scheduled Google Sheets worker.
export function validateBackup(snapshot) {
  if (snapshot?.format !== 'tlb-order-backup' || snapshot.version !== 1 || !Array.isArray(snapshot.orders)) throw Error('Invalid order backup.');
  if (!['paid_active','unserved'].includes(snapshot.scope) || !Number.isFinite(Date.parse(snapshot.generated_at))) throw Error('Invalid backup metadata.');
  const seen = new Set();
  for (const order of snapshot.orders) {
    if (!order?.id || seen.has(order.id) || !order.reference || !Array.isArray(order.data?.items) || !/^\d{4}-\d{2}-\d{2}$/.test(order.fulfillment_date) || !Number.isFinite(Date.parse(order.fulfillment_date+'T00:00:00Z'))) throw Error('Incomplete or duplicate order in backup.');
    seen.add(order.id);
  }
  return snapshot;
}
const text = value => typeof value === 'string' ? value : value == null ? '' : String(value);
const label = value => text(value).replaceAll('_',' ');
const amount = cents => Number.isSafeInteger(cents) ? cents / 100 : '';
function splitText(value,size=24000) {
  const chunks=[];
  for(let start=0;start<value.length;) {
    let end=Math.min(start+size,value.length);
    if(end<value.length && /[\uD800-\uDBFF]/.test(value[end-1]))end--;
    chunks.push(value.slice(start,end));start=end;
  }
  return chunks.length?chunks:[''];
}
const readable=value=>typeof value==='string'&&value.length>30000?splitText(value,30000)[0]+'\n[Full text in Recovery]':value;
const selections = item => (item.selection_labels?.length ? item.selection_labels : item.flavor_contents || []).map(s => typeof s === 'string' ? s : `${s.quantity ? s.quantity + ' × ' : ''}${s.label || s.name || ''}`).join(', ');
export function proofPaths(order) {
 return [...new Set([order.proof_path,...(order.payments||[]).map(p=>p.proof_path),...(order.delivery_payments||[]).map(p=>p.proof_path)].filter(p=>typeof p==='string'&&p.trim()))];
}
export function backupSheets(snapshot) {
  validateBackup(snapshot);
  const orders = [], items = [], recovery = [];
  for (const o of snapshot.orders) {
    const d = o.data, b = d.buyer || {}, r = d.recipient || {}, a = d.address || {};
    orders.push([Math.round(Date.parse(o.fulfillment_date+'T00:00:00Z')/86400000)+25569,o.reference,label(o.fulfillment_status),label(o.method),b.name || '',b.phone || '',b.email || '',
      [b.social_platform,b.social_username].filter(Boolean).join(': '),r.name || '',r.phone || '',
      [a.line1,a.line2,a.locality,a.postal_code].filter(Boolean).join(', '),d.instructions || '',
      d.items.map(i => `${i.quantity} × ${i.name}${selections(i) ? ' (' + selections(i) + ')' : ''}`).join('\n'),
      amount(d.total_cents),amount(o.paid_amount_cents),label(o.payment_status),d.payment_method_label || d.payment_method || '',
      amount(d.delivery_cents),d.deferred_delivery ? label(d.delivery_payment_status || 'fee pending') : '',label(o.source),
      (snapshot.proof_files||[]).filter(p=>p.order_id===o.id).map(p=>p.archive_path).join('\n') || (proofPaths(o).length?`${proofPaths(o).length} attached · use Download with proofs`:'No proof attached'),
      snapshot.archive_file_id?`https://drive.google.com/file/d/${snapshot.archive_file_id}/view`:'']);
    d.items.forEach((i,index) => items.push([o.reference,index+1,i.name || '',i.quantity,amount(i.unit_price_cents),
      amount(i.line_total_cents ?? i.quantity*i.unit_price_cents),selections(i),i.description || '']));
    // Excel cells allow 32,767 characters. Lossless chunks also fit Sheets limits.
    const json = JSON.stringify(o), chunks = splitText(json);
    chunks.forEach((chunk,index) => recovery.push([o.id,o.reference,index+1,chunks.length,chunk]));
  }
  const stamp = `Saved ${new Date(snapshot.generated_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'})} · Asia/Manila · PHP`;
  return [
    {name:'Orders',title:'TLB · Orders awaiting fulfillment',note:`${snapshot.orders.length} ${snapshot.orders.length===1?'order':'orders'} · ${snapshot.scope==='paid_active' ? 'Paid or payment under review' : 'All unserved, including unpaid'} · Completed orders are excluded.`,stamp,
      headers:['Fulfillment date','Order reference','Status','Pickup / delivery','Client','Phone','Email','Social media','Recipient','Recipient phone','Delivery address','Instructions','Items and flavors','Total · PHP','Paid · PHP','Payment status','Payment method','Delivery fee · PHP','Delivery payment','Source','Payment proof files','Order and proof ZIP'],
      widths:[18,23,23,18,25,20,32,30,25,20,45,45,55,19,19,23,22,22,23,22,55,55],money:[13,14,17],dates:[0],rows:orders.map(row=>row.map(readable))},
    {name:'Items',title:'TLB · Order items',note:'One row per order item. Flavor selections belong to each unit of that item.',stamp,
      headers:['Order reference','Line','Product','Quantity','Unit price · PHP','Line total · PHP','Flavors / options','Details'],widths:[23,9,36,13,21,21,50,50],money:[4,5],dates:[],rows:items.map(row=>row.map(readable))},
    {name:'Recovery',title:'TLB · Recovery data',note:'Join JSON chunks per order ID in part order. Includes order, payment, history and reservations. Actual proof images are in the companion ZIP, grouped by order reference. Access tokens are excluded.',stamp,
      headers:['Order ID','Order reference','Part','Parts','Order JSON'],widths:[40,23,10,10,100],money:[],dates:[],rows:recovery}
  ];
}

export function recoverBackupRows(rows, generatedAt) {
  const groups = new Map();
  for (const [id,reference,part,parts,json] of rows) {
    if (!id) continue;
    if (!Number.isInteger(part) || !Number.isInteger(parts) || parts < 1 || part < 1 || part > parts || typeof json !== 'string') throw Error('Invalid recovery chunk.');
    let group = groups.get(id);
    if (!group) groups.set(id,group={reference,parts,chunks:new Map()});
    if (group.parts!==parts || group.reference!==reference || group.chunks.has(part)) throw Error('Conflicting recovery chunks.');
    group.chunks.set(part,json);
  }
  return validateBackup({format:'tlb-order-backup',version:1,scope:'paid_active',generated_at:generatedAt,orders:[...groups].map(([id,g])=>{
    if (g.chunks.size!==g.parts) throw Error('Missing recovery chunks.');
    const order=JSON.parse(Array.from({length:g.parts},(_,i)=>g.chunks.get(i+1)).join(''));
    if (order.id!==id || order.reference!==g.reference) throw Error('Recovery order identity mismatch.');
    return order;
  })});
}

export function buildBackupWorkbook(snapshot, ExcelJS) {
  const wb = new ExcelJS.Workbook();wb.creator='TLB Kitchen';wb.created=new Date(snapshot.generated_at);
  for (const definition of backupSheets(snapshot)) {
    const s=wb.addWorksheet(definition.name);s.columns=definition.widths.map(width=>({width}));
    s.views=[{state:'frozen',ySplit:5,showGridLines:false}];
    for (const [row,value] of [[1,definition.title],[2,definition.stamp],[3,definition.note]]) {
      s.mergeCells(row,1,row,definition.headers.length);s.getCell(row,1).value=value;
      s.getCell(row,1).alignment={wrapText:true,vertical:'middle'};s.getRow(row).height=row===3?42:30;
    }
    s.getCell('A1').font={name:'Calibri',bold:true,size:18,color:{argb:'FF764B25'}};
    s.getRow(5).values=definition.headers;
    for (const values of definition.rows) s.addRow(values);
    if (!definition.rows.length) s.addRow(['No orders in this backup.']);
    for (let r=5;r<=s.rowCount;r++) {
      const row=s.getRow(r);let lines=1;
      for(let c=1;c<=definition.headers.length;c++) {
        const cell=row.getCell(c),edge={style:'thin',color:{argb:'FFD9C9B8'}};
        cell.border={top:edge,bottom:edge,left:edge,right:edge};
        cell.alignment={vertical:'top',horizontal:definition.money.includes(c-1)?'right':'left',wrapText:true};
        cell.font={name:'Calibri',size:11,bold:r===5,color:{argb:r===5?'FFFFFFFF':'FF2F2624'}};
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:r===5?'FF764B25':r%2?'FFFBF7EF':'FFFFFFFF'}};
        if(r>5&&definition.money.includes(c-1))cell.numFmt='"₱"#,##0.00';
        if(r>5&&definition.dates.includes(c-1))cell.numFmt='mmm d, yyyy';
        if(typeof cell.value==='string')lines=Math.max(lines,cell.value.split('\n').reduce((n,l)=>n+Math.max(1,Math.ceil(l.length/(definition.widths[c-1]-2))),0));
      }
      row.height=Math.min(180,Math.max(32,lines*15+12));
    }
    s.autoFilter={from:{row:5,column:1},to:{row:Math.max(6,s.rowCount),column:definition.headers.length}};
  }
  return wb;
}
