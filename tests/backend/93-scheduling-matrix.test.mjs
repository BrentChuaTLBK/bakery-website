import assert from 'node:assert/strict';
import {addDays,availability,earliestLeadDate,fulfillmentIssue} from '../../assets/ordering/shop-rules.js';

export default async function({db,check,state}) {
  await check('Scheduling matrix agrees between browser and database across cutoffs, closures, leap days and year boundaries',async()=>{
    let comparisons=0;
    for(const at of ['2026-09-18T03:59:59Z','2026-09-18T04:00:00Z','2026-12-31T15:59:59Z','2026-12-31T16:00:00Z','2028-02-28T02:00:00Z']){
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
      for(const week of [[0,1,2,3,4,5,6],[1,2,3,4,5],[2,4]])for(const cutoff of [null,'12:00']){
        const config={production_weekdays:week,fulfillment_weekdays:[0,2,3,4,5,6],cutoff_time:cutoff,nonproduction_dates:[addDays(today,1),addDays(today,2)],blocked_dates:[addDays(today,4)],pickup_blocked_dates:[addDays(today,5)],delivery_blocked_dates:[addDays(today,6)]};
        for(const days of [0,1,2,7]){
          const {rows:[row]}=await db.query('select tlb.earliest_lead_date($1::timestamptz,$2::int,$3::jsonb)::text as earliest',[at,days,JSON.stringify(config)]);
          assert.equal(earliestLeadDate({lead_days:days},config,new Date(at)),row.earliest,`${at}, lead ${days}, ${JSON.stringify(config)}`);comparisons++;
        }
        for(let offset=0;offset<10;offset++)for(const method of ['pickup','delivery']){
          const date=addDays(today,offset),{rows:[row]}=await db.query('select tlb.date_supported($1::date,$2,$3::jsonb) as supported',[date,method,JSON.stringify(config)]);
          assert.equal(!fulfillmentIssue(method,date,config),row.supported,`${method} on ${date}`);comparisons++;
        }
      }
    }
    assert.equal(comparisons,720);
  })();
  await check('Checkout quotes agree with visible availability for 276 pickup/delivery and production/stock combinations',async()=>{
    const h=state.harness,{api,ids}=h;
    const original=(await api('admin_bootstrap',{},ids.owner)).settings;
    const now=new Date(await h.scalar('select clock_timestamp()::text'));
    const today=await h.day(0),dates=Array.from({length:46},(_,i)=>addDays(today,i));
    const settings={...original,paused:false,cutoff_time:null,production_weekdays:[1,2,3,4,5],fulfillment_weekdays:[0,1,2,3,4,5,6],nonproduction_dates:[addDays(today,1),addDays(today,2)],blocked_dates:[addDays(today,6)],pickup_blocked_dates:[addDays(today,7)],delivery_blocked_dates:[addDays(today,8)]};
    await api('save_settings',{settings},ids.owner);
    await api('save_zone',{zone:{name:'Calendar matrix fixture',localities:['Matrix City / Matrix Barangay'],fee_cents:1500,active:true}},ids.owner);
    let comparisons=0;
    try {
      for(const lead_days of [0,1,3]){
        const product=await h.product({lead_days,allow_same_day:false});
        await h.inventory(product,addDays(today,15),0);
        await h.inventory(product,addDays(today,16),10,false);
        const catalog=await api('catalog');
        for(const date of dates)for(const method of ['pickup','delivery']){
          const display=availability(product,date,catalog.settings,catalog.inventory,now,method);
          const payload=h.checkout(product,date,{method,...(method==='delivery'?{address:{locality:'Matrix City / Matrix Barangay',line1:'Local fixture'}}:{})});
          let accepted=true,error;
          try{await api('quote',payload);}catch(e){accepted=false;error=e.message;}
          assert.equal(accepted,display.available,`${method} ${date} lead ${lead_days}: browser=${display.reason}; database=${error||'accepted'}`);comparisons++;
        }
      }
      assert.equal(comparisons,276);
    } finally {await api('save_settings',{settings:original},ids.owner);}
  })();
}
