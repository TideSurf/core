import "./style.css";

type Theme = "light" | "dark";

let currentTheme: Theme = "light";
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function prefersReducedMotion(): boolean {
  return motionQuery.matches;
}

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can fail in private browsing contexts.
  }
}

function initTheme(): void {
  const saved = safeStorageGet("tidesurf-theme") as Theme | null;
  currentTheme =
    saved ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light");
  applyTheme();

  document.querySelectorAll<HTMLButtonElement>(".theme-btn[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      const theme = button.dataset.theme as Theme | undefined;
      if (!theme) return;
      currentTheme = theme;
      safeStorageSet("tidesurf-theme", theme);
      applyTheme();
    });
  });
}

function applyTheme(): void {
  document.documentElement.setAttribute("data-theme", currentTheme);
  document.querySelectorAll<HTMLButtonElement>(".theme-btn[data-theme]").forEach((button) => {
    button.classList.toggle("active", button.dataset.theme === currentTheme);
  });
}

function initCopyButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const text = button.dataset.copy;
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        const label = button.querySelector(".copy-label");
        button.classList.add("is-copied");
        if (label) label.textContent = "copied";
        setTimeout(() => {
          button.classList.remove("is-copied");
          if (label) label.textContent = "copy";
        }, 1600);
      } catch (error) {
        console.error("Copy failed:", error);
      }
    });
  });
}

async function initGitHubStars(): Promise<void> {
  const star = document.getElementById("github-star");
  const count = document.getElementById("star-count");
  if (!star || !count) return;

  try {
    const response = await fetch("https://api.github.com/repos/TideSurf/core", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;

    const data = (await response.json()) as { stargazers_count?: number };
    if (data.stargazers_count == null) return;

    count.textContent =
      data.stargazers_count >= 1000
        ? `${(data.stargazers_count / 1000).toFixed(1)}k`
        : String(data.stargazers_count);
    star.hidden = false;
  } catch {
    // The star count is nice to have, not required for the page.
  }
}

function initCookieNotice(): void {
  const notice = document.getElementById("cookie-notice");
  const dismiss = document.getElementById("cookie-dismiss");
  const themeFloat = document.querySelector<HTMLElement>(".theme-float");
  if (!notice || !dismiss) return;

  if (safeStorageGet("tidesurf-cookie-dismissed") === "true") {
    notice.hidden = true;
    return;
  }

  notice.hidden = false;
  // Lift the floating theme switch above the notice so it stays clickable.
  const lift = () => {
    if (themeFloat && !notice.hidden) {
      themeFloat.style.bottom = `${notice.offsetHeight + 12}px`;
    }
  };
  lift();
  dismiss.addEventListener("click", () => {
    safeStorageSet("tidesurf-cookie-dismissed", "true");
    notice.hidden = true;
    if (themeFloat) themeFloat.style.bottom = "";
  });
}

function initReveal(): void {
  const reveals = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
  if (!reveals.length || prefersReducedMotion() || !("IntersectionObserver" in window)) {
    reveals.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
  );

  reveals.forEach((element) => observer.observe(element));
}

type RGB = [number, number, number];

function parseHex(hex: string): RGB | null {
  const h = hex.trim().replace("#", "");
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) ? null : [r, g, b];
}

function mixColor(a: RGB, b: RGB, m: number): RGB {
  const t = Math.max(0, Math.min(1, m));
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/* Ocean mosaic — a field of tiny squares whose colour ripples left→right.
   Slow drift normally; scrolling spools the wave faster. Static (one frame)
   under prefers-reduced-motion. Colour is read from the theme variables so it
   follows light/dark automatically. */
function initWaves(): void {
  const canvas = document.querySelector<HTMLCanvasElement>(".waves-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reduced = prefersReducedMotion();
  const SQUARE = 32; // css px per tile
  const GAP = 0; // flush tiles — squares read via colour diff, no gaps
  const BASE_SPEED = 0.04; // 0.25x of the original drift
  const MAX_BOOST = 2.25; // scaled with the slower base

  let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let cols = 0;
  let rows = 0;
  let phase = 0;
  let boost = 0;
  let scrollProgress = 0;
  let lastScroll = window.scrollY;
  let raf = 0;
  let running = false;

  let paper: RGB = [231, 235, 239];
  let paper3: RGB = [202, 210, 218];
  let accent: RGB = [38, 95, 126];

  function readColors(): void {
    const cs = getComputedStyle(document.documentElement);
    paper = parseHex(cs.getPropertyValue("--paper")) ?? paper;
    paper3 = parseHex(cs.getPropertyValue("--paper-3")) ?? paper3;
    accent = parseHex(cs.getPropertyValue("--accent")) ?? accent;
  }

  function resize(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    cols = Math.ceil(w / SQUARE) + 1;
    rows = Math.ceil(h / SQUARE) + 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Stable per-cell jitter so neighbours differ "a bit to bit" even at rest.
  function cellJitter(c: number, r: number): number {
    const n = Math.sin(c * 12.9898 + r * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  function draw(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    const size = SQUARE - GAP;
    for (let r = 0; r < rows; r++) {
      const y = r * SQUARE;
      for (let c = 0; c < cols; c++) {
        // Wave travelling left -> right, with a gentle vertical drift.
        const wave = 0.5 + 0.5 * Math.sin((c - phase) * 0.1067 + r * 0.0433); // 3x more gradual
        const j = cellJitter(c, r) * 0.14 - 0.07;
        const m = Math.max(0, Math.min(1, wave + j));
        // Stay within the paper family: mostly paper -> paper-3, a whisper of accent.
        let col = mixColor(paper, paper3, m * 0.72 + scrollProgress * 0.05);
        col = mixColor(col, accent, m * 0.09 + scrollProgress * 0.07);
        ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
        ctx.fillRect(c * SQUARE, y, size, size);
      }
    }
  }

  function loop(): void {
    boost *= 0.93;
    if (boost < 0.001) boost = 0;
    phase += BASE_SPEED + boost;
    draw();
    raf = requestAnimationFrame(loop);
  }

  function start(): void {
    if (running || reduced) return;
    running = true;
    raf = requestAnimationFrame(loop);
  }

  function stop(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
  }

  function onScroll(): void {
    const dy = window.scrollY - lastScroll;
    lastScroll = window.scrollY;
    boost += Math.abs(dy) * 0.00625; // 0.25x scroll contribution
    if (boost > MAX_BOOST) boost = MAX_BOOST;
    // Scroll position nudges the field's colour: a touch more paper-3 and a
    // touch more accent as you descend. Subtle, continuous, no flicker.
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    scrollProgress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
  }

  resize();
  readColors();
  draw();

  if (!reduced) {
    start();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener(
      "resize",
      () => {
        resize();
        draw();
      },
      { passive: true }
    );
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });
  }

  // Follow theme changes (data-theme on <html>) without re-running init.
  const themeObserver = new MutationObserver(() => {
    readColors();
    draw();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

/* Highlight-pill charm: on hover, a pill gently fades to an alternate word
   (e.g. "handles" -> "little nametags"), then fades back. Opt-in via [data-alt];
   the fading text lives in a nested .hl-i so the pill background stays solid. */
function initHoverSwap(): void {
  const swaps = Array.from(document.querySelectorAll<HTMLElement>(".hl[data-alt]"));
  for (const el of swaps) {
    const inner = el.querySelector<HTMLElement>(".hl-i");
    if (!inner) continue;
    const original = inner.textContent ?? "";
    const alt = el.dataset.alt ?? original;
    let timer: number | undefined;
    const fadeTo = (text: string): void => {
      window.clearTimeout(timer);
      el.classList.add("is-swapping");
      timer = window.setTimeout(() => {
        inner.textContent = text;
        el.classList.remove("is-swapping");
      }, 140);
    };
    el.addEventListener("mouseenter", () => fadeTo(alt));
    el.addEventListener("mouseleave", () => fadeTo(original));
  }
}

async function init(): Promise<void> {
  initTheme();
  initCopyButtons();
  initCookieNotice();
  initReveal();
  initHoverSwap();
  initWaves();
  await initGitHubStars();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}
