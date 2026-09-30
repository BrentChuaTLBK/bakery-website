import test from 'node:test';
import assert from 'node:assert/strict';
import {blankRecipe,addComponent,method,recipeSections,freshVariant,removeComponent,scaledCopy,validateRecipe} from '../assets/ordering/recipe-model.js';
import {parseRecipeText,rebuildImportedSections} from '../assets/ordering/recipe-import.js';
import {printBook} from '../assets/ordering/recipe-print.js';
// Synthetic formula: never publish an owner's private recipe as a fixture.
const source=`Sample Layer Cake
Updated: 2026-10-01
Details Packaging Details
Yield: 1 cake Box: Sample box
Board: Sample board
Coconut Sponge
Flour 100 g
Sugar 25 g
Procedure
• Whisk the dry ingredients.
• Fold in coconut 20 g
  and mix gently.
Cream Mousse
Cream 200 g
Sugar 10 g
Procedure
• Whip the cream.
• Fold together.
Glaze
Water 50 ml
Gelatin ¼ tsp
Procedure
• Bloom the gelatin.
Assembly
• Layer the sponge and mousse.
• Finish with glaze.`;
test('repeating ingredient/procedure blocks remain paired and assembly stays separate',()=>{
 const {document:d,recognized}=parseRecipeText(source),v=d.variants[0],sections=recipeSections(v);
 assert.equal(recognized,6);assert.deepEqual(v.groups.map(g=>g.name),['Coconut Sponge','Cream Mousse','Glaze']);
 assert.deepEqual(sections.components.map(c=>c.methods.length),[1,1,1]);assert.equal(sections.standalone[0].method.name,'Assembly');
 assert.equal(v.methods[0].steps[1].instruction,'Fold in coconut 20 g and mix gently.');assert.equal(v.groups[2].ingredients[1].quantity,'¼');
 assert.equal(v.packaging.box,'Sample box');assert.equal(v.packaging.board,'Sample board');assert.equal(d.import_review.source_text,source);assert.equal(d.import_review.reviewed,false);
});
test('Word-style split cells, table headings and explicit ingredients labels switch back from procedure',()=>{
 const text='Sample\nFirst part:\nIngredients\nIngredient Amount Unit\nFlour\n100 g\nSugar\n25 g\nMethod\n1. Mix together.\nSecond part:\nIngredients\nIngredient Quantity\nCream\n1½ cups\nMethod\n1. Whip gently.\nAssembly\n1. Layer together.';
 const {document:d,recognized}=parseRecipeText(text),sections=recipeSections(d.variants[0]);assert.equal(recognized,3);assert.equal(sections.components.length,2);assert.equal(sections.components[1].methods[0].method.steps[0].instruction,'Whip gently.');assert.equal(sections.standalone.length,1);
});
test('procedure lines that mention quantities are not silently reclassified as ingredients',()=>{
 const {document:d,recognized}=parseRecipeText('Sample\nSugar 100 g\nProcedure\n1. Add water 50 ml\n2. Fold in flour 20 g\nCool.');assert.equal(recognized,1);assert.equal(d.variants[0].methods[0].steps.length,2);assert.match(d.variants[0].methods[0].steps[1].instruction,/Cool/);
});
test('unrecognized component quantities leave instructions available for review without broken links',()=>{
 const {document:d,recognized}=parseRecipeText('Sample\nIngredients: Filling\nCream as needed\nProcedure\n1. Whip the cream.');assert.equal(recognized,0);assert.equal(d.variants[0].methods.at(-1).group_id,'');assert.equal(validateRecipe(d).length,0);assert.match(d.import_review.source_text,/Cream as needed/);
});
test('component rename, reorder and duplication preserve procedure associations',()=>{
 const d=parseRecipeText(source).document,v=d.variants[0],before=structuredClone(v);v.groups.reverse();v.groups[0].name='Renamed glaze';
 assert.equal(recipeSections(v).components[0].methods[0].method.steps[0].instruction,'Bloom the gelatin.');
 const copy=freshVariant(v);assert.notEqual(copy.groups[0].id,v.groups[0].id);assert.equal(copy.methods[2].group_id,copy.groups[0].id);assert.equal(copy.methods[3].group_id,'');assert.equal(recipeSections(copy).standalone.length,1);assert.deepEqual(before.methods,v.methods);
});
test('scaled copies retain component links and original fractions without overwriting the source',()=>{
 const d=parseRecipeText(source).document,before=structuredClone(d),scaled=scaledCopy(d,d.variants[0].id,'2'),v=scaled.variants[0];
 assert.equal(v.groups[0].ingredients[0].quantity,'200');assert.equal(v.groups[2].ingredients[1].quantity,'0.5');assert.equal(recipeSections(v).components[2].methods.length,1);assert.deepEqual(d,before);
});
test('removing one component only removes its own ingredients and procedures',()=>{
 const v=parseRecipeText(source).document.variants[0];removeComponent(v,1);assert.deepEqual(v.groups.map(g=>g.name),['Coconut Sponge','Glaze']);assert.equal(v.methods.length,3);assert.equal(recipeSections(v).standalone[0].method.name,'Assembly');
});
test('legacy matching is conservative and never moves explicit overall assembly',()=>{
 const v={groups:[{id:'a',name:'Sponge',ingredients:[]},{id:'b',name:'Mousse',ingredients:[]}],methods:[{name:'Sponge method',steps:[]},{name:'Procedure',steps:[]},{name:'Assembly',steps:[]},{name:'Sponge',group_id:'',steps:[]}]},before=structuredClone(v);
 assert.equal(recipeSections(v).components[0].methods.length,1);assert.equal(recipeSections(v).standalone.length,3);assert.deepEqual(v,before);
});
test('broken or ambiguous component links are rejected by draft validation',()=>{
 const d=parseRecipeText(source).document;d.variants[0].methods[0].group_id='missing';assert.match(validateRecipe(d).join(' '),/existing component/);
 d.variants[0].groups[1].id=d.variants[0].groups[0].id;assert.match(validateRecipe(d).join(' '),/identifiers must be unique/);
});
test('new components include a ready-to-edit linked procedure',()=>{
 const v=blankRecipe().variants[0];const g=addComponent(v,'Filling');assert.equal(g.name,'Filling');assert.equal(v.methods[1].group_id,g.id);assert.equal(v.methods[1].steps.length,1);const assembly=method();assembly.name='Assembly';v.methods.push(assembly);assert.equal(recipeSections(v).standalone.length,1);
});
test('rebuilding an older import changes only formula sections in a separate working draft',()=>{
 const d=parseRecipeText(source).document;d.name='Owner renamed cake';d.variants[0].groups.splice(1);d.variants[0].methods=[{name:'Old combined procedure',steps:[{instruction:'old import'}]}];d.variants[0].yield.quantity='3';d.variants[0].photos=[{file_id:'keep-photo'}];d.variants[0].additional_costs=[{name:'Packaging',amount:'20'}];d.private_notes='Keep owner notes';const before=structuredClone(d);
 const fixed=rebuildImportedSections(d).document;assert.equal(fixed.variants[0].groups.length,3);assert.equal(fixed.name,d.name);assert.equal(fixed.variants[0].yield.quantity,'3');assert.deepEqual(fixed.variants[0].photos,d.variants[0].photos);assert.deepEqual(fixed.variants[0].additional_costs,d.variants[0].additional_costs);assert.equal(fixed.private_notes,d.private_notes);assert.deepEqual(d,before);
 assert.throws(()=>rebuildImportedSections(blankRecipe()),/original imported text/);
});
test('print layouts keep each ingredient table immediately followed by its procedure',()=>{
 const document=parseRecipeText(source).document,record={id:'qa',code:'QA',version:1,status:'draft',updated_at:'2026-10-01',document};
 for(const layout of ['kitchen','presentation']){
  const html=printBook([record],{layout,packaging:true,process:true});
  assert(html.indexOf('Whisk the dry ingredients.')>html.indexOf('data-print-component="Coconut Sponge"'));
  assert(html.indexOf('Whisk the dry ingredients.')<html.indexOf('data-print-component="Cream Mousse"'));
  assert(html.indexOf('Whip the cream.')<html.indexOf('data-print-component="Glaze"'));
  assert(html.indexOf('Bloom the gelatin.')<html.indexOf('Layer the sponge and mousse.'));assert.match(html,/Sample board/);
 }
});
