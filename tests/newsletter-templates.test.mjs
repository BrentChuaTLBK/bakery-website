import test from 'node:test';
import assert from 'node:assert/strict';
import {renderNewsletterCampaign,sampleNewsletter,newsletterTemplates,newsletterUrl} from '../assets/ordering/newsletter-templates.js';
test('all newsletter layouts render safe HTML, plain text and a working unsubscribe link',()=>{
 for(const {id} of newsletterTemplates){const c={...sampleNewsletter(id),title:'<script>alert(1)</script>',body:'Line one\nLine two'},r=renderNewsletterCampaign(c,{pickup_address:'39 Acacia Drive'},'https://thelittlebakerkitchen.com/newsletter.html#unsubscribe='+'a'.repeat(64));assert.match(r.html,/&lt;script&gt;/);assert.doesNotMatch(r.html,/<script>/);assert.match(r.html,/lang="en"/);assert.match(r.html,/role="presentation"/);assert.match(r.html,/#unsubscribe=a{64}/);assert.match(r.text,/39 Acacia Drive/);assert.match(r.text,/Line one\nLine two/);assert.ok(r.html.length<90000);}
 for(const url of ['javascript:alert(1)','http://example.test','https://user:pass@example.test'])assert.equal(newsletterUrl(url),'');
 assert.throws(()=>renderNewsletterCampaign({}, {},'javascript:alert(1)'),/unsubscribe/);
 const html=renderNewsletterCampaign({...sampleNewsletter(),hero_url:'javascript:alert(1)',cta_url:'javascript:alert(1)'}).html;assert.doesNotMatch(html,/javascript:/);
});
