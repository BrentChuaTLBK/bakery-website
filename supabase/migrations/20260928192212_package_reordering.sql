-- Save the complete package order atomically. Table locks also fence existing
-- save/delete operations, including new packages inserted in another session.
create function tlb.reorder_packages(p_kind text, p_ids jsonb, p_expected jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 table_name text; current_items jsonb; wanted uuid[]; actual_versions jsonb; expected_versions jsonb;
begin
 perform tlb.require(tlb.is_verified(auth.uid()), 'Sign in with a verified owner account.');
 perform tlb.assert_staff(auth.uid(),true);
 perform tlb.require(p_kind in ('party','dessert'), 'Choose a package list.');
 table_name:=case when p_kind='party' then 'party_packages' else 'dessert_bar_packages' end;
 perform tlb.require(jsonb_typeof(p_ids)='array' and jsonb_typeof(p_expected)='array','Provide the complete package order.');
 perform tlb.require(jsonb_array_length(p_ids)<=10000,'Too many packages to rearrange.');
 perform tlb.require(not exists(select 1 from jsonb_array_elements(p_ids) x where jsonb_typeof(x)<>'string'),'Invalid package IDs.');
 select coalesce(array_agg(value::uuid order by ord),array[]::uuid[]) into wanted from jsonb_array_elements_text(p_ids) with ordinality x(value,ord);
 perform tlb.require(cardinality(wanted)=(select count(distinct id) from unnest(wanted) id),'Every package must appear once.');
 execute format('lock table tlb.%I in share row exclusive mode',table_name);
 execute format('select coalesce(jsonb_agg(to_jsonb(p)-''last_save'' order by sort_order,created_at,id),''[]''::jsonb) from tlb.%I p',table_name) into current_items;
 perform tlb.require(cardinality(wanted)=jsonb_array_length(current_items) and not exists(select 1 from jsonb_array_elements(current_items) x where not ((x->>'id')::uuid=any(wanted))),'Packages changed in another window. Refresh before rearranging.');
 -- A committed reorder can be retried after a lost response without touching
 -- newer package content or incrementing revisions again.
 if not exists(select 1 from jsonb_array_elements(current_items) with ordinality x(item,ord) where item->>'id'<>wanted[ord]::text or (item->>'sort_order')::integer<>ord) then
  return jsonb_build_object('items',current_items);
 end if;
 perform tlb.require(not exists(select 1 from jsonb_array_elements(p_expected) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'id') is distinct from 'string' or jsonb_typeof(x->'revision') is distinct from 'number' or (x->>'revision')!~'^[1-9][0-9]*$'),'Provide the previous package revisions.');
 select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','revision',x->'revision') order by x->>'id'),'[]') into actual_versions from jsonb_array_elements(current_items) x;
 select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','revision',x->'revision') order by x->>'id'),'[]') into expected_versions from jsonb_array_elements(p_expected) x;
 perform tlb.require(actual_versions=expected_versions,'Packages changed in another window. Refresh before rearranging.');
 execute format('update tlb.%I p set sort_order=x.ord::integer,revision=p.revision+1,updated_at=now(),last_save=null from unnest($1::uuid[]) with ordinality x(id,ord) where p.id=x.id and p.sort_order is distinct from x.ord::integer',table_name) using wanted;
 execute format('select coalesce(jsonb_agg(to_jsonb(p)-''last_save'' order by sort_order,created_at,id),''[]''::jsonb) from tlb.%I p',table_name) into current_items;
 return jsonb_build_object('items',current_items);
end $$;
revoke all on function tlb.reorder_packages(text,jsonb,jsonb) from public,anon,authenticated;

do $migration$
declare kind text; api_name text; original text; updated text; marker text:='  elsif p_action = ''save'' then';
begin
 foreach kind in array array['party','dessert'] loop
  api_name:=case when kind='party' then 'public.party_packages_api(text,jsonb)' else 'dessert_bar_private.packages_api(text,jsonb)' end;
  original:=pg_get_functiondef(api_name::regprocedure);
  perform tlb.require((length(original)-length(replace(original,marker,'')))=length(marker),'Unexpected package API definition.');
  updated:=replace(original,marker,format(E'  elsif p_action = ''reorder'' then\n    return tlb.reorder_packages(%L,p_payload->''ids'',p_payload->''expected'');\n%s',kind,marker));
  execute updated;
 end loop;
end $migration$;
notify pgrst,'reload schema';
