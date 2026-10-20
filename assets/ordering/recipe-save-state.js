import {normalizeRecipe,methodGroupId} from './recipe-model.js?v=component-baking-20261020-1';
import {recipeStatus} from './recipe-status.js?v=approved-ux-1';

export function recipeEditingDocument(document){
 const doc=normalizeRecipe(document);
 // Resolve legacy associations once, identically for the baseline and editor.
 for(const variant of doc.variants)for(const method of variant.methods)if(!Object.hasOwn(method,'group_id'))method.group_id=methodGroupId(variant,method);
 return doc;
}

function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.keys(value).sort().filter(key=>{
  if(key!=='cost_snapshot')return true;
  return !value.ingredient_id&&!value.resource_id&&value[key]&&Object.values(value[key]).some(Boolean);
 }).map(key=>[key,canonical(value[key])]));
}

export function recipeSaveKey(document,status,visibility='staff'){
 return JSON.stringify(canonical({document,status:recipeStatus(status),visibility}));
}
