import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';

export function unwrapRecipeResult(result){
 if(result?.error){const error=Error(result.message);error.code=result.code;error.reason=result.reason;error.access=result.access;throw error;}
 return result;
}
export async function staffFixture(db,{h:existing,dispatch,serialize=fn=>fn()}={}){
 const h=existing||await makeHarness(db),{owner,staff:angie,customer:edna,stranger:third}=h.ids;
 // This clock exists only in a fresh test database. The migration's private
 // clock always uses clock_timestamp(), never a request or session setting.
 await db.exec("create table if not exists public.recipe_test_clock(at_time timestamptz not null); delete from public.recipe_test_clock; insert into public.recipe_test_clock values('2026-10-01 06:00:00+00'); create or replace function tlb.recipe_staff_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select at_time from public.recipe_test_clock$$");
 const clock=local=>serialize(()=>db.query("update public.recipe_test_clock set at_time=$1::timestamp at time zone 'Asia/Manila'",[local.replace('T',' ')]));
 const raw=(action,payload={},user=owner)=>dispatch?dispatch(action,payload,user):h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 const api=async(action,payload={},user=owner)=>unwrapRecipeResult(await raw(action,payload,user));
 const people=[angie,edna,third];
 for(let i=0;i<3;i++)await api('save_access',{user_id:people[i],permission:'kitchen'});
 for(let i=3;i<5;i++){
  const id=randomUUID();await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`kitchen-${id}@example.test`]);people.push(id);await api('save_access',{user_id:id,permission:'kitchen'});
 }
 const categories=(await api('bootstrap')).categories,cheesecake=categories.find(c=>c.name==='Cheesecakes'),cakes=categories.find(c=>c.name==='Cakes');
 function document(name,category=cheesecake.id){
  const d=blankRecipe();d.name=name;d.category_id=category;d.description='Approved kitchen reference';d.private_notes='CONFIDENTIAL_ADMIN_NOTE';
  d.variants[0].yield={...d.variants[0].yield,quantity:'1',unit:'cake',portions:'8'};
  d.variants[0].groups[0].ingredients=[{id:'cream',name:'Cream cheese',quantity:'200',unit:'g',brand:'Philadelphia',notes:'Room temperature',cost_snapshot:{amount:'500',quantity:'1000',unit:'g'},supplier_name:'CONFIDENTIAL_SUPPLIER'}];
  d.variants[0].methods[0].steps[0].instruction='Mix the cream cheese gently.';d.variants[0].production_notes='Cool before packing.';return d;
 }
 const vanilla=await api('create',{document:document('Vanilla Basque'),status:'final'});
 const matcha=await api('create',{document:document('Matcha Basque'),status:'final'});
 const chocolate=await api('create',{document:document('Chocolate Basque',cakes.id),status:'final'});
 const research=await api('create',{document:document('R&D Basque'),status:'testing'});
 const draft=await api('create',{document:document('CONFIDENTIAL_DRAFT'),status:'draft'});
 const archived=await api('create',{document:document('CONFIDENTIAL_ARCHIVE'),status:'archived'});
 const policy=async(user=angie)=>(await api('bootstrap',{},user)).access;
 const overview=(from='2026-10-01',to='2026-10-31')=>api('staff_overview',{from,to});
 async function save(user,changes={}){
  const person=(await overview()).staff.find(s=>s.user_id===user);
  return api('staff_save',{...person,...changes});
 }
 await save(angie,{display_name:'Angie',scope_mode:'recipes',scope_ids:[vanilla.id,matcha.id]});
 await save(edna,{display_name:'Edna'});await save(third,{display_name:'Staff C'});
 await save(people[3],{display_name:'Staff D'});await save(people[4],{display_name:'Staff E'});
 const calendar=(users,dates,action='block',request_id=randomUUID())=>api('staff_calendar',{users,dates,action,request_id});
 const override=(users,kind,starts_local,ends_local)=>api('staff_override',{users,kind,starts_local,ends_local});
 return {h,db,api,raw,clock,people,owner,angie,edna,third,categories,cheesecake,cakes,document,vanilla,matcha,chocolate,research,draft,archived,policy,overview,save,calendar,override};
}
