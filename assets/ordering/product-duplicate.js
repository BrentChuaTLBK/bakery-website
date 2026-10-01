// New product identity and option IDs; existing photos remain shared references.
// Stock, reservations, orders and catalog position belong to the source product.
export function duplicateProductDraft(source,products=[],newId=()=>crypto.randomUUID()){
 if(!source?.id)throw Error('This product is no longer available. Refresh your products.');
 const names=new Set(products.map(p=>String(p.name).toLowerCase()));let name,number=1;
 do{const suffix=number===1?' (copy)':` (copy ${number})`;name=String(source.name||'Product').slice(0,160-suffix.length)+suffix;number++;}while(names.has(name.toLowerCase()));
 const copy={};for(const field of ['description','category_id','category_ids','price_cents','min_quantity','lead_days','pickup_only','allow_same_day','photos','option_groups','label'])if(source[field]!==undefined)copy[field]=structuredClone(source[field]);
 copy.photos??=[];copy.option_groups=(copy.option_groups||[]).map(group=>({...group,id:newId(),choices:(group.choices||[]).map(choice=>({...choice,id:newId()}))}));
 return {...copy,id:newId(),name,active:false,sort_order:0};
}
