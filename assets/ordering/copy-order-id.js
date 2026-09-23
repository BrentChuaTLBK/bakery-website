// Copy only the public display reference, never a UUID, URL or access token.
export async function copyOrderId(reference) {
  if (typeof reference !== 'string' || !reference.trim()) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(reference);
      return true;
    }
  } catch { /* Older browsers or denied permission can use the selection fallback. */ }
  const active=document.activeElement;
  const field=document.createElement('textarea');
  field.value=reference;
  field.readOnly=true;
  field.setAttribute('aria-label','Order ID to copy');
  field.style.cssText='position:fixed;left:-9999px;top:0;font-size:16px;';
  document.body.append(field);
  try {
    field.focus({preventScroll:true});
    field.select();
    field.setSelectionRange(0,reference.length);
    return document.execCommand('copy')===true;
  } catch {
    return false;
  } finally {
    field.remove();
    active?.focus({preventScroll:true});
  }
}
