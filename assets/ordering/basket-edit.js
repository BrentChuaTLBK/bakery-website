// Canonical option keys let edits merge equivalent configurations even when
// the controls were visited in a different order or contain zero-count choices.
export function basketSelectionKey(selections={}) {
 return JSON.stringify(Object.entries(selections).sort(([a],[b])=>a.localeCompare(b)).map(([group,choices])=>[group,Object.entries(choices||{}).filter(([,count])=>Number(count)>0).sort(([a],[b])=>a.localeCompare(b)).map(([id,count])=>[id,Number(count)])]));
}
export function updateBasketLine(items,replacement,index=null) {
 if(index!==null&&(!Number.isInteger(index)||index<0||index>=items.length))throw Error('This basket item changed. Close this window and try again.');
 if(!Number.isInteger(replacement.quantity)||replacement.quantity<1||replacement.quantity>999)throw Error('Choose a whole quantity from 1 to 999.');
 const next=items.map(line=>({...line})),key=basketSelectionKey(replacement.selections);
 const same=next.findIndex((line,i)=>i!==index&&line.product_id===replacement.product_id&&basketSelectionKey(line.selections)===key);
 if(same!==-1){const quantity=next[same].quantity+replacement.quantity;if(quantity>999)throw Error('This configuration can contain at most 999 units.');next[same]={...replacement,quantity};if(index!==null)next.splice(index,1);}
 else if(index===null)next.push(replacement);else next[index]=replacement;
 return next;
}
