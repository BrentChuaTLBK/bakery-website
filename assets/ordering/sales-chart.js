// The buttons' accessible names contain the same figures as the visual popup.
export function bindSalesChart(root) {
  const frame = root.querySelector('.analytics-chart-frame');
  if (!frame) return () => {};
  const tooltip = frame.querySelector('.analytics-chart-tooltip');
  const scroller = frame.querySelector('.analytics-chart-scroll');
  const controller = new AbortController();
  const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: controller.signal });
  const point = target => target?.closest?.('.analytics-chart-point');
  let active = null, pinned = null;

  function hide() {
    active?.removeAttribute('data-active');
    active = pinned = null;
    tooltip.hidden = true;
  }
  function show(button) {
    active?.removeAttribute('data-active');
    active = button;
    button.dataset.active = 'true';
    tooltip.querySelector('[data-chart-period]').textContent = button.dataset.period;
    tooltip.querySelector('[data-chart-sales]').textContent = button.dataset.sales;
    tooltip.querySelector('[data-chart-orders]').textContent = button.dataset.orders;
    tooltip.hidden = false;
    const bounds = frame.getBoundingClientRect();
    const bar = button.querySelector('.analytics-chart-bar').getBoundingClientRect();
    const left = bar.left + bar.width / 2 - bounds.left - tooltip.offsetWidth / 2;
    tooltip.style.left = `${Math.max(0, Math.min(left, bounds.width - tooltip.offsetWidth))}px`;
    tooltip.style.top = `${Math.max(0, bar.top - bounds.top - tooltip.offsetHeight - 8)}px`;
  }
  listen(frame, 'pointerover', event => {
    const button = point(event.target);
    if (event.pointerType === 'touch' || !button || button === active) return;
    pinned = null;
    show(button);
  });
  listen(frame, 'pointerleave', () => { if (!pinned) hide(); });
  listen(frame, 'focusin', event => {
    const button = point(event.target);
    if (button) { pinned = null; show(button); }
  });
  listen(frame, 'focusout', event => { if (!frame.contains(event.relatedTarget)) hide(); });
  listen(frame, 'click', event => {
    const button = point(event.target);
    if (!button) return;
    if (pinned === button) hide();
    else { pinned = button; show(button); }
  });
  listen(document, 'pointerdown', event => { if (!frame.contains(event.target)) hide(); });
  listen(document, 'keydown', event => { if (event.key === 'Escape') hide(); });
  listen(scroller, 'scroll', hide);
  listen(window, 'resize', hide);
  return () => { hide(); controller.abort(); };
}
