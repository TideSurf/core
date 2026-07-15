import { marked } from "marked";
import "./style.css";
import { initScrollTone } from "../../shared/scroll-tone";

type Language = "en" | "ja" | "ko";
type Theme = "light" | "dark";

interface SearchEntry {
  name: string;
  title: string;
  snippet: string;
}

interface TranslationSet {
  en: string;
  ja: string;
  ko: string;
}

const translations: Record<string, TranslationSet> = {
  "search.placeholder": { en: "Search docs", ja: "ドキュメントを検索", ko: "문서 검색" },
  "search.empty": { en: "Nothing found", ja: "結果はありません", ko: "검색 결과가 없습니다" },
  "sidebar.gettingstarted": { en: "Getting started", ja: "はじめに", ko: "시작하기" },
  "sidebar.intro": { en: "Introduction", ja: "導入", ko: "소개" },
  "sidebar.cli": { en: "CLI", ja: "CLI", ko: "CLI" },
  "sidebar.guide": { en: "Guide", ja: "ガイド", ko: "가이드" },
  "sidebar.pageformat": { en: "Page format", ja: "ページ形式", ko: "페이지 형식" },
  "sidebar.tokenbudget": { en: "Token budget", ja: "トークン予算", ko: "토큰 예산" },
  "sidebar.multitab": { en: "Multi-tab", ja: "マルチタブ", ko: "멀티탭" },
  "sidebar.errors": { en: "Error handling", ja: "エラー処理", ko: "오류 처리" },
  "sidebar.troubleshoot": { en: "Troubleshooting", ja: "トラブルシューティング", ko: "문제 해결" },
  "sidebar.security": { en: "Security", ja: "セキュリティ", ko: "보안" },
  "sidebar.agentpatterns": { en: "Agent patterns", ja: "エージェントパターン", ko: "에이전트 패턴" },
  "sidebar.reference": { en: "Reference", ja: "リファレンス", ko: "참조" },
  "sidebar.api": { en: "API reference", ja: "APIリファレンス", ko: "API 참조" },
  "sidebar.bench": { en: "Benchmarks", ja: "ベンチマーク", ko: "벤치마크" },
  "sidebar.arch": { en: "Architecture", ja: "アーキテクチャ", ko: "아키텍처" },
  "sidebar.migration": { en: "Migration", ja: "移行", ko: "마이그레이션" },
  "sidebar.changelog": { en: "Changelog", ja: "変更履歴", ko: "변경 이력" },
  "sidebar.feedback": { en: "Feedback", ja: "フィードバック", ko: "피드백" },
  "toc.heading": { en: "On this page", ja: "このページ", ko: "이 페이지" },
  "content.loading": { en: "Loading docs…", ja: "読み込み中…", ko: "불러오는 중…" },
  "error.missing.title": { en: "Page not found", ja: "ページが見つかりません", ko: "페이지를 찾을 수 없습니다" },
  "error.missing.link": { en: "Go to Introduction", ja: "導入へ", ko: "소개로" },
};

const DEFAULT_PAGE = "getting-started";
const MOBILE_QUERY = "(max-width: 860px)";
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

const contentEl = document.getElementById("content") as HTMLElement;
const mobileMedia = window.matchMedia(MOBILE_QUERY);

let currentLang: Language = "en";
let currentTheme: Theme = "light";
let currentPageName = DEFAULT_PAGE;
let pageMap: Record<string, string> = {};
let tocScrollFrame = 0;
let initialNavigation = true;
let removeTocTracking: (() => void) | null = null;

const translatedReadmes: Record<Exclude<Language, "en">, { label: string; text: string; url: string }> = {
  ja: {
    label: "日本語README",
    text: "本文は英語です。日本語の概要はREADMEで確認できます。",
    url: "https://github.com/TideSurf/core/blob/main/README.ja.md",
  },
  ko: {
    label: "한국어 README",
    text: "본문은 영어로 제공됩니다. 한국어 개요는 README에서 확인할 수 있습니다.",
    url: "https://github.com/TideSurf/core/blob/main/README.ko.md",
  },
};

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    // Storage can be unavailable in hardened browser contexts.
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

  pageMap = {};
  Object.entries(modules).forEach(([path, content]) => {
    const name = path.split("/").pop()?.replace(".md", "") ?? "";
    pageMap[name] = String(content);
  });
}

function isSafeUrl(rawValue: string): boolean {
  try {
    const url = new URL(rawValue, window.location.origin);
    return SAFE_URL_PROTOCOLS.has(url.protocol);
  } catch {
    return rawValue.startsWith("#");
  }
}

function sanitizeHtmlFragment(html: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(html, "text/html");

  Array.from(doc.body.querySelectorAll("*")).forEach((element) => {
    const tag = element.tagName.toLowerCase();

    if (DROP_CONTENT_TAGS.has(tag)) {
      element.remove();
      return;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }

    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const globallyAllowed = GLOBAL_ALLOWED_ATTRS.has(name);
      const tagAllowed = TAG_ALLOWED_ATTRS[tag]?.has(name) === true;
      const unsafeUrl = (name === "href" || name === "src") && !isSafeUrl(value);

      if (name.startsWith("on") || name === "style" || (!globallyAllowed && !tagAllowed) || unsafeUrl) {
        element.removeAttribute(attribute.name);
      }
    });

    if (tag === "a" && element.getAttribute("target") === "_blank") {
      element.setAttribute("rel", "noopener noreferrer");
    }
  });

  const fragment = document.createDocumentFragment();
  Array.from(doc.body.childNodes).forEach((child) => {
    fragment.appendChild(document.importNode(child, true));
  });
  return fragment;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tokenClass(token: string): string {
  if (token.startsWith("//")) return "tk-cm";
  if (/^["'`]/.test(token)) return "tk-str";
  if (/^\d/.test(token)) return "tk-num";
  if (token.startsWith(".")) return "tk-fn";
  if (/^[A-Z]/.test(token)) return "tk-type";
  return "tk-kw";
}

function highlightCode(): void {
  const tokenPattern = /\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b(?:const|let|var|import|export|from|await|async|return|if|else|new|function|class|extends|implements|interface|type|enum|throw|try|catch|for|of|in|while|do|switch|case|default|break|continue|void|null|undefined|true|false|this|super)\b|\b[A-Z][A-Za-z0-9]*\b|\.[a-zA-Z_]\w*(?=\s*\()/gm;

  contentEl.querySelectorAll("pre code").forEach((block) => {
    const source = block.textContent ?? "";
    let html = "";
    let cursor = 0;

    source.replace(tokenPattern, (token, offset: number) => {
      html += escapeHtml(source.slice(cursor, offset));
      if (token.startsWith(".")) {
        html += `.<span class="${tokenClass(token)}">${escapeHtml(token.slice(1))}</span>`;
      } else {
        html += `<span class="${tokenClass(token)}">${escapeHtml(token)}</span>`;
      }
      cursor = offset + token.length;
      return token;
    });

    block.innerHTML = html + escapeHtml(source.slice(cursor));
  });
}

function prepareCodeBlocks(): void {
  contentEl.querySelectorAll("pre").forEach((pre) => {
    const wrapper = document.createElement("div");
    wrapper.className = "code-wrapper";
    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const copyButton = document.createElement("button");
    copyButton.className = "copy-code-btn";
    copyButton.type = "button";
    copyButton.setAttribute("aria-label", "Copy code");
    copyButton.setAttribute("title", "Copy code");
    copyButton.innerHTML = `
      <svg class="icon-copy" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="5.5" y="5.5" width="8" height="8" rx="1.5"></rect>
        <path d="M3.5 10.5H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v.5"></path>
      </svg>
      <svg class="icon-check" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-6.5"></path>
      </svg>`;
    copyButton.addEventListener("click", async () => {
      const code = pre.querySelector("code")?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(code);
        copyButton.classList.add("is-copied");
        copyButton.setAttribute("aria-label", "Code copied");
        copyButton.setAttribute("title", "Copied");
        window.setTimeout(() => {
          copyButton.classList.remove("is-copied");
          copyButton.setAttribute("aria-label", "Copy code");
          copyButton.setAttribute("title", "Copy code");
        }, 1500);
      } catch {
        copyButton.setAttribute("aria-label", "Copy failed");
        copyButton.setAttribute("title", "Copy failed");
      }
    });
    wrapper.appendChild(copyButton);
  });
}

function wrapTables(): void {
  contentEl.querySelectorAll("table").forEach((table) => {
    const wrapper = document.createElement("div");
    wrapper.className = "table-wrapper";
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

function ensureHeadingIds(headings: HTMLElement[]): void {
  const used = new Set<string>();
  headings.forEach((heading, index) => {
    const base = heading.id || slugify(heading.textContent ?? "") || `section-${index + 1}`;
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    heading.id = id;
    used.add(id);
  });
}

function makeTocLink(heading: HTMLElement): HTMLAnchorElement {
  const link = document.createElement("a");
  const level = heading.tagName.toLowerCase();
  link.href = `#${currentPageName}:${heading.id}`;
  link.className = `toc-link toc-${level}`;
  link.dataset.target = heading.id;
  link.textContent = heading.textContent ?? "";
  return link;
}

function startTocTracking(headings: HTMLElement[]): void {
  removeTocTracking?.();

  const update = (): void => {
    tocScrollFrame = 0;
    let activeId = headings[0]?.id ?? "";
    headings.forEach((heading) => {
      if (heading.getBoundingClientRect().top <= 112) activeId = heading.id;
    });

    document.querySelectorAll<HTMLElement>(".toc-link[data-target]").forEach((link) => {
      const active = link.dataset.target === activeId;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };

  const schedule = (): void => {
    if (tocScrollFrame) return;
    tocScrollFrame = window.requestAnimationFrame(update);
  };

  window.addEventListener("scroll", schedule, { passive: true });
  update();
  removeTocTracking = () => {
    window.removeEventListener("scroll", schedule);
    if (tocScrollFrame) window.cancelAnimationFrame(tocScrollFrame);
    tocScrollFrame = 0;
  };
}

function buildTOC(): void {
  const desktopNav = document.getElementById("toc-nav");
  const mobileNav = document.getElementById("mobile-toc-nav");
  if (!desktopNav || !mobileNav) return;

  desktopNav.replaceChildren();
  mobileNav.replaceChildren();

  const headings = Array.from(contentEl.querySelectorAll<HTMLElement>("h2, h3"));
  ensureHeadingIds(headings);
  headings.forEach((heading) => {
    desktopNav.appendChild(makeTocLink(heading));
    mobileNav.appendChild(makeTocLink(heading));
  });
  startTocTracking(headings);
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
  contentEl.setAttribute("aria-busy", "false");
}

function renderPage(pageName: string): void {
  const markdown = pageMap[pageName];
  if (!markdown) {
    renderMissingPage();
    return;
  }

  currentPageName = pageName;
  const html = marked.parse(markdown, { async: false }) as string;
  contentEl.replaceChildren(sanitizeHtmlFragment(html));
  contentEl.setAttribute("aria-busy", "false");
  contentEl.lang = "en";
  renderLanguageNotice();
  wrapTables();
  prepareCodeBlocks();
  highlightCode();
  buildTOC();

  document.querySelectorAll<HTMLElement>(".sidebar-link[data-page]").forEach((link) => {
    const active = link.dataset.page === pageName;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  const title = contentEl.querySelector("h1")?.textContent;
  document.title = title ? `${title} | TideSurf Docs` : "TideSurf Docs";
}

function renderLanguageNotice(): void {
  contentEl.querySelector(".language-notice")?.remove();
  if (currentLang === "en") return;
  const copy = translatedReadmes[currentLang];
  const heading = contentEl.querySelector("h1");
  if (!copy || !heading) return;

  const notice = document.createElement("aside");
  notice.className = "language-notice";
  notice.lang = currentLang;
  const text = document.createElement("span");
  text.textContent = `${copy.text} `;
  const link = document.createElement("a");
  link.href = copy.url;
  link.textContent = copy.label;
  notice.append(text, link);
  heading.insertAdjacentElement("afterend", notice);
}

function parseLocation(): { page: string; heading: string | null } {
  const hash = decodeURIComponent(window.location.hash.slice(1) || DEFAULT_PAGE);
  const separator = hash.indexOf(":");
  return separator < 0
    ? { page: hash, heading: null }
    : { page: hash.slice(0, separator), heading: hash.slice(separator + 1) };
}

function navigate(): void {
  const { page, heading } = parseLocation();
  renderPage(page);

  window.requestAnimationFrame(() => {
    const behavior: ScrollBehavior = initialNavigation || prefersReducedMotion() ? "auto" : "smooth";
    if (heading) {
      document.getElementById(heading)?.scrollIntoView({ behavior, block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior });
    }
    initialNavigation = false;
  });
}

function setSearchResultsVisible(results: HTMLElement, visible: boolean): void {
  results.hidden = !visible;
}

function renderSearchResults(resultsEl: HTMLElement, entries: SearchEntry[]): void {
  resultsEl.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = translate("search.empty");
    resultsEl.appendChild(empty);
    setSearchResultsVisible(resultsEl, true);
    return;
  }

  const fragment = document.createDocumentFragment();
  entries.slice(0, 8).forEach((entry) => {
    const link = document.createElement("a");
    link.href = `#${entry.name}`;
    link.className = "search-result";
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const snippet = document.createElement("span");
    snippet.textContent = entry.snippet;
    link.append(title, snippet);
    fragment.appendChild(link);
  });
  resultsEl.appendChild(fragment);
  setSearchResultsVisible(resultsEl, true);
}

function initSearch(): void {
  const input = document.getElementById("search-input") as HTMLInputElement | null;
  const results = document.getElementById("search-results");
  if (!input || !results) return;

  const closeResults = (): void => {
    results.replaceChildren();
    setSearchResultsVisible(results, false);
  };

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    if (!query) {
      closeResults();
      return;
    }

    const matches: SearchEntry[] = [];
    Object.entries(pageMap).forEach(([name, markdown]) => {
      const lower = markdown.toLowerCase();
      const index = lower.indexOf(query);
      if (index < 0) return;

      const title = markdown.match(/^#\s+(.+)/m)?.[1] ?? name;
      const start = Math.max(0, index - 42);
      const end = Math.min(markdown.length, index + query.length + 72);
      const body = markdown
        .slice(start, end)
        .replace(/<[^>]+>/g, " ")
        .replace(/[#*`_>\n]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const snippet = `${start > 0 ? "…" : ""}${body}${end < markdown.length ? "…" : ""}`;
      matches.push({ name, title, snippet });
    });
    renderSearchResults(results, matches);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    input.value = "";
    closeResults();
  });

  results.addEventListener("click", () => {
    input.value = "";
    closeResults();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!(event.target instanceof Node) || input.contains(event.target) || results.contains(event.target)) return;
    closeResults();
  });
}

function applyTheme(): void {
  document.documentElement.dataset.theme = currentTheme;
  document.querySelectorAll<HTMLButtonElement>(".theme-btn[data-theme]").forEach((button) => {
    const active = button.dataset.theme === currentTheme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function initTheme(): void {
  const saved = safeStorageGet("tidesurf-theme") as Theme | null;
  currentTheme = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
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

function initCookieNotice(): void {
  const notice = document.getElementById("cookie-notice");
  const dismiss = document.getElementById("cookie-dismiss");
  if (!notice || !dismiss) return;

  if (safeStorageGet("tidesurf-cookie-dismissed") === "true") {
    notice.hidden = true;
    document.body.classList.remove("cookie-visible");
    return;
  }

  notice.hidden = false;
  document.body.classList.add("cookie-visible");
  dismiss.addEventListener("click", () => {
    safeStorageSet("tidesurf-cookie-dismissed", "true");
    notice.hidden = true;
    document.body.classList.remove("cookie-visible");
  });
}

function applyLanguage(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (key) element.textContent = translate(key);
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((element) => {
    const key = element.dataset.i18nPlaceholder;
    if (key) element.placeholder = translate(key);
  });
  document.documentElement.lang = currentLang;
  contentEl.lang = "en";
  document.querySelectorAll<HTMLButtonElement>(".lang-btn[data-lang]").forEach((button) => {
    const active = button.dataset.lang === currentLang;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderLanguageNotice();
}

function initLanguage(): void {
  currentLang = (safeStorageGet("tidesurf-docs-lang") as Language | null) ?? "en";
  applyLanguage();
  document.querySelectorAll<HTMLButtonElement>(".lang-btn[data-lang]").forEach((button) => {
    button.addEventListener("click", () => {
      const language = button.dataset.lang as Language | undefined;
      if (!language) return;
      currentLang = language;
      safeStorageSet("tidesurf-docs-lang", currentLang);
      applyLanguage();
    });
  });
}

function initMobileNavigation(): void {
  const sidebar = document.getElementById("sidebar") as HTMLElement | null;
  const toggle = document.getElementById("mobile-menu-toggle") as HTMLButtonElement | null;
  const close = document.getElementById("docs-index-close") as HTMLButtonElement | null;
  const scrim = document.getElementById("drawer-scrim");
  if (!sidebar || !toggle || !close || !scrim) return;

  let open = false;

  const setOpen = (nextOpen: boolean, restoreFocus = true): void => {
    open = mobileMedia.matches && nextOpen;
    sidebar.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("nav-open", open);
    scrim.classList.toggle("visible", open);

    if (mobileMedia.matches) {
      sidebar.setAttribute("aria-hidden", String(!open));
      sidebar.inert = !open;
    } else {
      sidebar.removeAttribute("aria-hidden");
      sidebar.inert = false;
    }

    if (open) close.focus();
    else if (restoreFocus && mobileMedia.matches) toggle.focus();
  };

  const syncBreakpoint = (): void => setOpen(false, false);
  toggle.addEventListener("click", () => setOpen(!open));
  close.addEventListener("click", () => setOpen(false));
  scrim.addEventListener("click", () => setOpen(false));
  sidebar.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false, false));
  });

  sidebar.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab" || !open) return;

    const focusable = Array.from(
      sidebar.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter((element) => !element.hidden);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  mobileMedia.addEventListener("change", syncBreakpoint);
  syncBreakpoint();
}

async function init(): Promise<void> {
  await loadContent();
  initTheme();
  initLanguage();
  initCookieNotice();
  initSearch();
  initMobileNavigation();
  window.addEventListener("hashchange", navigate);
  navigate();
  initScrollTone({ source: window, observe: contentEl });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init(), { once: true });
} else {
  void init();
}
