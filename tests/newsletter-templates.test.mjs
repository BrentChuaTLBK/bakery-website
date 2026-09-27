import test from 'node:test';
import assert from 'node:assert/strict';
import {renderNewsletterCampaign,sampleNewsletter,newsletterTemplates,newsletterUrl} from '../assets/ordering/newsletter-templates.js';
import {newsletterPromos,newsletterPromoOffer} from '../assets/ordering/newsletter-promo-offer.js';
test('all newsletter layouts render safe HTML, plain text and a working unsubscribe link',()=>{
 for(const {id} of newsletterTemplates){const c={...sampleNewsletter(id),title:'<script>alert(1)</script>',body:'Line one\nLine two'},r=renderNewsletterCampaign(c,{pickup_address:'39 Acacia Drive'},'https://thelittlebakerkitchen.com/newsletter.html#unsubscribe='+'a'.repeat(64));assert.match(r.html,/&lt;script&gt;/);assert.doesNotMatch(r.html,/<script>/);assert.match(r.html,/lang="en"/);assert.match(r.html,/role="presentation"/);assert.match(r.html,/#unsubscribe=a{64}/);assert.match(r.text,/39 Acacia Drive/);assert.match(r.text,/Line one\nLine two/);assert.ok(r.html.length<90000);}
 for(const url of ['javascript:alert(1)','http://example.test','https://user:pass@example.test'])assert.equal(newsletterUrl(url),'');
 assert.throws(()=>renderNewsletterCampaign({}, {},'javascript:alert(1)'),/unsubscribe/);
 const html=renderNewsletterCampaign({...sampleNewsletter(),hero_url:'javascript:alert(1)',cta_url:'javascript:alert(1)'}).html;assert.doesNotMatch(html,/javascript:/);
});
test('promo offer is readable without images, escaped, and included in Broadcast HTML and text',()=>{
 const c={...sampleNewsletter('promo'),offer_heading:'15% OFF',offer_code:'SWEET15<unsafe>',offer_terms:'Minimum ₱500.\nEnds October 31, 2026 PHT.'};
 const {html,text}=renderNewsletterCampaign(c,{},'{{{RESEND_UNSUBSCRIBE_URL}}}');
 assert.match(html,/USE THIS CODE AT CHECKOUT/);assert.match(html,/SWEET15&lt;unsafe&gt;/);assert.doesNotMatch(html,/<unsafe>/);
 assert.ok(html.indexOf('SWEET15')<html.indexOf('<img'));assert.match(html,/Ends October 31, 2026 PHT/);
 assert.match(text,/15% OFF\n\nSWEET15<unsafe>/);assert.match(text,/{{{RESEND_UNSUBSCRIBE_URL}}}/);
 assert.equal(sampleNewsletter('promo').offer_code,'','New draft must not invent a working code');
});
test('launch leads with the photo, Academy leads with invitation and has a relevant destination',()=>{
 const c=sampleNewsletter('launch'),r=renderNewsletterCampaign(c);
 assert.ok(r.html.indexOf('<img')<r.html.indexOf('<h1'));
 const academy=sampleNewsletter('academy');assert.match(academy.cta_url,/academy.html$/);assert.equal(academy.hero_url,'','Do not substitute unrelated product photos for a class');
 assert.equal(new Set(newsletterTemplates.map(t=>t.id)).size,6);
});
test('promo selector excludes personal, inactive, deleted, expired and malformed expiry codes',()=>{
 const now=Date.parse('2026-09-28T00:00:00Z'),good={id:'1',code:'SWEET15',active:true,expires_at:'2026-10-31T15:59:00Z'};
 assert.deepEqual(newsletterPromos([good,{...good,source:'newsletter_welcome'},{...good,active:false},{...good,deleted_at:'2026-09-01'},{...good,expires_at:'2026-09-27'},{...good,expires_at:'bad'}],now),[good]);
});
test('selected promo fills accurate percentage/fixed terms, cap, minimum and Manila expiry',()=>{
 const offer=newsletterPromoOffer({code:'SWEET15',kind:'percent',value:15,min_subtotal_cents:50000,cap_cents:15000,per_account_limit:1,expires_at:'2026-10-31T15:59:00Z'});
 assert.equal(offer.offer_heading,'15% OFF');assert.equal(offer.offer_code,'SWEET15');assert.match(offer.offer_terms,/500.00 minimum/);assert.match(offer.offer_terms,/150.00 discount/);assert.match(offer.offer_terms,/Oct 31, 2026.*11:59.*PHT/);assert.match(offer.offer_terms,/1 use per verified account/);
 const fixed=newsletterPromoOffer({code:'GIFT',kind:'fixed',value:7500});assert.match(fixed.offer_heading,/75.00 OFF/);assert.doesNotMatch(fixed.offer_terms,/minimum|Invalid|undefined/);
});
