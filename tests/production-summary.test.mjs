import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProductionSummary, isPaidPending, shiftDate, validDate} from '../assets/ordering/production-summary.js';

// These shapes mirror quote/admin snapshots: labels count selections PER unit,
// and custom POS items persist name/description rather than editor field names.
const today = '2026-10-15';
const productId = '79cbb8f7-df5c-4c17-983d-aec0778df7e8';
const choice = (group, label, quantity = 1, surcharge_cents = 0) => ({group, label, quantity, surcharge_cents});
const line = (overrides = {}) => ({product_id: productId, name: 'Butter Cookies (440ml)', quantity: 2,
  selections: {flavor: {earl_grey: 1}, gift: {yes: 1}},
  selection_labels: [choice('Choose your flavor', 'Earl Grey'), choice('Add a clear gift bag?', 'Yes', 1, 4000)],
  unit_price_cents: 24000, line_total_cents: 48000, ...overrides});
const order = (overrides = {}) => ({id: 'order-one', reference: 'TLB-32E044F730', created_at: '2026-09-01T01:00:00Z',
  fulfillment_date: today, source: 'website', method: 'pickup', payment_status: 'paid', fulfillment_status: 'confirmed',
  refund_label: false, buyer: {name: 'Fixture customer'}, instructions: '', items: [line()], ...overrides});
const summary = (orders, options = {}, products = []) => buildProductionSummary(orders, {start: today, end: today, today, ...options}, products);
const totals = report => [report.totals.orders, report.totals.units, report.totals.remainingUnits, report.totals.completedUnits];
const box = (quantity = 2) => line({product_id: 'box', name: 'Box of six cookies', quantity,
  selections: {mix: {vanilla: 3, matcha: 2, chocolate: 1}, wrap: {standard: 1}},
  selection_labels: [choice('Choose 6', 'Vanilla', 3), choice('Choose 6', 'Matcha', 2), choice('Choose 6', 'Chocolate'), choice('Packaging', 'Standard box')]});

test('paid unfinished and completed units reconcile; deferred delivery payment does not exclude paid products', () => {
  const rows = [order(), order({id: 'done', reference: 'TLB-DONE', fulfillment_status: 'completed', items: [line({quantity: 3})]}),
    order({id: 'delivery', reference: 'TLB-DELIVERY', source: 'direct_message', method: 'delivery', deferred_delivery: true,
      delivery_payment_status: 'awaiting_payment', items: [line({quantity: 1})]})];
  const all = summary(rows);
  assert.deepEqual(totals(all), [3, 6, 3, 3]);
  assert.deepEqual(totals(summary(rows, {scope: 'paid-pending'})), [2, 3, 3, 0]);
  assert.deepEqual(totals(summary(rows, {scope: 'completed'})), [1, 3, 0, 3]);
  assert.equal(all.totals.completedOrders, 1);
  assert.equal(all.totals.pickup, 2);
  assert.equal(all.totals.delivery, 1);
  assert.equal(all.products[0].units, all.products[0].remainingUnits + all.products[0].completedUnits);
  assert.deepEqual(all.products[0].optionGroups[0].choices, [{name: 'Earl Grey', quantity: 6, completedQuantity: 3, remainingQuantity: 3}]);
});

test('all active unpaid, terminal, refund-labelled, pop-up and unknown paid states stay outside production', () => {
  const rows = [
    ...['awaiting_payment', 'under_review', 'rejected'].map((payment_status, i) => order({id: `unpaid-${i}`, payment_status, fulfillment_status: 'pending_confirmation'})),
    ...['cancelled', 'expired', 'refunded', 'pending_confirmation', 'unknown_state'].map((fulfillment_status, i) => order({id: `closed-${i}`, fulfillment_status})),
    order({id: 'refund', refund_label: true}), order({id: 'popup', source: 'popup', fulfillment_status: 'completed'}),
    order({id: 'old-pos', source: 'pos', fulfillment_status: 'completed'}), order({id: 'unknown-source', source: 'future_source'})
  ];
  const report = summary(rows);
  assert.deepEqual(totals(report), [0, 0, 0, 0]);
  assert.deepEqual(report.unpaidInRange, {orderCount: 3, units: 6});
  assert.equal(report.excluded.cancelled, 1);
  assert.equal(report.excluded.expired, 1);
  assert.equal(report.excluded.refunded, 2);
  assert.equal(report.excluded.popup, 2);
  assert.match(report.notes.join(' '), /fulfillment status that needs checking/);
  for (const fulfillment_status of ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery']) assert.equal(isPaidPending(order({fulfillment_status})), true);
  for (const value of rows) assert.equal(isPaidPending(value), false);
});

test('fulfillment dates have inclusive endpoints and ignore placement timestamps and viewer timezone', () => {
  const rows = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'].map((fulfillment_date, i) => order({id: String(i), fulfillment_date}));
  assert.deepEqual(totals(summary(rows, {start: '2026-10-15', end: '2026-10-16'})), [2, 4, 4, 0]);
  assert.deepEqual(totals(summary(rows, {start: '2026-09-01', end: '2026-09-01'})), [0, 0, 0, 0]);
  assert.deepEqual(summary(rows, {end: '2026-10-16'}).days.map(day => day.date), ['2026-10-15', '2026-10-16']);
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('invalid', 1), '');
});

test('saved per-unit selection counts multiply while packaging and sellable quantities remain separate', () => {
  const report = summary([order({items: [box()]})]);
  assert.deepEqual(totals(report), [1, 2, 2, 0]);
  const product = report.products[0];
  assert.equal(product.unitLabel, 'units');
  const flavors = product.optionGroups.find(group => group.name === 'Choose 6');
  assert.equal(flavors.unitLabel, 'selections');
  assert.deepEqual(flavors.choices.map(value => [value.name, value.quantity]), [['Chocolate', 2], ['Matcha', 4], ['Vanilla', 6]]);
  assert.equal(product.optionGroups.find(group => group.name === 'Packaging').choices[0].quantity, 2);
  assert.equal(product.units, 2, 'The twelve selected cookies and two packaging selections are not extra sold units');
});

test('catalog changes and website minimums cannot rewrite saved purchases or infer physical units', () => {
  const catalog = [{id: productId, name: 'Renamed product', min_quantity: 2,
    production: {unitLabel: 'invented jars', groups: {'Choose your flavor': {unitLabel: 'invented pieces'}}},
    option_groups: [{id: 'flavor', label: 'Changed flavor', required_count: 5, choices: [{id: 'earl_grey', label: 'Changed name'}]}]}];
  const report = summary([order({source: 'direct_message', items: [line({quantity: 1})]})], {}, catalog);
  assert.deepEqual(totals(report), [1, 1, 1, 0]);
  assert.equal(report.products[0].name, 'Butter Cookies (440ml)');
  assert.equal(report.products[0].unitLabel, 'units');
  assert.equal(report.products[0].optionGroups[0].choices[0].name, 'Earl Grey');
  assert.equal(report.products[0].optionGroups[0].choices[0].quantity, 1);
  assert.doesNotMatch(JSON.stringify(report), /invented|Changed name|Renamed product/);
});

test('equivalent saved option combinations merge irrespective of array order and retain Yes/No context', () => {
  const first = order(), second = order({id: 'second', reference: 'TLB-SECOND', items: [line({selection_labels: [...line().selection_labels].reverse()})]});
  const report = summary([first, second]);
  assert.equal(report.products[0].variants.length, 1);
  assert.equal(report.products[0].variants[0].units, 4);
  assert.match(report.products[0].variants[0].label, /Add a clear gift bag\?: Yes/);
  assert.equal(report.products[0].orderCount, 2);
  assert.equal(report.products[0].variants[0].orderRefs.length, 2);
});

test('overdue pending work stays visible and opt-in preserves original dates without duplicates', () => {
  const rows = [order(), order({id: 'old', reference: 'TLB-OLD', fulfillment_date: '2026-10-13'}),
    order({id: 'done', fulfillment_date: '2026-10-12', fulfillment_status: 'completed'}),
    order({id: 'unpaid', fulfillment_date: '2026-10-14', payment_status: 'under_review', fulfillment_status: 'pending_confirmation'}),
    order({id: 'yesterday-unpaid', fulfillment_date: '2026-10-14', payment_status: 'awaiting_payment', fulfillment_status: 'pending_confirmation'})];
  const base = summary(rows);
  assert.deepEqual([base.overdue.orderCount, base.overdue.units], [1, 2]);
  assert.deepEqual(totals(base), [1, 2, 2, 0]);
  const included = summary(rows, {includeOverdue: true});
  assert.deepEqual(totals(included), [2, 4, 4, 0]);
  assert.deepEqual(included.days.map(day => day.date), ['2026-10-13', today]);
  assert.equal(summary(rows, {start: '2026-10-13', includeOverdue: true}).totals.orders, 2);
  assert.equal(summary(rows, {scope: 'completed', includeOverdue: true}).totals.orders, 0);
});

test('source, fulfillment method and product/flavor search filter totals and overdue line quantities together', () => {
  const rows = [order({items: [line(), box(3)]}), order({id: 'direct', source: 'direct_message', method: 'delivery', items: [line({quantity: 1})]}),
    order({id: 'old', fulfillment_date: '2026-10-14', items: [line(), box()]})];
  assert.deepEqual(totals(summary(rows, {source: 'direct_message'})), [1, 1, 1, 0]);
  assert.deepEqual(totals(summary(rows, {method: 'delivery'})), [1, 1, 1, 0]);
  const cookies = summary(rows, {search: 'Earl Grey'});
  assert.deepEqual(totals(cookies), [2, 3, 3, 0]);
  assert.equal(cookies.products.length, 1);
  assert.equal(cookies.orders[0].items.length, 1);
  assert.equal(cookies.overdue.units, 2);
  assert.deepEqual(totals(summary(rows, {search: 'matcha'})), [1, 3, 3, 0]);
  assert.equal(summary(rows, {search: 'unknown product'}).totals.orders, 0);
});

test('custom POS items remain separate per order and line with saved descriptions and instructions', () => {
  const custom = {product_id: null, name: 'Custom cake', description: '6-inch chocolate · pink flowers', custom: true, quantity: 1,
    selections: {}, selection_labels: [], unit_price_cents: 220000, line_total_cents: 220000};
  const rows = [order({source: 'direct_message', instructions: 'Happy Birthday, Mia', items: [line(), custom]}),
    order({id: 'other', reference: 'TLB-OTHER', source: 'direct_message', instructions: 'No message', items: [{...custom, description: '8-inch vanilla · blue flowers'}]})];
  const report = summary(rows);
  const customs = report.products.filter(product => product.custom);
  assert.equal(customs.length, 2);
  assert.deepEqual(customs.map(product => product.description).sort(), ['6-inch chocolate · pink flowers', '8-inch vanilla · blue flowers']);
  assert.deepEqual(customs.map(product => product.instructions).sort(), ['Happy Birthday, Mia', 'No message']);
  assert.ok(customs.every(product => product.orderCount === 1));
  const searched = summary(rows, {search: 'pink flowers'});
  assert.equal(searched.products[0].id, customs.find(product => product.description.includes('pink')).id, 'Search retains the original custom line identity');
  const alias = summary([order({items: [{custom_name: 'Legacy cake', custom_description: 'Saved details', quantity: 1}]})]);
  assert.equal(alias.products[0].name, 'Legacy cake');
  assert.equal(alias.products[0].description, 'Saved details');
});

test('same catalog product with distinct saved names or descriptions is not silently combined', () => {
  const renamed = summary([order(), order({id: 'renamed', items: [line({name: 'Old product name'})]})]);
  assert.equal(renamed.products.length, 2);
  const descriptions = summary([order({items: [line({description: 'White ribbon'}), line({description: 'Red ribbon'})]})]);
  assert.equal(descriptions.products.length, 1);
  assert.equal(descriptions.products[0].variants.length, 2);
  assert.notEqual(descriptions.products[0].variants[0].label, descriptions.products[0].variants[1].label);
});

test('legacy name/count labels are accepted, while missing, partial and text-only options require review', () => {
  const legacy = summary([order({items: [line({selections: {flavor: {cheese: 1}}, selection_labels: [{group: 'Flavor', name: 'Cheese', count: 1}]})]})]);
  assert.equal(legacy.products[0].optionGroups[0].choices[0].quantity, 2);
  for (const selection_labels of [[], ['Earl Grey ×1'], [{group: 'Flavor', label: 'Earl Grey'}], [line().selection_labels[0]], [null]]) {
    const report = summary([order({items: [line({selection_labels})]})]);
    assert.equal(report.products[0].optionGroups.length, 0);
    assert.equal(report.products[0].variants[0].needsReview, true);
    assert.match(report.notes.join(' '), /saved options need review/);
  }
  const unresolved = summary([order({items: [line({selection_labels: []}), line({selection_labels: []})]})]);
  assert.equal(unresolved.products[0].variants.length, 2, 'Unknown combinations do not merge as Standard');
  const standard = summary([order({items: [line({selection_labels: [], selections: {}})]})]);
  assert.equal(standard.products[0].variants[0].label, 'Standard');
  assert.equal(standard.notes.length, 0, 'Current catalog options cannot prove an older saved standard item had options');
});

test('legacy flavor_contents is a review fallback and never counted twice alongside saved labels', () => {
  const preferred = summary([order({items: [line({flavor_contents: [{name: 'Do not repeat', quantity: 99}]})]})]);
  assert.equal(preferred.products[0].optionGroups[0].choices[0].quantity, 2);
  assert.doesNotMatch(JSON.stringify(preferred.products), /Do not repeat/);
  const fallback = summary([order({items: [line({selection_labels: [], selections: {}, flavor_contents: [{name: 'Legacy vanilla', quantity: 3}]})]})]);
  assert.match(fallback.products[0].variants[0].label, /Legacy vanilla/);
  assert.equal(fallback.products[0].optionGroups.length, 0);
  assert.equal(fallback.products[0].variants[0].needsReview, true);
});

test('invalid ranges, dates and quantities are visible and do not mutate snapshots', () => {
  const rows = [order(), order({id: 'bad-date', fulfillment_date: '2026-02-30'}), order({id: 'bad-quantity', items: [line({quantity: true}), null]})];
  const before = structuredClone(rows);
  for (const options of [{start: 'bad'}, {end: '2026-02-30'}, {start: '2026-10-16'}]) {
    const result = summary(rows, options);
    assert.equal(result.invalidRange, true);
    assert.deepEqual(totals(result), [0, 0, 0, 0]);
  }
  const result = summary(rows);
  assert.equal(result.totals.units, 2);
  assert.match(result.notes.join(' '), /valid fulfillment date/);
  assert.match(result.notes.join(' '), /item quantity that needs checking/);
  assert.deepEqual(rows, before);
  assert.equal(summary([order({items: null})]).orders[0].items.length, 0);
  assert.match(summary([order({items: null})]).notes[0], /no saved items/);
});

test('per-day, product, variant and selection remaining/completed counts all reconcile', () => {
  const rows = [order({items: [line(), box()]}), order({id: 'done', reference: 'TLB-DONE', fulfillment_status: 'completed', items: [line(), box(1)]}),
    order({id: 'next', reference: 'TLB-NEXT', fulfillment_date: '2026-10-16', items: [box(3)]})];
  const report = summary(rows, {end: '2026-10-16'});
  for (const row of [...report.products, ...report.days, ...report.products.flatMap(product => product.variants)]) assert.equal(row.units, row.remainingUnits + row.completedUnits);
  for (const group of report.products.flatMap(product => product.optionGroups)) for (const row of group.choices) assert.equal(row.quantity, row.remainingQuantity + row.completedQuantity);
  assert.equal(report.products.reduce((sum, product) => sum + product.units, 0), report.totals.units);
  assert.equal(report.days.reduce((sum, day) => sum + day.units, 0), report.totals.units);
});
