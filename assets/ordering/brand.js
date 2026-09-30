/** Keep the current public brand consistent with older saved settings. */
export function brandName(value) {
  const name = String(value ?? '').trim();
  return !name || /^the little baker kitchen$/i.test(name) ? 'TLB Kitchen' : name;
}
