import { marked } from "marked";

type Language = "en" | "ja" | "ko";
type Theme = "light" | "dark";

interface Translations {
  [key: string]: {
    en: string;
    ja: string;
    ko: string;
  };
}

const translations: Translations = {
  "nav.github": { en: "GitHub", ja: "GitHub", ko: "GitHub" },
  "nav.npm": { en: "npm", ja: "npm", ko: "npm" },
  "docs.title": { en: "Documentation", ja: "ドキュメント", ko: "문서" },
  "search.placeholder": {
    en: "Search docs...",
    ja: "ドキュメントを検索...",
    ko: "문서 검색...",
  },
  "search.empty": {
    en: "No results",
    ja: "結果はありません",
    ko: "검색 결과가 없습니다",
  },
  "sidebar.gettingstarted": {
    en: "Getting started",
    ja: "はじめに",
    ko: "시작하기",
  },
  "sidebar.intro": { en: "Introduction", ja: "導入", ko: "소개" },
  "sidebar.guide": { en: "Guide", ja: "ガイド", ko: "가이드" },
  "sidebar.pageformat": {
    en: "Page format",
    ja: "ページ形式",
    ko: "페이지 형식",
  },
  "sidebar.tokenbudget": {
    en: "Token budget",
    ja: "トークン予算",
    ko: "토큰 예산",
  },
  "sidebar.multitab": {
    en: "Multi-tab",
    ja: "マルチタブ",
    ko: "멀티탭",
  },
  "sidebar.errors": {
    en: "Error handling",
    ja: "エラー処理",
    ko: "오류 처리",
  },
  "sidebar.troubleshoot": {
    en: "Troubleshooting",
    ja: "トラブルシューティング",
    ko: "문제 해결",
  },
  "sidebar.reference": {
    en: "Reference",
    ja: "リファレンス",
    ko: "참조",
  },
  "sidebar.api": {
    en: "API reference",
    ja: "APIリファレンス",
    ko: "API 참조",
  },
  "sidebar.bench": {
    en: "Benchmarks",
    ja: "ベンチマーク",
    ko: "벤치마크",
  },
  "sidebar.arch": {
    en: "Architecture",
    ja: "アーキテクチャ",
    ko: "아키텍처",
  },
  "sidebar.changelog": {
    en: "Changelog",
    ja: "変更履歴",
    ko: "변경 이력",
  },
  "sidebar.feedback": {
    en: "Feedback",
    ja: "フィードバック",
    ko: "피드백",
  },
  "toc.heading": {
    en: "On this page",
    ja: "このページの内容",
    ko: "이 페이지",
  },
  "error.missing.title": {
    en: "Page not found",
    ja: "ページが見つかりません",
    ko: "페이지를 찾을 수 없습니다",
  },
  "error.missing.link": {
    en: "Go to Introduction",
    ja: "導入へ移動",
    ko: "소개로 이동",
  },
};

interface SearchEntry {
  name: string;
  title: string;
  snippet: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_PAGE = "getting-started";
const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const DROP_CONTENT_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "link",
  "meta",
]);
const ALLOWED_TAGS = new Set([
  "a",
  "article",
  "aside",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);
const GLOBAL_ALLOWED_ATTRS = new Set([
  "alt",
  "aria-hidden",
  "aria-label",
  "colspan",
  "rowspan",
  "scope",
  "title",
]);
const TAG_ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel", "title"]),
  img: new Set(["src", "alt", "title"]),
};

let currentLang: Language = "en";
let currentTheme: Theme = "dark";
let pages: Record<string, string> = {};
let pageMap: Record<string, string> = {};
let tocObserver: IntersectionObserver | null = null;

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const contentEl = document.getElementById("content")!;

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
    // Ignore storage failures.
  }
}

function translate(key: string): string {
  return translations[key]?.[currentLang] ?? translations[key]?.en ?? key;
}

async function loadContent(): Promise<void> {
  const modules = import.meta.glob("../content/*.md", {
    eager: true,
    query: "?raw",
    import: "default",
  });

  pages = modules as Record<string, string>;
  pageMap = {};

  for (const [path, content] of Object.entries(pages)) {
    const name = path.split("/").pop()?.replace(".md", "") ?? "";
    pageMap[name] = content as string;
  }
}

function createSvgElement(tag: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

function createCopyIcon(): SVGElement {
  const svg = createSvgElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
  });

  svg.appendChild(
    createSvgElement("rect", {
      x: "9",
      y: "9",
      width: "13",
      height: "13",
      rx: "2",
      ry: "2",
    })
  );
  svg.appendChild(
    createSvgElement("path", {
      d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
    })
  );

  return svg;
}

function isSafeUrl(rawValue: string): boolean {
  if (!rawValue) {
    return false;
  }

  try {
    const url = new URL(rawValue, window.location.origin);
    return SAFE_URL_PROTOCOLS.has(url.protocol);
  } catch {
    return rawValue.startsWith("#");
  }
}

function isAllowedAttribute(tag: string, attributeName: string): boolean {
  return (
    GLOBAL_ALLOWED_ATTRS.has(attributeName) ||
    TAG_ALLOWED_ATTRS[tag]?.has(attributeName) === true
  );
}

function sanitizeHtmlFragment(html: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    const tag = element.tagName.toLowerCase();

    if (DROP_CONTENT_TAGS.has(tag)) {
      element.remove();
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (name.startsWith("on") || name === "style") {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (!isAllowedAttribute(tag, name)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if ((name === "href" || name === "src") && !isSafeUrl(value)) {
        element.removeAttribute(attribute.name);
      }
    }

    if (tag === "a") {
      const target = element.getAttribute("target");
      if (target === "_blank") {
        element.setAttribute("rel", "noopener noreferrer");
      }
    }
  }

  const fragment = document.createDocumentFragment();
  for (const child of Array.from(doc.body.childNodes)) {
    fragment.appendChild(document.importNode(child, true));
  }

  return fragment;
}

function addCodeCopyButtons(): void {
  contentEl.querySelectorAll("pre").forEach((pre) => {
    const wrapper = document.createElement("div");
    wrapper.className = "code-wrapper";
    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-code-btn";
    copyBtn.type = "button";
    copyBtn.setAttribute("aria-label", "Copy code");
    copyBtn.appendChild(createCopyIcon());
    copyBtn.addEventListener("click", async () => {
      const code = pre.querySelector("code")?.textContent || "";
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.classList.add("copied");
        window.setTimeout(() => copyBtn.classList.remove("copied"), 1500);
      } catch (err) {
        console.error("Failed to copy:", err);
      }
    });
    wrapper.appendChild(copyBtn);
  });
}

function renderMissingPage(): void {
  const wrapper = document.createElement("div");
  wrapper.className = "error-page";

  const title = document.createElement("h1");
  title.textContent = "404";

  const description = document.createElement("p");
  description.textContent = translate("error.missing.title");

  const link = document.createElement("a");
  link.href = `#${DEFAULT_PAGE}`;
  link.textContent = translate("error.missing.link");

  wrapper.append(title, description, link);
  contentEl.replaceChildren(wrapper);
}

function renderPage(pageName: string): void {
  const md = pageMap[pageName];
  if (!md) {
    renderMissingPage();
    return;
  }

  const html = marked.parse(md, { async: false }) as string;
  const fragment = sanitizeHtmlFragment(html);
  contentEl.replaceChildren(fragment);

  addCodeCopyButtons();

  document.querySelectorAll(".sidebar-link").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("data-page") === pageName);
  });

  const title = contentEl.querySelector("h1")?.textContent;
  if (title) {
    document.title = `${title} — TideSurf Docs`;
  }

  buildTOC();
}

function navigate(): void {
  const hash = decodeURIComponent(window.location.hash.slice(1) || DEFAULT_PAGE);
  renderPage(hash);
  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
  closeMobileMenu();
}

function buildTOC(): void {
  const tocNav = document.getElementById("toc-nav");
  if (!tocNav) {
    return;
  }

  tocObserver?.disconnect();
  tocObserver = null;
  tocNav.replaceChildren();

  const headings = Array.from(contentEl.querySelectorAll("h2, h3"));
  if (headings.length === 0) {
    return;
  }

  const fragment = document.createDocumentFragment();

  headings.forEach((heading, index) => {
    const id = `heading-${index}`;
    heading.id = id;

    const link = document.createElement("a");
    link.href = `#${id}`;
    link.className = heading.tagName === "H3" ? "toc-link toc-h3" : "toc-link";
    link.dataset.target = id;
    link.textContent = heading.textContent ?? "";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.getElementById(id)?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
    });

    fragment.appendChild(link);
  });

  tocNav.appendChild(fragment);

  tocObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }

        tocNav.querySelectorAll(".toc-link").forEach((link) => {
          link.classList.remove("active");
        });

        const active = tocNav.querySelector(
          `[data-target="${entry.target.id}"]`
        );
        active?.classList.add("active");
      }
    },
    { rootMargin: "-80px 0px -70% 0px" }
  );

  headings.forEach((heading) => tocObserver?.observe(heading));
}

function setSearchResultsVisible(resultsEl: HTMLElement, visible: boolean): void {
  resultsEl.hidden = !visible;
}

function clearSidebarFilters(): void {
  document.querySelectorAll(".sidebar-section").forEach((section) => {
    (section as HTMLElement).style.display = "";
  });
}

function renderSearchResults(resultsEl: HTMLElement, results: SearchEntry[]): void {
  resultsEl.replaceChildren();

  if (results.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "search-empty";
    emptyState.textContent = translate("search.empty");
    resultsEl.appendChild(emptyState);
    setSearchResultsVisible(resultsEl, true);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const result of results) {
    const link = document.createElement("a");
    link.href = `#${result.name}`;
    link.className = "search-result";

    const title = document.createElement("span");
    title.className = "search-result-title";
    title.textContent = result.title;

    const snippet = document.createElement("span");
    snippet.className = "search-result-snippet";
    snippet.textContent = result.snippet;

    link.append(title, snippet);
    fragment.appendChild(link);
  }

  resultsEl.appendChild(fragment);
  setSearchResultsVisible(resultsEl, true);
}

function initSearch(): void {
  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  const resultsEl = document.getElementById("search-results") as HTMLElement | null;
  if (!searchInput || !resultsEl) {
    return;
  }

  searchInput.addEventListener("input", (event) => {
    const query = (event.target as HTMLInputElement).value.toLowerCase().trim();
    if (!query) {
      resultsEl.replaceChildren();
      setSearchResultsVisible(resultsEl, false);
      clearSidebarFilters();
      return;
    }

    const results: SearchEntry[] = [];
    for (const [name, content] of Object.entries(pageMap)) {
      const lower = content.toLowerCase();
      const index = lower.indexOf(query);
      if (index === -1) {
        continue;
      }

      const titleMatch = content.match(/^#\s+(.+)/m);
      const title = titleMatch ? titleMatch[1] : name;
      const start = Math.max(0, index - 40);
      const end = Math.min(content.length, index + query.length + 60);
      let snippet = content
        .slice(start, end)
        .replace(/<[^>]+>/g, " ")
        .replace(/[#*`_>\n]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (start > 0) {
        snippet = `...${snippet}`;
      }
      if (end < content.length) {
        snippet = `${snippet}...`;
      }

      results.push({ name, title, snippet });
    }

    renderSearchResults(resultsEl, results);

    document.querySelectorAll(".sidebar-section").forEach((section) => {
      const links = section.querySelectorAll(".sidebar-link");
      let hasMatch = false;

      links.forEach((link) => {
        const pageName = link.getAttribute("data-page") || "";
        const text = link.textContent?.toLowerCase() || "";
        if (
          text.includes(query) ||
          (pageMap[pageName] && pageMap[pageName].toLowerCase().includes(query))
        ) {
          hasMatch = true;
        }
      });

      (section as HTMLElement).style.display = hasMatch ? "" : "none";
    });
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    searchInput.value = "";
    resultsEl.replaceChildren();
    setSearchResultsVisible(resultsEl, false);
    clearSidebarFilters();
  });

  resultsEl.addEventListener("click", () => {
    searchInput.value = "";
    resultsEl.replaceChildren();
    setSearchResultsVisible(resultsEl, false);
    clearSidebarFilters();
  });
}

function initTheme(): void {
  const savedTheme = safeStorageGet("tidesurf-docs-theme") as Theme | null;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  currentTheme = savedTheme || (prefersDark ? "dark" : "light");
  applyTheme();

  document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
}

function toggleTheme(): void {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  safeStorageSet("tidesurf-docs-theme", currentTheme);
  applyTheme();
}

function applyTheme(): void {
  document.documentElement.setAttribute("data-theme", currentTheme);
}

function initLanguage(): void {
  const savedLang = safeStorageGet("tidesurf-docs-lang") as Language | null;
  currentLang = savedLang || detectLanguage();

  applyLanguage();

  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      const lang = (event.currentTarget as HTMLElement).dataset.lang as Language;
      if (!lang || lang === currentLang) {
        return;
      }

      currentLang = lang;
      safeStorageSet("tidesurf-docs-lang", lang);
      applyLanguage();
      updateLangButtons();
    });
  });
}

function detectLanguage(): Language {
  const browserLang = navigator.language.toLowerCase();
  if (browserLang.startsWith("ja")) {
    return "ja";
  }
  if (browserLang.startsWith("ko")) {
    return "ko";
  }
  return "en";
}

function applyLanguage(): void {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    if (key && translations[key]) {
      element.textContent = translate(key);
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const key = element.getAttribute("data-i18n-placeholder");
    if (key && translations[key]) {
      (element as HTMLInputElement).placeholder = translate(key);
    }
  });

  document.documentElement.lang = currentLang;
}

function updateLangButtons(): void {
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-lang") === currentLang);
  });
}

function initMobileMenu(): void {
  const toggle = document.getElementById("mobile-menu-toggle");
  const overlay = document.getElementById("mobile-overlay");

  toggle?.addEventListener("click", () => {
    document.body.classList.toggle("mobile-menu-open");
  });
  overlay?.addEventListener("click", closeMobileMenu);
}

function closeMobileMenu(): void {
  document.body.classList.remove("mobile-menu-open");
}

async function initGitHubStars(): Promise<void> {
  const el = document.getElementById("star-count");
  if (!el) {
    return;
  }

  try {
    const response = await fetch("https://api.github.com/repos/TideSurf/core", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as { stargazers_count?: number };
    if (data.stargazers_count == null) {
      return;
    }

    el.textContent =
      data.stargazers_count >= 1000
        ? `${(data.stargazers_count / 1000).toFixed(1)}k`
        : String(data.stargazers_count);
  } catch {
    // Ignore network failures for the decorative star counter.
  }
}

async function init(): Promise<void> {
  await loadContent();

  initTheme();
  initLanguage();
  initSearch();
  initMobileMenu();
  await initGitHubStars();

  window.addEventListener("hashchange", navigate);
  navigate();
  updateLangButtons();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void init();
  });
} else {
  void init();
}
