import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidContactNumber } from '../assets/ordering/checkout-fields.js';

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
