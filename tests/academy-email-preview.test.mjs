import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAcademyEmail as workerRender} from '../supabase/functions/_shared/academy-email.ts';
import {academyEmailPreview} from '../assets/ordering/academy-email-composer.js';
test('Preview and sending worker use identical Academy email output',()=>{
 for(const kind of ['marketing','operational']){
  const payload={kind,subject:'Baking camp <2026>',body:'First line\nSecond line & another tip.'},address='Fixture business address';
  assert.deepEqual(academyEmailPreview(payload,address),workerRender({title:payload.subject,preview:payload.body,url:'https://thelittlebakerkitchen.com/academy/dashboard',marketing:kind==='marketing',unsubscribe_token:'0'.repeat(64),address}));
 }
});
test('Preview escapes HTML, includes accessible structure and keeps marketing unsubscribe distinct',()=>{
 const marketing=academyEmailPreview({kind:'marketing',subject:'<img src=x>',body:'<script>alert(1)</script>'},'Fixture address');
 assert.ok(!marketing.html.includes('<script>'));assert.ok(marketing.html.includes('&lt;script&gt;'));assert.match(marketing.html,/<html lang="en" dir="ltr">/);assert.match(marketing.html,/<table lang="en" dir="ltr" role="presentation"/);assert.match(marketing.text,/Unsubscribe from Academy marketing/);
 const operational=academyEmailPreview({kind:'operational',subject:'Class update',body:'Materials are available.'});assert.ok(!operational.html.includes('Unsubscribe from Academy marketing'));assert.equal(operational.headers,undefined);
});
test('Every visual layout has matching preview and worker content with photos, cards and custom buttons',()=>{
 for(const kind of ['marketing','operational'])for(const layout of ['invitation','launch','showcase','journal']){
  const email_content={layout,preheader:'An invitation',headline:'Bake <together>',intro:'A little inspiration.',hero_url:'https://example.com/main.jpg',hero_alt:'Bakers working with dough',cta_label:'Explore our classes',cta_url:'https://thelittlebakerkitchen.com/academy.html',items:[{title:'Bread <class>',image_url:'https://example.com/bread.jpg',alt:'A freshly baked loaf',description:'Learn to shape & bake.'}]};
  const payload={kind,subject:'Your baking invitation',body:'See you in the kitchen.',email_content},address='Fixture business address';
  const preview=academyEmailPreview(payload,address);assert.deepEqual(preview,workerRender({title:payload.subject,preview:payload.body,email_content,url:'https://thelittlebakerkitchen.com/academy/dashboard',marketing:kind==='marketing',unsubscribe_token:'0'.repeat(64),address}));
  assert.match(preview.html,/src="https:\/\/example.com\/main.jpg" alt="Bakers working with dough"/);assert.match(preview.html,/Bake &lt;together&gt;/);assert.match(preview.text,/A freshly baked loaf: https:\/\/example.com\/bread.jpg/);assert.equal((preview.html.match(/<h1\b/g)||[]).length,1);assert.ok((preview.html.match(/<table\b[^>]*>/g)||[]).every(t=>t.includes('role="presentation"')));
 }
});
test('Visual rendering never emits arbitrary HTML, dangerous image sources or unsafe button links',()=>{
 const rendered=academyEmailPreview({kind:'operational',subject:'Safety',body:'Safe body',email_content:{layout:'launch',headline:'<script>alert(1)</script>',hero_url:'javascript:alert(1)',hero_alt:'"><img src=x onerror=alert(1)>',cta_label:'<button>Click</button>',cta_url:'https://user:pass@example.com',items:[{title:'<iframe>',image_url:'data:image/svg+xml,<svg onload=alert(1)>',description:'<b>Not HTML</b>'}]}});
 assert.ok(!rendered.html.includes('<script>')&&!rendered.html.includes('<iframe>')&&!rendered.html.includes('src="javascript:')&&!rendered.html.includes('src="data:')&&!rendered.html.includes('href="https://user:pass'));
 assert.ok(rendered.html.includes('&lt;script&gt;')&&rendered.html.includes('href="https://thelittlebakerkitchen.com/academy/dashboard"'));
});
