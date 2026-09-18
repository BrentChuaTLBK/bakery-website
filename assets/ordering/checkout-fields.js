export const CONTACT_NUMBER_MESSAGE = 'Enter a contact number with 7–15 digits. You may use a leading +, spaces, hyphens, and parentheses; letters are not allowed.';

export function isValidContactNumber(value) {
  if (typeof value !== 'string') return false;
  const number = value.replace(/^ +| +$/g, '');
  const digits = number.replace(/[^0-9]/g, '');
  const body = number.startsWith('+') ? number.slice(1) : number;
  return number.length <= 40 && !/[^0-9 ()-]/.test(body) && digits.length >= 7 && digits.length <= 15;
}

export function socialContactMessage(platform, username, { required = true } = {}) {
  const choice = typeof platform === 'string' ? platform.trim().toLowerCase() : '';
  const name = typeof username === 'string' ? username.trim() : '';
  if (!required && !choice && !name) return '';
  if (!['facebook', 'instagram', 'na'].includes(choice)) return 'Choose Facebook, Instagram, or N/A.';
  if (!name) return 'Enter your social username or profile name, or N/A if unavailable.';
  if (name.length > 100) return 'Keep your social username or profile name to 100 characters or fewer.';
  if (choice === 'na' && name.toUpperCase() !== 'N/A') return 'Use N/A when no social platform is available.';
  return '';
}

const previousPlatforms = new WeakMap();

export function syncCheckoutFields(form) {
  for (const name of ['buyer_phone', 'recipient_phone']) {
    const input = form.elements.namedItem(name);
    if (input) input.setCustomValidity(input.value && !isValidContactNumber(input.value) ? CONTACT_NUMBER_MESSAGE : '');
  }
  const platform = form.elements.namedItem('social_platform');
  const username = form.elements.namedItem('social_username');
  if (!platform || !username) return;
  const choice = platform.value;
  const enabled = ['facebook', 'instagram', 'na'].includes(choice);
  platform.required = true;
  platform.setCustomValidity(enabled ? '' : 'Choose Facebook, Instagram, or N/A.');
  username.disabled = !enabled;
  username.required = enabled;
  username.readOnly = choice === 'na';
  username.placeholder = enabled ? 'Username, profile name, or N/A' : 'Choose a social platform first';
  if (!enabled) username.value = '';
  else if (choice === 'na') username.value = 'N/A';
  else if (previousPlatforms.get(username) === 'na') username.value = '';
  username.setCustomValidity(enabled ? socialContactMessage(choice, username.value) : '');
  previousPlatforms.set(username, choice);
}
