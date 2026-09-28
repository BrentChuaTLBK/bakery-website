import {test} from 'node:test';
import assert from 'node:assert/strict';
import {legacyPaymentOptions,orderPaymentDetails,renderPaymentOptions} from '../assets/ordering/payment-options.js';
const legacy='Accepted Payment Methods:\n\nGCash\nQA Account\n00000000001\n\nBDO\nQA Bank\n000000000002\n\nEast West\nQA Shop\n000000000003';
test('legacy payment options preserve all three methods and leading zeros',()=>{
 const result=legacyPaymentOptions(legacy);assert.equal(result.length,3);assert.equal(result[1].account_number,'000000000002');
 assert.equal(legacyPaymentOptions(legacy+'\nA note to preserve').length,0);
 assert.equal(legacyPaymentOptions('Contact us for payment').length,0);
});
test('old orders never silently receive a newer payment account',()=>{
 const current={payment_options:[{...legacyPaymentOptions(legacy)[0],account_number:'11111111111'}]};
 const details=orderPaymentDetails({payment_instructions:legacy},current);assert.equal(details.options[0].account_number,'00000000001');
 assert.equal(orderPaymentDetails({payment_instructions:'Saved legacy instructions'},current).options.length,0);
 assert.equal(orderPaymentDetails({},current).options[0].account_number,'11111111111');
 assert.equal(orderPaymentDetails({payment_options:[]},current).options.length,0);
});
test('payment markup escapes all labels and details, and only exposes enabled methods',()=>{
 const options=legacyPaymentOptions(legacy);options[0].label='<script>bad()</script>';options[0].account_name='"/><img src=x onerror=bad()>';options[1].enabled=false;
 const html=renderPaymentOptions({id:'test',total_cents:31500,payment_options:options,payment_note:'<bad>'});
 assert.doesNotMatch(html,/<script>|<img src=x|>BDO</);assert.match(html,/&lt;script&gt;/);assert.match(html,/value="315\.00"/);
 assert.match(html,/value="00000000001"/);assert.match(html,/aria-live="polite"/);
});
