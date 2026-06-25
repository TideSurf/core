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
  if (!notice || !dismiss) return;

  if (safeStorageGet("tidesurf-cookie-dismissed") === "true") {
    notice.hidden = true;
    return;
  }

  notice.hidden = false;
  dismiss.addEventListener("click", () => {
    safeStorageSet("tidesurf-cookie-dismissed", "true");
    notice.hidden = true;
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

async function init(): Promise<void> {
  initTheme();
  initCopyButtons();
  initCookieNotice();
  initReveal();
  await initGitHubStars();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}
