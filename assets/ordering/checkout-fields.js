export const CONTACT_NUMBER_MESSAGE = 'Enter a contact number with 7–15 digits. You may use a leading +, spaces, hyphens, and parentheses; letters are not allowed.';

export function isValidContactNumber(value) {
  if (typeof value !== 'string') return false;
  const number = value.replace(/^ +| +$/g, '');
  const digits = number.replace(/[^0-9]/g, '');
  const body = number.startsWith('+') ? number.slice(1) : number;
  return number.length <= 40 && !/[^0-9 ()-]/.test(body) && digits.length >= 7 && digits.length <= 15;
}

export function syncCheckoutFields(form) {
  for (const name of ['buyer_phone', 'recipient_phone']) {
    const input = form.elements.namedItem(name);
    if (input) input.setCustomValidity(input.value && !isValidContactNumber(input.value) ? CONTACT_NUMBER_MESSAGE : '');
  }
  const platform = form.elements.namedItem('social_platform');
  const username = form.elements.namedItem('social_username');
  if (!platform || !username) return;
  const enabled = ['facebook', 'instagram'].includes(platform.value);
  username.disabled = !enabled;
  username.required = enabled;
  username.placeholder = enabled ? 'Enter your username' : 'Choose a social platform first';
  if (!enabled) username.value = '';
}
