// Keep historical version codes readable without rewriting saved recipes.
export const recipeStatuses=[['draft','Draft'],['testing','R&D'],['production','Final'],['hidden','Hidden'],['archived','Archive']];
export function recipeStatus(status){return status==='testing'?'testing':status==='production'||status==='final'?'production':status==='hidden'?'hidden':status==='archived'||status==='archive'?'archived':'draft';}
export function recipeStatusLabel(status){return recipeStatuses.find(([value])=>value===recipeStatus(status))[1];}
