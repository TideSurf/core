import "./style.css";
import { initScrollTone } from "../../shared/scroll-tone";

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

function isTheme(value: string | null | undefined): value is Theme {
  return value === "light" || value === "dark";
}

function initTheme(): void {
  const saved = safeStorageGet("tidesurf-theme");
  currentTheme = isTheme(saved)
    ? saved
    : window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  applyTheme();

  document.querySelectorAll<HTMLButtonElement>(".theme-btn[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      const theme = button.dataset.theme;
      if (!isTheme(theme)) return;
      currentTheme = theme;
      safeStorageSet("tidesurf-theme", theme);
      applyTheme();
    });
  });
}

function applyTheme(): void {
  document.documentElement.setAttribute("data-theme", currentTheme);
  document.querySelectorAll<HTMLButtonElement>(".theme-btn[data-theme]").forEach((button) => {
    const active = button.dataset.theme === currentTheme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function initCopyButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const text = button.dataset.copy;
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        const status = button.querySelector<HTMLElement>(".copy-status");
        button.classList.add("is-copied");
        button.setAttribute("aria-label", "Copied");
        if (status) status.textContent = "CLI command copied";
        setTimeout(() => {
          button.classList.remove("is-copied");
          button.setAttribute("aria-label", "Copy CLI command");
          if (status) status.textContent = "";
        }, 1600);
      } catch (error) {
        const status = button.querySelector<HTMLElement>(".copy-status");
        if (status) status.textContent = "Copy failed";
        console.error("Copy failed:", error);
      }
    });
  });
}

type RGB = [number, number, number];

function parseHex(hex: string): RGB | null {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[\da-f]{6}$/i.test(h)) return null;
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

// Wave motion follows user preferences, viewport size, and page visibility.
function initWaves(): void {
  const canvas = document.querySelector<HTMLCanvasElement>(".waves-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reducedDataQuery = window.matchMedia("(prefers-reduced-data: reduce)");
  const compactQuery = window.matchMedia("(max-width: 720px)");
  const TILE_SIZE = 32;
  const HORIZONTAL_FREQUENCY = 0.1067;
  const VERTICAL_FREQUENCY = 0.0433;
  const BASE_SPEED = 0.04;
  const MAX_BOOST = 2.25;
  const PALETTE_STEPS = 64;

  let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let cols = 0;
  let rows = 0;
  let phase = 0;
  let boost = 0;
  let scrollProgress = 0;
  let lastScroll = window.scrollY;
  let raf = 0;
  let staticRaf = 0;
  let resizeRaf = 0;
  let running = false;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let cellPhases = new Float32Array();
  let cellJitters = new Float32Array();
  const palette = new Array<string>(PALETTE_STEPS);

  let paper: RGB = [231, 235, 239];
  let paper3: RGB = [202, 210, 218];
  let accent: RGB = [38, 95, 126];

  function readColors(): void {
    const cs = getComputedStyle(document.documentElement);
    paper = parseHex(cs.getPropertyValue("--paper")) ?? paper;
    paper3 = parseHex(cs.getPropertyValue("--paper-3")) ?? paper3;
    accent = parseHex(cs.getPropertyValue("--accent")) ?? accent;
  }

  function paletteChannel(
    colorIndex: 0 | 1 | 2,
    darkChannel: number,
    paperMix: number,
    accentMix: number,
    darkMix: number
  ): number {
    const paperChannel = paper[colorIndex] + (paper3[colorIndex] - paper[colorIndex]) * paperMix;
    const accentChannel = paperChannel + (accent[colorIndex] - paperChannel) * accentMix;
    return (accentChannel + (darkChannel - accentChannel) * darkMix) | 0;
  }

  function updatePalette(): void {
    const darkMix = scrollProgress * (currentTheme === "dark" ? 0.32 : 0.22);
    for (let index = 0; index < PALETTE_STEPS; index++) {
      const m = index / (PALETTE_STEPS - 1);
      const paperMix = m * 0.55 + scrollProgress * 0.32;
      const accentMix = m * 0.08 + scrollProgress * 0.12;
      const red = paletteChannel(0, 7, paperMix, accentMix, darkMix);
      const green = paletteChannel(1, 8, paperMix, accentMix, darkMix);
      const blue = paletteChannel(2, 6, paperMix, accentMix, darkMix);
      palette[index] = `rgb(${red},${green},${blue})`;
    }
  }

  function syncScrollProgress(force = false): void {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const nextProgress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
    if (!force && nextProgress === scrollProgress) return;
    scrollProgress = nextProgress;
    updatePalette();
  }

  function resize(): boolean {
    const nextDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const bounds = canvas.getBoundingClientRect();
    const w = Math.ceil(bounds.width);
    const h = Math.ceil(bounds.height);
    if (w === canvasWidth && h === canvasHeight && nextDpr === dpr) {
      return false;
    }
    dpr = nextDpr;
    canvasWidth = w;
    canvasHeight = h;
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    cols = Math.ceil(w / TILE_SIZE) + 1;
    rows = Math.ceil(h / TILE_SIZE) + 1;
    const cellCount = cols * rows;
    cellPhases = new Float32Array(cellCount);
    cellJitters = new Float32Array(cellCount);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < cols; column++) {
        const index = row * cols + column;
        cellPhases[index] = column * HORIZONTAL_FREQUENCY + row * VERTICAL_FREQUENCY;
        const noise = Math.sin(column * 12.9898 + row * 78.233) * 43758.5453;
        cellJitters[index] = (noise - Math.floor(noise)) * 0.14 - 0.07;
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function draw(): void {
    const phaseOffset = phase * HORIZONTAL_FREQUENCY;
    let activeColor = -1;
    for (let r = 0; r < rows; r++) {
      const y = r * TILE_SIZE;
      for (let c = 0; c < cols; c++) {
        const index = r * cols + c;
        const wave = 0.5 + 0.5 * Math.sin(cellPhases[index] - phaseOffset);
        const intensity = wave + cellJitters[index];
        const boundedIntensity = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
        const color = Math.round(boundedIntensity * (PALETTE_STEPS - 1));
        if (color !== activeColor) {
          ctx.fillStyle = palette[color];
          activeColor = color;
        }
        ctx.fillRect(c * TILE_SIZE, y, TILE_SIZE, TILE_SIZE);
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
    if (running || !shouldAnimate()) return;
    running = true;
    raf = requestAnimationFrame(loop);
  }

  function stop(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function shouldAnimate(): boolean {
    return !prefersReducedMotion() && !reducedDataQuery.matches && !compactQuery.matches;
  }

  function syncAnimation(redrawStatic = true): void {
    if (document.hidden) {
      stop();
      return;
    }
    if (shouldAnimate()) {
      start();
      return;
    }
    stop();
    if (redrawStatic) draw();
  }

  function onScroll(): void {
    const dy = window.scrollY - lastScroll;
    lastScroll = window.scrollY;
    boost += Math.abs(dy) * 0.00625;
    if (boost > MAX_BOOST) boost = MAX_BOOST;
    syncScrollProgress();
    if (!shouldAnimate() && !staticRaf) {
      staticRaf = requestAnimationFrame(() => {
        staticRaf = 0;
        draw();
      });
    }
  }

  resize();
  readColors();
  syncScrollProgress(true);
  draw();

  function scheduleResize(): void {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      if (!resize()) return;
      syncScrollProgress();
      draw();
      syncAnimation(false);
    });
  }

  window.addEventListener("resize", scheduleResize, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleResize, { passive: true });

  window.addEventListener("scroll", onScroll, { passive: true });

  document.addEventListener("visibilitychange", () => syncAnimation(false));
  motionQuery.addEventListener("change", () => syncAnimation());
  reducedDataQuery.addEventListener("change", () => syncAnimation());
  compactQuery.addEventListener("change", () => syncAnimation());
  syncAnimation(false);

  const themeObserver = new MutationObserver(() => {
    readColors();
    updatePalette();
    if (!running) draw();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

function init(): void {
  initTheme();
  initScrollTone();
  initCopyButtons();
  initWaves();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
