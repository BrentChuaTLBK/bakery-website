const prefix='tlb-academy-recent-recipe:';
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
export function recentRecipe(userId,storage){
 try{const value=JSON.parse((storage||globalThis.localStorage).getItem(prefix+userId)||'null');return value&&validId(value.classId)&&validId(value.recipeId)?{classId:value.classId,recipeId:value.recipeId}:null;}catch{return null;}
}
export function rememberRecipe(userId,classId,recipeId,storage){
 if(!userId||!validId(classId)||!validId(recipeId))return;
 try{(storage||globalThis.localStorage).setItem(prefix+userId,JSON.stringify({classId,recipeId}));}catch{/* A shortcut is optional when storage is unavailable. */}
}
export function clearRecentRecipe(userId,storage){try{if(userId)(storage||globalThis.localStorage).removeItem(prefix+userId);}catch{}}
