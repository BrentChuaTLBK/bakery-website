const line=(short=false)=>`<span class="tlb-skeleton-line${short?' tlb-skeleton-short':''}"></span>`;
// Decorative placeholders follow the shop's loading style without fake recipe data.
export function recipeLoadingMarkup({header=false,rows=false}={}){
 const cards=Array.from({length:6},()=>`<div class="tlb-skeleton-card">${line(true)}<div class="recipe-skeleton-name"></div>${line()}${line(true)}<div class="recipe-skeleton-button"></div></div>`).join('');
 const table=`<div class="recipe-skeleton-table">${Array.from({length:7},()=>`<div class="recipe-skeleton-row">${line()}${line(true)}<div class="recipe-skeleton-button"></div></div>`).join('')}</div>`;
 return `<div class="tlb-loading recipe-skeleton" data-recipe-loading><span class="recipe-resource-sr" role="status">Loading your recipe library</span><div aria-hidden="true">${header?`<div class="recipe-skeleton-heading">${line(true)}<div class="recipe-skeleton-name"></div>${line()}</div><div class="recipe-skeleton-tabs">${Array.from({length:6},()=>'<span class="recipe-skeleton-button"></span>').join('')}</div>`:''}<div class="recipe-skeleton-filters">${Array.from({length:rows?2:4},()=>'<span class="recipe-skeleton-field"></span>').join('')}</div>${rows?table:`<div class="recipe-library">${cards}</div>`}</div></div>`;
}
