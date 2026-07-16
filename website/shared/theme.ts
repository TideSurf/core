type Theme = "light" | "dark";

const STORAGE_KEY = "tidesurf-theme";

export const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

export function prefersReducedMotion(): boolean {
  return reducedMotionQuery.matches;
}

export function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or hardened browser contexts.
  }
}

function isTheme(value: string | null | undefined): value is Theme {
  return value === "light" || value === "dark";
}

// Root dataset is the single theme source: page CSS and scroll-tone read data-theme.
function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll<HTMLButtonElement>(".theme-btn[data-theme]").forEach((button) => {
    const active = button.dataset.theme === theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

export function initTheme(): void {
  const saved = safeStorageGet(STORAGE_KEY);
  applyTheme(
    isTheme(saved)
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
  );

  document.querySelectorAll<HTMLButtonElement>(".theme-btn[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      const theme = button.dataset.theme;
      if (!isTheme(theme)) return;
      safeStorageSet(STORAGE_KEY, theme);
      applyTheme(theme);
    });
  });
}
