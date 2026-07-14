type ScrollToneSource = Window | HTMLElement;

interface ScrollToneOptions {
  source?: ScrollToneSource;
  observe?: Element;
}

/**
 * Maps page depth to one flat background tone. The active scroll container may
 * switch between a desktop pane and the window at responsive breakpoints.
 */
export function initScrollTone(options: ScrollToneOptions = {}): () => void {
  const root = document.documentElement;
  const source = options.source ?? window;
  const observed = options.observe ?? document.body;
  let frame = 0;

  const measure = (): { top: number; range: number } => {
    if (source instanceof HTMLElement) {
      const elementRange = source.scrollHeight - source.clientHeight;
      if (elementRange > 1) {
        return { top: source.scrollTop, range: elementRange };
      }
    }

    const range = document.documentElement.scrollHeight - window.innerHeight;
    return { top: window.scrollY, range };
  };

  const render = (): void => {
    frame = 0;
    const { top, range } = measure();
    const progress = Math.min(1, Math.max(0, top / Math.max(1, range * 0.86)));
    const eased = Math.pow(progress, 0.78);
    const maximum = root.dataset.theme === "dark" ? 36 : 27;
    root.style.setProperty("--scroll-shade", `${(eased * maximum).toFixed(2)}%`);
  };

  const schedule = (): void => {
    if (frame) return;
    frame = window.requestAnimationFrame(render);
  };

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  if (source instanceof HTMLElement) {
    source.addEventListener("scroll", schedule, { passive: true });
  }

  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(observed);

  const themeObserver = new MutationObserver(schedule);
  themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  render();

  return () => {
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    if (source instanceof HTMLElement) {
      source.removeEventListener("scroll", schedule);
    }
    resizeObserver.disconnect();
    themeObserver.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
  };
}
