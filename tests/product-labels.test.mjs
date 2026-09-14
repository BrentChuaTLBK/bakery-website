import test from 'node:test';
import assert from 'node:assert/strict';
import { productLabelSettings, visibleProductLabel, labelTextColor, DEFAULT_LABEL_COLOR, MAX_LABEL_LENGTH } from '../assets/ordering/product-label.js';

test('existing products and disabled or blank labels have no storefront badge', () => {
  for (const label of [undefined, null, {}, { text: 'New' }, { enabled: 'true', text: 'New' }, { enabled: false, text: 'New' }, { enabled: true, text: '  ' }]) {
    assert.equal(visibleProductLabel(label), null);
  }
  const saved = productLabelSettings({ enabled: false, text: ' Best seller ', color: '#FCE8CC' });
  assert.deepEqual(saved, { enabled: false, text: 'Best seller', color: '#fce8cc' });
  assert.equal(visibleProductLabel({ ...saved, enabled: true }).text, 'Best seller');
});

test('malformed saved label values cannot become CSS and text length is bounded', () => {
  for (const color of ['red', '#fff', '#123456;background:url(https://example.com)', '"><img src=x>', {}, null]) {
    assert.equal(visibleProductLabel({ enabled: true, text: 'New', color }).color, DEFAULT_LABEL_COLOR);
  }
  assert.equal(visibleProductLabel({ enabled: true, text: 'x'.repeat(1000) }).text.length, MAX_LABEL_LENGTH);
  assert.equal(visibleProductLabel({ enabled: true, text: { html: 'New' } }), null);
});

test('opaque label backgrounds have readable black or white lettering', () => {
  assert.equal(labelTextColor('#ffffff'), '#000000');
  assert.equal(labelTextColor('#000000'), '#ffffff');
  // Cover both contrast threshold sides and a grid spanning the sRGB gamut.
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const color = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
    const channels = [r, g, b].map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    const foreground = labelTextColor(color);
    const contrast = foreground === '#000000' ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05);
    assert.ok(contrast >= 4.5, `${color} with ${foreground}: ${contrast}`);
  }
});
