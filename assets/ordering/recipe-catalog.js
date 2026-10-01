// Supplier selectors must include records beyond the first catalog page.
export async function allRecipeSuppliers(api){
 const rows=[];let offset=0;
 while(true){const page=await api('resources',{kind:'supplier',limit:100,offset,paginate:true,include_inactive:true});rows.push(...page.rows);offset+=page.rows.length;if(!page.rows.length||!Number.isInteger(page.total)||offset>=page.total)return rows;}
}
