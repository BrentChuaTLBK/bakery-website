export function orderEmailMarkup(order, token) {
  if (order.source !== 'direct_message' || order.buyer?.email?.trim() || !token || token.length < 40) return '';
  return `<section class="panel order-section no-print" aria-labelledby="order-email-title">
    <h2 id="order-email-title">Get email updates for this order</h2>
    <form id="order-email-form">
      <div data-order-email-fields>
        <label class="field">Email address
          <input name="email" type="email" maxlength="254" autocomplete="email" required>
        </label>
        <label class="check-field"><input name="newsletter" type="checkbox">
          <span>Also join the TLB newsletter for new treats and offers</span>
        </label>
      </div>
      <button type="submit" class="button">Save email for order updates</button>
      <p class="help-text" role="status"></p>
    </form>
  </section>`;
}

export function bindOrderEmail(form, { save, subscribe }) {
  if (!form) return;
  const fields = form.querySelector('[data-order-email-fields]');
  const inputs = fields.querySelectorAll('input');
  const button = form.querySelector('button');
  const status = form.querySelector('[role="status"]');
  let savedEmail = '', pending = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    const wantsNewsletter = Boolean(savedEmail) || form.elements.newsletter.checked;
    pending = true;
    button.disabled = true;
    for (const input of inputs) input.disabled = true;
    status.className = 'help-text';
    status.textContent = savedEmail ? 'Saving your newsletter signup…' : 'Saving your email…';
    try {
      if (!savedEmail) {
        const result = await save(form.elements.email.value.trim());
        savedEmail = result.email;
        fields.hidden = true;
      }
      if (wantsNewsletter) await subscribe(savedEmail);
      status.textContent = `Order updates will go to ${savedEmail}.${wantsNewsletter ? ' You’re subscribed to the TLB newsletter.' : ''}`;
      button.hidden = true;
    } catch (error) {
      status.className = 'notice danger';
      status.textContent = savedEmail
        ? `Order updates will go to ${savedEmail}. Newsletter signup could not be completed. ${error.message}`
        : error.message;
      if (savedEmail) button.textContent = 'Retry newsletter signup';
    } finally {
      pending = false;
      button.disabled = false;
      if (!savedEmail) for (const input of inputs) input.disabled = false;
    }
  });
}
