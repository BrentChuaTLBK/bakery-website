// Teaching fields shared by the independent editor, preview and student reader.
export const bakingFields=[['Setting name','name'],['Top heat','top'],['Bottom heat','bottom'],['Fan','fan'],['Minutes','minutes'],['Core temperature','core']];
export const extraBakingFields=[['Actual bottom heat','actual_bottom'],['Temperature','temperature'],['Ingredient temperature','ingredient_temperature'],['Batter temperature','batter_temperature'],['Resting temperature','resting_temperature'],['Cooling time (minutes)','cooling_minutes'],['Freezing time (minutes)','freezing_minutes'],['Stage notes','notes']];
export const bakingLabels=Object.fromEntries([...bakingFields,...extraBakingFields].filter(([,key])=>key!=='name').map(([label,key])=>[key,label]));
export const recipeGroupName=(variant,id)=>id?(variant.groups||[]).find(group=>group.id===id)?.name||'':'';
