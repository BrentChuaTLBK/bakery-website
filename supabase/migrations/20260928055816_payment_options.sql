-- Payment accounts stay in owner-managed shop settings; orders retain snapshots.
create function tlb.parse_legacy_payment_options(instructions text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare blocks text[]; lines text[]; block text; result jsonb := '[]';
begin
  if coalesce(instructions,'') !~* '^Accepted Payment Methods:' then return null; end if;
  blocks := regexp_split_to_array(trim(regexp_replace(replace(instructions,E'\r',''),'^Accepted Payment Methods:[[:space:]]*','','i')),E'\n[[:blank:]]*\n+');
  if cardinality(blocks) not between 1 and 20 then return null; end if;
  foreach block in array blocks loop
    lines := string_to_array(trim(block),E'\n');
    -- Only convert unambiguous name/account-name/number triples. Keep all other text.
    if cardinality(lines) <> 3 or length(trim(lines[1])) not between 1 and 60
      or length(trim(lines[2])) not between 1 and 150 or trim(lines[3]) !~ '^[0-9][0-9 -]{3,99}$' then return null; end if;
    result := result || jsonb_build_array(jsonb_build_object('id',md5(block)::uuid,'label',trim(lines[1]),
      'account_name',trim(lines[2]),'account_number',trim(lines[3]),'note','','enabled',true));
  end loop;
  return result;
end;
$$;
create function tlb.valid_payment_options(options jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; ids text[] := '{}';
begin
  if jsonb_typeof(options) is distinct from 'array' then return false; end if;
  if jsonb_array_length(options) > 20 then return false; end if;
  for item in select value from jsonb_array_elements(options) loop
    if jsonb_typeof(item) is distinct from 'object' or item - 'id' - 'label' - 'account_name' - 'account_number' - 'note' - 'enabled' <> '{}'::jsonb
      or coalesce(item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or lower(item->>'id') = any(ids)
      or jsonb_typeof(item->'label') is distinct from 'string' or length(trim(item->>'label')) not between 1 and 60
      or jsonb_typeof(item->'account_name') is distinct from 'string' or length(trim(item->>'account_name')) not between 1 and 150
      or jsonb_typeof(item->'account_number') is distinct from 'string' or length(trim(item->>'account_number')) not between 1 and 100
      or (item->>'account_number') ~ '[[:cntrl:]]'
      or jsonb_typeof(item->'note') is distinct from 'string' or length(item->>'note') > 300
      or jsonb_typeof(item->'enabled') is distinct from 'boolean' then return false; end if;
    ids := array_append(ids,lower(item->>'id'));
  end loop;
  return true;
end;
$$;
create function tlb.active_payment_options(options jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select case when jsonb_typeof(options)='array' then
    (select coalesce(jsonb_agg(item order by position),'[]') from jsonb_array_elements(options) with ordinality p(item,position) where item->'enabled'='true'::jsonb)
    else null end;
$$;
create function tlb.payment_options_text(options jsonb,note text) returns text
language sql immutable set search_path='' as $$
  select concat_ws(E'\n\n',case when jsonb_array_length(tlb.active_payment_options(options)) > 0 then 'Accepted Payment Methods:' end,
    (select string_agg(concat_ws(E'\n',item->>'label',item->>'account_name',item->>'account_number',nullif(item->>'note','')),E'\n\n' order by position)
      from jsonb_array_elements(tlb.active_payment_options(options)) with ordinality p(item,position)),nullif(trim(note),''));
$$;
revoke all on function tlb.parse_legacy_payment_options(text),tlb.valid_payment_options(jsonb),tlb.active_payment_options(jsonb),tlb.payment_options_text(jsonb,text) from public,anon,authenticated;

-- Derive existing accounts from their saved instructions; no banking data in source.
update tlb.settings set data=data || jsonb_build_object('payment_options',tlb.parse_legacy_payment_options(data->>'payment_instructions'),'payment_note','','payment_options_revision',1)
where id and not data ? 'payment_options' and tlb.parse_legacy_payment_options(data->>'payment_instructions') is not null;

do $$
declare def text:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure); old text; replacement text;
begin
  old := $old$row_data:=s||coalesce(p_payload->'settings','{}');$old$;
  replacement := $new$
   select data into s from tlb.settings where id for update;
   row_data:=s||coalesce(p_payload->'settings','{}');
   if row_data ? 'payment_options' then
    perform tlb.require(tlb.valid_payment_options(row_data->'payment_options'),'Use up to 20 payment options, each with a name, account name, account number and visibility setting.');
    perform tlb.require(jsonb_typeof(row_data->'payment_note')='string' and length(row_data->>'payment_note')<=1000,'Payment notes must be at most 1000 characters.');
    if s->'payment_options' is distinct from row_data->'payment_options' or s->'payment_note' is distinct from row_data->'payment_note' then
     perform tlb.require(coalesce((p_payload->'settings'->>'payment_options_revision')::integer,0)=coalesce((s->>'payment_options_revision')::integer,0),
       'Payment options changed in another window. Reload Shop settings before changing payment details.');
     row_data:=row_data||jsonb_build_object('payment_options_revision',coalesce((s->>'payment_options_revision')::integer,0)+1);
    else
     row_data:=row_data||jsonb_build_object('payment_options_revision',coalesce((s->>'payment_options_revision')::integer,0));
    end if;
    perform tlb.require(coalesce((row_data->>'paused')::boolean,true) or jsonb_array_length(tlb.active_payment_options(row_data->'payment_options'))>0,
      'Keep at least one payment option visible while orders are open.');
    -- Keep the established email renderer and older order pages in sync.
    row_data:=row_data||jsonb_build_object('payment_instructions',tlb.payment_options_text(row_data->'payment_options',row_data->>'payment_note'));
   end if;
  $new$;
  if position(old in def)=0 then raise exception 'Shop settings patch target missing'; end if;
  def:=replace(def,old,replacement);
  old := $old$'payment_instructions',s->>'payment_instructions',$old$;
  replacement := $new$'payment_instructions',s->>'payment_instructions','payment_options',tlb.active_payment_options(s->'payment_options'),'payment_note',s->>'payment_note',$new$;
  if position(old in def)=0 then raise exception 'Order payment snapshot patch target missing'; end if;
  execute replace(def,old,replacement);
end;
$$;
notify pgrst,'reload schema';
