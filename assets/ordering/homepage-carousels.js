// One clock for the specialty cards, including cards currently below the viewport.
export function startSynchronizedCarousels(root, Carousel) {
  if (!root || !Carousel) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const members = [...root.querySelectorAll('.carousel')].map(element => {
    Carousel.getInstance(element)?.dispose();
    element.removeAttribute('data-bs-ride');
    const slides = [...element.querySelectorAll('.carousel-item')];
    const instance = new Carousel(element, {interval: false, ride: false, pause: false, touch: true});
    return {element, slides, instance};
  });
  const sliding = new Set();
  let timer, step = 0, changing = false, hovered = false;
  const indexFor = (number, count) => ((number % count) + count) % count;
  function warmNext(member) {
    const {slides} = member;
    const current = slides.findIndex(slide => slide.classList.contains('active'));
    for (const index of [current, indexFor(current + 1, slides.length)]) {
      const image = slides[index]?.querySelector('img');
      if (image) image.loading = 'eager';
    }
  }
  function stop() { clearTimeout(timer); }
  function schedule() {
    stop();
    if (document.hidden || motion.matches || hovered || root.contains(document.activeElement) || !members.some(m => m.slides.length > 1)) return;
    timer = setTimeout(() => { change(step + 1); schedule(); }, 4000);
  }
  function change(next) {
    if (sliding.size) return;
    changing = true; step = next;
    try {
      for (const {slides, instance} of members) if (slides.length > 1) instance.to(indexFor(step, slides.length));
    } finally { changing = false; }
  }
  for (const member of members) {
    warmNext(member);
    member.element.addEventListener('slide.bs.carousel', event => {
      if (!changing) {
        // Dots, arrows, keyboard and swipes move the group, not a single card.
        event.preventDefault(); change(event.to); schedule();
      } else sliding.add(member.element);
    });
    member.element.addEventListener('slid.bs.carousel', () => {
      sliding.delete(member.element); warmNext(member);
    });
  }
  root.addEventListener('mouseenter', () => { hovered = true; stop(); });
  root.addEventListener('mouseleave', () => { hovered = false; schedule(); });
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) setTimeout(schedule, 0); });
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', schedule);
  schedule();
}
