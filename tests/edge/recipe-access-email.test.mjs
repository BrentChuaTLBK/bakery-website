import test from 'node:test';
import assert from 'node:assert/strict';
import {renderEmail} from '../../supabase/functions/_shared/emails.ts';
test('recipe invitation renders escaped recipient, fixed sign-in URL and accurate role scope',()=>{
 for(const permission of ['chef','kitchen']){
  const {html,text}=renderEmail({event_type:'recipe_access_invitation',email:'person+<img src=x>@example.test',permission});
  assert.ok(html.startsWith('<!doctype html>'));assert.ok(text.includes('verify that email address'));assert.ok(text.includes('does not grant shop administration'));
  assert.ok(html.includes('&lt;img src=x&gt;'));assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('https://thelittlebakerkitchen.com/account.html?next=recipes.html'));assert.ok(text.includes(permission==='chef'?'Only the owner':'Costing, supplier contacts'));
 }
});
