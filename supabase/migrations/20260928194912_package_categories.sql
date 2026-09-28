-- Categories are independent for each service. Only the existing verified-owner
-- APIs may write them; package membership is enforced by foreign keys.
create table tlb.party_package_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  sort_order integer not null check (sort_order between 1 and 30)
);
create table tlb.dessert_bar_package_categories (like tlb.party_package_categories including all);
alter table tlb.party_package_categories enable row level security;
alter table tlb.dessert_bar_package_categories enable row level security;
revoke all on tlb.party_package_categories, tlb.dessert_bar_package_categories from public,anon,authenticated;
create policy deny_direct_client_access on tlb.party_package_categories for all to anon,authenticated using(false) with check(false);
create policy deny_direct_client_access on tlb.dessert_bar_package_categories for all to anon,authenticated using(false) with check(false);
alter table tlb.party_packages add column category_id uuid references tlb.party_package_categories(id);
alter table tlb.dessert_bar_packages add column category_id uuid references tlb.dessert_bar_package_categories(id);
create index party_packages_category_idx on tlb.party_packages(category_id);
create index dessert_bar_packages_category_idx on tlb.dessert_bar_packages(category_id);

insert into tlb.party_package_categories(name,sort_order) values ('50 pax',1),('100 pax',2),('150 pax',3);
-- Use the stated capacity, never prices or serving counts in the inclusions.
update tlb.party_packages p set category_id=c.id,revision=p.revision+1,last_save=null,updated_at=now()
from tlb.party_package_categories c
where substring(p.subtitle || ' ' || p.name from '(?i)\m(50|100|150)\s*pax\M') || ' pax'=c.name;

create function tlb.save_package_categories(p_kind text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  package_table text; category_table text; current_categories jsonb; wanted jsonb:=p_payload->'categories'; result_items jsonb;
begin
  perform tlb.require(tlb.is_verified(auth.uid()),'Sign in with a verified owner account.');
  perform tlb.assert_staff(auth.uid(),true);
  perform tlb.require(p_kind in ('party','dessert'),'Choose a package list.');
  package_table:=case when p_kind='party' then 'party_packages' else 'dessert_bar_packages' end;
  category_table:=case when p_kind='party' then 'party_package_categories' else 'dessert_bar_package_categories' end;
  perform tlb.require(jsonb_typeof(wanted)='array','Enter your categories.');
  perform tlb.require(jsonb_array_length(wanted)<=30,'Use up to 30 categories.');
  perform tlb.require(not exists(select 1 from jsonb_array_elements(wanted) x where
    jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'id') is distinct from 'string'
    or jsonb_typeof(x->'name') is distinct from 'string' or length(btrim(x->>'name')) not between 1 and 80),
    'Each category needs a name of 1 to 80 characters.');
  perform tlb.require((select count(distinct (x->>'id')::uuid)=count(*) and count(distinct lower(btrim(x->>'name')))=count(*) from jsonb_array_elements(wanted) x),
    'Use a different name and ID for each category.');
  select coalesce(jsonb_agg(jsonb_build_object('id',(x->>'id')::uuid,'name',btrim(x->>'name')) order by ord),'[]') into wanted
    from jsonb_array_elements(wanted) with ordinality a(x,ord);
  -- Serialize against package creates/edits/deletes/reordering before locking
  -- categories. This keeps removal and reassignment in one transaction.
  execute format('lock table tlb.%I in share row exclusive mode',package_table);
  execute format('lock table tlb.%I in share row exclusive mode',category_table);
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''id'',id,''name'',name) order by sort_order,id),''[]'') from tlb.%I',category_table) into current_categories;
  if wanted is distinct from current_categories then
    perform tlb.require(p_payload->'expected'=current_categories,'Categories changed in another window. Close the editor and refresh before saving.');
    execute format('update tlb.%I set category_id=null,revision=revision+1,last_save=null,updated_at=now() where category_id is not null and category_id not in (select (x->>''id'')::uuid from jsonb_array_elements($1) x)',package_table) using wanted;
    execute format('delete from tlb.%I where id not in (select (x->>''id'')::uuid from jsonb_array_elements($1) x)',category_table) using wanted;
    execute format('insert into tlb.%I(id,name,sort_order) select (x->>''id'')::uuid,x->>''name'',ord::integer from jsonb_array_elements($1) with ordinality a(x,ord) on conflict(id) do update set name=excluded.name,sort_order=excluded.sort_order',category_table) using wanted;
  end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(p)-''last_save'' order by sort_order,created_at,id),''[]'') from tlb.%I p',package_table) into result_items;
  return jsonb_build_object('categories',wanted,'items',result_items);
end $$;
revoke all on function tlb.save_package_categories(text,jsonb) from public,anon,authenticated;

-- Extend both existing handlers without replacing their revision, validation,
-- deletion, shared-inclusion or reorder behavior. Missing category_id in an
-- older browser preserves existing membership on edit.
do $migration$
declare kind text; api_name text; original text; updated text; category_table text; marker text;
begin
  foreach kind in array array['party','dessert'] loop
    api_name:=case when kind='party' then 'public.party_packages_api(text,jsonb)' else 'dessert_bar_private.packages_api(text,jsonb)' end;
    category_table:=case when kind='party' then 'party_package_categories' else 'dessert_bar_package_categories' end;
    original:=pg_get_functiondef(api_name::regprocedure); updated:=original;
    marker:='''badge'',p.badge,''features'',p.features)';
    perform tlb.require(strpos(updated,marker)>0,'Unexpected package projection.');
    updated:=replace(updated,marker,'''badge'',p.badge,''features'',p.features,''category_id'',p.category_id)');
    marker:='return jsonb_build_object(''items'',items,''settings'',case';
    perform tlb.require(strpos(updated,marker)>0,'Unexpected package list.');
    updated:=replace(updated,marker,format('return jsonb_build_object(''categories'',(select coalesce(jsonb_agg(jsonb_build_object(''id'',c.id,''name'',c.name) order by c.sort_order,c.id),''[]'') from tlb.%I c where p_action=''admin_list'' or exists(select 1 from jsonb_array_elements(items) x where x->>''category_id''=c.id::text)),''items'',items,''settings'',case',category_table));
    marker:='  elsif p_action = ''save'' then';
    perform tlb.require(strpos(updated,marker)>0,'Unexpected package save.');
    updated:=replace(updated,marker,format(E'  elsif p_action = ''save_categories'' then\n    return tlb.save_package_categories(%L,p_payload);\n%s\n    perform tlb.require(entry->>''category_id'' is null or exists(select 1 from tlb.%I where id=(entry->>''category_id'')::uuid),''Category no longer exists. Close the editor and refresh.'');',kind,marker,category_table));
    marker:='published,sort_order,last_save)';
    perform tlb.require(strpos(updated,marker)>0,'Unexpected package insert.');
    updated:=replace(updated,marker,'published,sort_order,last_save,category_id)');
    updated:=replace(updated,'(entry->>''sort_order'')::integer,operation)','(entry->>''sort_order'')::integer,operation,(entry->>''category_id'')::uuid)');
    marker:='revision=revision+1,last_save=operation,updated_at=now()';
    perform tlb.require(strpos(updated,marker)>0,'Unexpected package update.');
    updated:=replace(updated,marker,'category_id=case when entry ? ''category_id'' then (entry->>''category_id'')::uuid else package.category_id end,' || marker);
    execute updated;
  end loop;
end $migration$;
notify pgrst,'reload schema';
