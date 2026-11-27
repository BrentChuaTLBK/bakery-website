export async function closeAfterTransition(dialog) {
  if (!dialog.open || dialog.inert) return;

  // Keep the modal backdrop in place and prevent a second tap during the fade.
  dialog.inert = true;
  const transitions = dialog.getAnimations?.() || [];
  if (transitions.length) {
    await Promise.allSettled(transitions.map(transition => transition.finished));
  }
  dialog.close();
  dialog.inert = false;
}
