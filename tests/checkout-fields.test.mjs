import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidContactNumber, socialContactMessage, syncCheckoutFields } from '../assets/ordering/checkout-fields.js';

test('contact numbers retain leading zeroes and accept common local and international formatting', () => {
  for (const number of ['09171234567', '+639171234567', '0917 123 4567', '+63 (917) 123-4567', '(02) 8123-4567', '8123456', '+123456789012345', ' 0917-123-4567 ']) {
    assert.equal(isValidContactNumber(number), true, number);
  }
});

test('words, partial numbers, extra plus signs, extensions and hidden characters are rejected', () => {
  for (const number of ['', 'contact me', '0917abc4567', '09171234567 ext 2', '123456', '+1234567890123456', '63+9171234567', '++639171234567', '0917.123.4567', '0917\t1234567', '09171234567\n', '09171234567\r', '0917\u200b1234567', '０９１７１２３４５６７', '('.repeat(34) + '1234567', null, 9171234567]) {
    assert.equal(isValidContactNumber(number), false, String(number));
  }
});

test('a new checkout requires an explicit social platform and a trimmed nonempty name', () => {
  for (const [platform, username] of [['', ''], ['', 'name'], ['tiktok', 'name'], ['facebook', ''], ['instagram', ' \t\n '], ['facebook', 'x'.repeat(101)], ['na', 'somebody']]) {
    assert.notEqual(socialContactMessage(platform, username), '', `${platform}: ${username}`);
  }
  for (const [platform, username] of [['facebook', '  Real Name  '], ['instagram', '@handle'], ['facebook', 'N/A'], ['instagram', ' n/a '], ['na', 'N/A'], [' NA ', ' n/a '], ['facebook', 'x'.repeat(100)]]) {
    assert.equal(socialContactMessage(platform, username), '', `${platform}: ${username}`);
  }
});

test('an optional legacy social contact allows only a completely blank pair', () => {
  assert.equal(socialContactMessage('', '', { required: false }), '');
  assert.notEqual(socialContactMessage('', 'username', { required: false }), '');
  assert.notEqual(socialContactMessage('facebook', '', { required: false }), '');
  assert.equal(socialContactMessage('instagram', 'N/A', { required: false }), '');
});

function checkoutForm(platform = '', username = '') {
  const input = value => ({ value, disabled: false, required: false, readOnly: false, validationMessage: '', setCustomValidity(message) { this.validationMessage = message; } });
  const fields = { social_platform: input(platform), social_username: input(username), buyer_phone: input('09171234567'), recipient_phone: input('') };
  return { fields, elements: { namedItem: name => fields[name] } };
}

test('no selected platform disables and clears a stale username and rejects submission', () => {
  const form = checkoutForm('', 'stale.username');
  syncCheckoutFields(form);
  assert.equal(form.fields.social_platform.required, true);
  assert.notEqual(form.fields.social_platform.validationMessage, '');
  assert.equal(form.fields.social_username.disabled, true);
  assert.equal(form.fields.social_username.value, '');
  assert.equal(form.fields.social_username.validationMessage, '');
});

test('Facebook and Instagram require a name but preserve it when switching between platforms', () => {
  const form = checkoutForm('facebook', ' \t ');
  syncCheckoutFields(form);
  const { social_platform: platform, social_username: username } = form.fields;
  assert.equal(username.disabled, false);
  assert.equal(username.required, true);
  assert.equal(username.readOnly, false);
  assert.notEqual(username.validationMessage, '');
  username.value = 'My Profile';
  syncCheckoutFields(form);
  assert.equal(username.validationMessage, '');
  platform.value = 'instagram';
  syncCheckoutFields(form);
  assert.equal(username.value, 'My Profile');
  username.value = 'N/A';
  syncCheckoutFields(form);
  platform.value = 'facebook';
  syncCheckoutFields(form);
  assert.equal(username.value, 'N/A', 'Explicitly entered N/A is preserved between real platforms');
  assert.equal(username.validationMessage, '');
});

test('N/A is included in form data and switching to a real platform requires a deliberate name', () => {
  const form = checkoutForm('facebook', 'My Profile');
  const { social_platform: platform, social_username: username } = form.fields;
  syncCheckoutFields(form);
  platform.value = 'na';
  syncCheckoutFields(form);
  assert.equal(username.disabled, false, 'Enabled readonly values are included in FormData');
  assert.equal(username.readOnly, true);
  assert.equal(username.value, 'N/A');
  assert.equal(username.validationMessage, '');
  syncCheckoutFields(form);
  assert.equal(username.value, 'N/A', 'Repeated synchronization retains the N/A answer');
  platform.value = 'instagram';
  syncCheckoutFields(form);
  assert.equal(username.value, '');
  assert.equal(username.readOnly, false);
  assert.notEqual(username.validationMessage, '');
});

test('restored valid choices retain their values and phone validation stays independent', () => {
  for (const [platform, value, expected] of [['facebook', 'Profile Name', 'Profile Name'], ['instagram', 'N/A', 'N/A'], ['na', '', 'N/A']]) {
    const form = checkoutForm(platform, value);
    form.fields.buyer_phone.value = 'call me';
    syncCheckoutFields(form);
    assert.equal(form.fields.social_username.value, expected);
    assert.equal(form.fields.social_username.validationMessage, '');
    assert.notEqual(form.fields.buyer_phone.validationMessage, '');
    form.fields.buyer_phone.value = '+63 917 123 4567';
    syncCheckoutFields(form);
    assert.equal(form.fields.buyer_phone.validationMessage, '');
  }
});
