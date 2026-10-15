// Read-only production reporting over the latest saved admin order snapshots.
// Item quantities count sellable units. Saved option quantities are per unit;
// multiplying them gives selections, not a guessed recipe yield or piece count.
const PENDING = new Set(['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery']);
const SOURCES = new Set(['website', 'direct_message']);
const array = value => Array.isArray(value) ? value : [];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const compare = (a, b) => String(a).localeCompare(String(b), 'en');
const integer = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))
  && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const count = value => integer(value) ?? 0;
const itemName = item => text(item.name) || text(item.custom_name) || 'Unnamed item';
const itemDescription = item => text(item.description) || text(item.custom_description);
const reference = order => text(order.reference) || text(order.id) || 'Unreferenced order';
const sourceOf = order => text(order.source) || 'website';

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function shiftDate(value, days) {
  if (!validDate(value) || !Number.isInteger(days)) return '';
  const shifted = new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000);
  return Number.isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 10) : '';
}

export const isPaidPending = order => object(order) && SOURCES.has(sourceOf(order))
  && order.payment_status === 'paid' && PENDING.has(order.fulfillment_status) && order.refund_label !== true;

function savedOptions(item) {
  const saved = array(item.selection_labels);
  const legacy = saved.length ? [] : array(item.flavor_contents);
  const labels = (saved.length ? saved : legacy).map(choice => {
    if (typeof choice === 'string') return {group: 'Saved options', label: text(choice), quantity: null};
    if (!object(choice)) return {group: 'Options', label: '', quantity: null};
    return {group: text(choice.group) || 'Options', label: text(choice.label) || text(choice.name),
      // Legacy flavor_contents is displayed for review. Its quantity convention
      // is not guaranteed to match saved selection_labels, so do not total it.
      quantity: legacy.length ? null : integer(choice.quantity ?? choice.count)};
  });
  const raw = object(item.selections) ? Object.values(item.selections).flatMap(choices => object(choices) ? Object.values(choices) : [null]) : [];
  const rawPresent = raw.length > 0 || item.selections != null && !object(item.selections);
  const rawCounts = raw.map(value => Number(value) === 0 ? 0 : integer(value));
  const incomplete = rawPresent && (!labels.length || rawCounts.some(value => value === null)
    || labels.every(choice => choice.quantity !== null) && rawCounts.reduce((sum, value) => sum + value, 0) !== labels.reduce((sum, choice) => sum + choice.quantity, 0));
  return {labels, needsReview: Boolean(incomplete || labels.some(choice => !choice.label || choice.quantity === null))};
}

function displayOptions(labels) {
  return labels.filter(choice => choice.label).map(choice => {
    const label = /^(yes|no)$/i.test(choice.label) ? `${choice.group}: ${choice.label}` : choice.label;
    return choice.quantity !== null && choice.quantity > 1 ? `${label} ×${choice.quantity}` : label;
  }).join(' · ');
}

function optionKey(labels, description) {
  return JSON.stringify([description, labels.map(choice => [choice.group, choice.label, choice.quantity])
    .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)))]);
}

/**
 * Filter by inclusive fulfillment dates, independently of order placement time.
 * All-paid includes completed work in a separate column; pending is paid product
 * work only, even when a deferred delivery fee is still awaiting payment.
 * The optional products argument is retained for the view contract. Mutable
 * catalog names, option labels, minimums and recipe yields are never substituted
 * for the saved purchase. Unknown physical units remain labelled "units".
 */
export function buildProductionSummary(orders = [], options = {}, products = []) {
  const {start = '', end = '', today = '', scope = 'all-paid', source = 'all', method = 'all', search = '', includeOverdue = false} = options;
  const result = {
    range: {start, end}, invalidRange: !validDate(start) || !validDate(end) || start > end,
    totals: {orders: 0, units: 0, completedOrders: 0, completedUnits: 0, remainingUnits: 0, products: 0, pickup: 0, delivery: 0, overdueOrders: 0},
    products: [], days: [], orders: [], overdue: {orders: [], orderCount: 0, units: 0},
    unpaidInRange: {orderCount: 0, units: 0}, excluded: {completed: 0, cancelled: 0, expired: 0, refunded: 0, popup: 0}, notes: []
  };
  if (result.invalidRange) return result;
  const needle = text(search).toLocaleLowerCase('en');
  const inRange = order => order.fulfillment_date >= start && order.fulfillment_date <= end;
  const sourceMatches = order => SOURCES.has(sourceOf(order)) && (source === 'all' || sourceOf(order) === source);
  const methodMatches = order => method === 'all' || order.method === method;
  const selected = array(orders).filter(object).map((order, orderIndex) => {
    const lines = array(order.items).map((item, index) => ({item, index})).filter(({item}) => object(item))
      .filter(({item}) => !needle || [itemName(item), itemDescription(item), ...savedOptions(item).labels.map(choice => choice.label)]
        .join(' ').toLocaleLowerCase('en').includes(needle));
    // Retain original line indexes for custom-item identity when searching.
    const projected = needle || !Array.isArray(order.items) || lines.length !== order.items.length ? {...order, items: lines.map(({item}) => item)} : order;
    return {order: projected, lines, key: text(order.id) || `row:${orderIndex}`};
  }).filter(row => !needle || row.lines.length).filter(({order}) => methodMatches(order));
  const relevant = selected.filter(({order}) => sourceMatches(order));
  const invalidDates = relevant.filter(({order}) => !validDate(order.fulfillment_date)).length;
  if (invalidDates) result.notes.push(`${invalidDates} order(s) need a valid fulfillment date before they can be counted.`);
  const candidates = relevant.filter(({order}) => validDate(order.fulfillment_date));
  const rowUnits = row => row.lines.reduce((sum, {item}) => sum + count(item.quantity), 0);
  const overdue = candidates.filter(({order}) => isPaidPending(order) && order.fulfillment_date < start && validDate(today) && order.fulfillment_date < today)
    .sort((a, b) => compare(a.order.fulfillment_date, b.order.fulfillment_date) || compare(reference(a.order), reference(b.order)));
  result.overdue.orders = overdue.map(row => row.order);
  result.overdue.orderCount = overdue.length;
  result.overdue.units = overdue.reduce((sum, row) => sum + rowUnits(row), 0);
  for (const row of candidates.filter(({order}) => inRange(order))) {
    const {order} = row;
    if (order.refund_label === true || order.fulfillment_status === 'refunded') result.excluded.refunded++;
    else if (order.fulfillment_status === 'cancelled') result.excluded.cancelled++;
    else if (order.fulfillment_status === 'expired') result.excluded.expired++;
    else if (order.fulfillment_status === 'completed') {if (scope === 'paid-pending') result.excluded.completed++;}
    else if (order.payment_status !== 'paid') {
      result.unpaidInRange.orderCount++;
      result.unpaidInRange.units += rowUnits(row);
    } else if (!PENDING.has(order.fulfillment_status)) result.notes.push(`${reference(order)} has a fulfillment status that needs checking before production.`);
  }
  const matchesScope = order => order.payment_status === 'paid' && order.refund_label !== true
    && (scope === 'completed' ? order.fulfillment_status === 'completed'
      : scope === 'paid-pending' ? PENDING.has(order.fulfillment_status)
      : PENDING.has(order.fulfillment_status) || order.fulfillment_status === 'completed');
  const included = candidates.filter(({order}) => inRange(order) && matchesScope(order));
  if (includeOverdue && scope !== 'completed') included.push(...overdue);
  included.sort((a, b) => compare(a.order.fulfillment_date, b.order.fulfillment_date) || compare(reference(a.order), reference(b.order)));
  result.orders = included.map(row => row.order);
  result.excluded.popup = source === 'all' ? selected.filter(({order}) => ['popup', 'pos'].includes(sourceOf(order)) && validDate(order.fulfillment_date) && inRange(order)).length : 0;
  const productTotals = new Map();
  const days = new Map();
  for (const row of included) {
    const {order} = row;
    const date = order.fulfillment_date;
    const completed = order.fulfillment_status === 'completed';
    const bucket = completed ? 'completedUnits' : 'remainingUnits';
    if (!days.has(date)) days.set(date, {date, orderCount: 0, units: 0, completedUnits: 0, remainingUnits: 0, pickup: 0, delivery: 0, productCount: 0, productKeys: new Set()});
    const day = days.get(date);
    day.orderCount++;
    result.totals.orders++;
    if (completed) result.totals.completedOrders++;
    if (['pickup', 'delivery'].includes(order.method)) {day[order.method]++; result.totals[order.method]++;}
    if (isPaidPending(order) && validDate(today) && date < today) result.totals.overdueOrders++;
    if (!row.lines.length) result.notes.push(`${reference(order)} has no saved items to include in production.`);
    for (const {item, index} of row.lines) {
      const quantity = count(item.quantity);
      if (!quantity) {result.notes.push(`${reference(order)} has an item quantity that needs checking.`); continue;}
      const name = itemName(item), description = itemDescription(item);
      const custom = item.custom === true || !text(item.product_id);
      // Custom work belongs to its order and line, even when another custom cake
      // shares its name. Catalog products retain their saved purchase name.
      const key = custom ? `custom:${row.key}:${index}` : JSON.stringify([item.product_id, name]);
      if (!productTotals.has(key)) productTotals.set(key, {
        id: key, productId: text(item.product_id) || null, name, unitLabel: 'units',
        units: 0, completedUnits: 0, remainingUnits: 0, orderCount: 0, orderRefs: [], optionGroups: [], variants: [], custom,
        description, instructions: custom ? text(order.instructions) : '',
        orderSet: new Map(), groups: new Map(), variantMap: new Map()
      });
      const product = productTotals.get(key);
      product.units += quantity;
      product[bucket] += quantity;
      product.orderSet.set(row.key, reference(order));
      result.totals.units += quantity;
      result.totals[bucket] += quantity;
      day.units += quantity;
      day[bucket] += quantity;
      day.productKeys.add(key);
      const saved = savedOptions(item);
      if (saved.needsReview) result.notes.push(`${reference(order)} · ${name}: saved options need review before preparation; incomplete option counts are not included in option totals.`);
      // Do not present partial selections as a complete preparation breakdown.
      if (!saved.needsReview) for (const choice of saved.labels) {
        const amount = choice.quantity * quantity;
        if (!Number.isSafeInteger(amount)) {result.notes.push(`${reference(order)} · ${name}: option quantities exceed the supported range.`); continue;}
        if (!product.groups.has(choice.group)) product.groups.set(choice.group, {name: choice.group, kind: 'other', unitLabel: 'selections', choices: new Map()});
        const group = product.groups.get(choice.group);
        if (!group.choices.has(choice.label)) group.choices.set(choice.label, {name: choice.label, quantity: 0, completedQuantity: 0, remainingQuantity: 0});
        const choiceCount = group.choices.get(choice.label);
        choiceCount.quantity += amount;
        choiceCount[completed ? 'completedQuantity' : 'remainingQuantity'] += amount;
      }
      const label = [description, displayOptions(saved.labels)].filter(Boolean).join(' · ') || (saved.needsReview ? 'Options need review' : 'Standard');
      const variantKey = saved.needsReview ? `review:${row.key}:${index}` : optionKey(saved.labels, description);
      if (!product.variantMap.has(variantKey)) product.variantMap.set(variantKey, {label, needsReview: saved.needsReview, units: 0, completedUnits: 0, remainingUnits: 0, orderRefs: new Map()});
      const variant = product.variantMap.get(variantKey);
      variant.units += quantity;
      variant[bucket] += quantity;
      variant.orderRefs.set(row.key, reference(order));
    }
  }
  result.products = [...productTotals.values()].map(summary => {
    const {orderSet, groups, variantMap, ...product} = summary;
    product.orderRefs = [...orderSet.values()];
    product.orderCount = orderSet.size;
    product.optionGroups = [...groups.values()].map(group => ({...group, choices: [...group.choices.values()].sort((a, b) => compare(a.name, b.name))}));
    product.variants = [...variantMap.values()].map(variant => ({...variant, orderRefs: [...variant.orderRefs.values()]}));
    return product;
  }).sort((a, b) => Number(a.custom) - Number(b.custom) || b.units - a.units || compare(a.name, b.name));
  result.totals.products = result.products.length;
  result.days = [...days.values()].map(({productKeys, ...day}) => ({...day, productCount: productKeys.size})).sort((a, b) => compare(a.date, b.date));
  result.notes = [...new Set(result.notes)];
  return result;
}
