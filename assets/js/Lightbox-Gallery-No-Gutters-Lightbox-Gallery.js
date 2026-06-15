if ('requestIdleCallback' in window) {
  requestIdleCallback(function() {
    if (document.querySelectorAll('[data-bss-baguettebox]').length > 0) {
       baguetteBox.run('[data-bss-baguettebox]', { animation: 'slideIn' });
    }
  });
} else {
  setTimeout(function() {
    if (document.querySelectorAll('[data-bss-baguettebox]').length > 0) {
       baguetteBox.run('[data-bss-baguettebox]', { animation: 'slideIn' });
    }
  }, 1000);
}