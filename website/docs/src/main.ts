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
  "sidebar.security": {
    en: "Security",
    ja: "セキュリティ",
    ko: "보안",
  },
  "sidebar.agentpatterns": {
    en: "Agent patterns",
    ja: "エージェントパターン",
    ko: "에이전트 패턴",
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
  "content.share.title": {
    en: "Share",
    ja: "共有",
    ko: "공유",
  },
  "content.share.copy": {
    en: "Copy link",
    ja: "リンクをコピー",
    ko: "링크 복사",
  },
  "content.share.copied": {
    en: "Copied!",
    ja: "コピーしました",
    ko: "복사됨",
  },
  "content.share.llms": {
    en: "Open llms.txt",
    ja: "llms.txtを開く",
    ko: "llms.txt 열기",
  },
  "content.copy.md": {
    en: "Copy Markdown",
    ja: "マークダウンをコピー",
    ko: "마크다운 복사",
  },
  "content.copy.text": {
    en: "Copy Text",
    ja: "テキストをコピー",
    ko: "텍스트 복사",
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
let currentPageName: string = DEFAULT_PAGE;
let pages: Record<string, string> = {};
let pageMap: Record<string, string> = {};
let tocObserver: IntersectionObserver | null = null;
let tocScrollHandler: (() => void) | null = null;
let docMetaCleanup: (() => void) | null = null;

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

function addCodeHeaders(): void {
  contentEl.querySelectorAll("pre").forEach((pre) => {
    // Skip if already wrapped or has header
    if (pre.parentElement?.classList.contains("code-wrapper")) {
      return;
    }
    
    const wrapper = document.createElement("div");
    wrapper.className = "code-wrapper";
    
    // Create header with dots
    const header = document.createElement("div");
    header.className = "code-header";
    header.innerHTML = `
      <span class="dot dot-red"></span>
      <span class="dot dot-yellow"></span>
      <span class="dot dot-green"></span>
    `;
    
    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
}

function addCodeCopyButtons(): void {
  contentEl.querySelectorAll(".code-wrapper").forEach((wrapper) => {
    // Skip if button already exists
    if (wrapper.querySelector(".copy-code-btn")) {
      return;
    }
    
    const pre = wrapper.querySelector("pre");
    if (!pre) return;
    
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

function highlightCode(): void {
  const rules: [RegExp, string][] = [
    [/\/\/.*$/gm, "tk-cm"],
    [/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, "tk-str"],
    [/\b(\d+(?:\.\d+)?)\b/g, "tk-num"],
    [/\b(const|let|var|import|export|from|await|async|return|if|else|new|function|class|extends|implements|interface|type|enum|throw|try|catch|for|of|in|while|do|switch|case|default|break|continue|void|null|undefined|true|false|this|super)\b/g, "tk-kw"],
    [/\b([A-Z][A-Za-z0-9]*)\b/g, "tk-type"],
    [/\.([a-zA-Z_]\w*)\s*\(/g, "tk-fn"],
  ];

  contentEl.querySelectorAll("pre code").forEach((block) => {
    let html = block.innerHTML;
    const saved: string[] = [];
    // Preserve existing HTML tags
    html = html.replace(/<[^>]+>/g, (m) => { saved.push(m); return `\x00${saved.length - 1}\x00`; });
    for (const [re, cls] of rules) {
      html = html.replace(re, (match) => `<span class="${cls}">${match}</span>`);
    }
    // Restore saved tags
    html = html.replace(/\x00(\d+)\x00/g, (_, i) => saved[Number(i)]);
    block.innerHTML = html;
  });
}

function generateLlmsTxt(pageName: string, content: string): string {
  const titleMatch = content.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1] : pageName;
  
  // Extract all headings for structure
  const headings: string[] = [];
  const headingRegex = /^(#{2,4})\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2];
    headings.push(`${"  ".repeat(level - 2)}- ${text}`);
  }
  
  // Clean up markdown for llms.txt format
  const cleanContent = content
    .replace(/```[\s\S]*?```/g, "[code block]")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "[$1]")
    .replace(/>\s+/g, "")
    .replace(/\*{2,}/g, "")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n");
  
  return `# ${title}

URL: https://tidesurf.org/docs#${pageName}

## Overview

${cleanContent.slice(0, 800).trim()}...

## Structure

${headings.length > 0 ? headings.join("\n") : "- Main content"}

## Full Content

${cleanContent.trim()}

---
Generated from TideSurf documentation (https://tidesurf.org/docs)
For LLM context: This is a technical documentation page for TideSurf, a TypeScript library that connects Chromium to LLM agents via CDP with token-efficient DOM compression.
`;
}

function openLlmsTxt(pageName: string): void {
  const content = pageMap[pageName];
  if (!content) return;
  
  const llmsContent = generateLlmsTxt(pageName, content);
  const blob = new Blob([llmsContent], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  
  // Open in new tab
  const newTab = window.open(url, "_blank");
  if (newTab) {
    newTab.document.title = `llms.txt - ${pageName}`;
  }
  
  // Clean up blob URL after a delay
  setTimeout(() => URL.revokeObjectURL(url), 60000);
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

  currentPageName = pageName;

  const html = marked.parse(md, { async: false }) as string;
  const fragment = sanitizeHtmlFragment(html);
  contentEl.replaceChildren(fragment);

  // Wrap tables for horizontal scroll on mobile
  contentEl.querySelectorAll("table").forEach((table) => {
    if (!table.parentElement?.classList.contains("table-wrapper")) {
      const wrapper = document.createElement("div");
      wrapper.className = "table-wrapper";
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
  });

  addCodeHeaders();
  addCodeCopyButtons();
  highlightCode();

  document.querySelectorAll(".sidebar-link").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("data-page") === pageName);
  });

  const title = contentEl.querySelector("h1")?.textContent;
  if (title) {
    document.title = `${title} — TideSurf Docs`;
  }

  // Clean up previous doc-meta click handler
  docMetaCleanup?.();
  docMetaCleanup = null;

  // Add doc meta (path + action buttons) after h1
  const h1 = contentEl.querySelector("h1");
  if (h1 && !contentEl.querySelector(".doc-meta")) {
    const docMeta = document.createElement("div");
    docMeta.className = "doc-meta";

    const pathEl = document.createElement("div");
    pathEl.className = "page-path";
    pathEl.textContent = `/docs#${pageName}`;
    pathEl.title = "Click to copy link";
    pathEl.addEventListener("click", () => {
      const url = `${window.location.origin}/docs#${pageName}`;
      navigator.clipboard.writeText(url).then(() => {
        pathEl.textContent = translate("content.share.copied");
        setTimeout(() => { pathEl.textContent = `/docs#${pageName}`; }, 1500);
      });
    });

    const actions = document.createElement("div");
    actions.className = "doc-actions";

    // Copy options (three dots)
    const copyWrapper = document.createElement("div");
    copyWrapper.className = "doc-action-wrapper";
    const copyBtn = document.createElement("button");
    copyBtn.className = "doc-action-btn";
    copyBtn.setAttribute("aria-label", translate("content.copy.md"));
    copyBtn.setAttribute("aria-haspopup", "true");
    copyBtn.setAttribute("aria-expanded", "false");
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>`;
    const copyDropdown = document.createElement("div");
    copyDropdown.className = "doc-action-dropdown";
    copyDropdown.setAttribute("role", "menu");
    copyDropdown.innerHTML = `
      <button class="doc-action-option" role="menuitem" data-action="copy-md">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span>${translate("content.copy.md")}</span>
      </button>
      <button class="doc-action-option" role="menuitem" data-action="copy-text">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <span>${translate("content.copy.text")}</span>
      </button>
    `;
    copyWrapper.appendChild(copyBtn);
    copyWrapper.appendChild(copyDropdown);

    // Share options
    const shareWrapper = document.createElement("div");
    shareWrapper.className = "doc-action-wrapper";
    const shareBtn = document.createElement("button");
    shareBtn.className = "doc-action-btn";
    shareBtn.setAttribute("aria-label", translate("content.share.title"));
    shareBtn.setAttribute("aria-haspopup", "true");
    shareBtn.setAttribute("aria-expanded", "false");
    shareBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;
    const shareDropdown = document.createElement("div");
    shareDropdown.className = "doc-action-dropdown";
    shareDropdown.setAttribute("role", "menu");
    shareDropdown.innerHTML = `
      <button class="doc-action-option" role="menuitem" data-action="copy-link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        <span>${translate("content.share.copy")}</span>
      </button>
      <button class="doc-action-option" role="menuitem" data-action="llms-txt">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        <span>${translate("content.share.llms")}</span>
      </button>
    `;
    shareWrapper.appendChild(shareBtn);
    shareWrapper.appendChild(shareDropdown);

    // Copy link button (inline, no dropdown)
    const copyLinkBtn = document.createElement("button");
    copyLinkBtn.className = "doc-action-btn";
    copyLinkBtn.setAttribute("aria-label", translate("content.share.copy"));
    copyLinkBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyLinkBtn.addEventListener("click", () => {
      const url = `${window.location.origin}/docs#${pageName}`;
      navigator.clipboard.writeText(url).then(() => {
        copyLinkBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        setTimeout(() => {
          copyLinkBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        }, 1500);
      });
    });

    actions.appendChild(copyWrapper);
    actions.appendChild(shareWrapper);
    actions.appendChild(copyLinkBtn);
    docMeta.appendChild(pathEl);
    docMeta.appendChild(actions);
    h1.insertAdjacentElement("afterend", docMeta);

    // Setup dropdown toggles
    [copyBtn, shareBtn].forEach((btn) => {
      btn.addEventListener("click", () => {
        const dropdown = btn.nextElementSibling as HTMLElement;
        const isExpanded = btn.getAttribute("aria-expanded") === "true";
        docMeta.querySelectorAll(".doc-action-dropdown").forEach((d) => d.classList.remove("open"));
        docMeta.querySelectorAll(".doc-action-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
        if (!isExpanded) {
          btn.setAttribute("aria-expanded", "true");
          dropdown.classList.add("open");
        }
      });
    });

    // Close dropdowns when clicking outside
    const handleOutsideClick = (e: MouseEvent) => {
      if (!actions.contains(e.target as Node)) {
        docMeta.querySelectorAll(".doc-action-dropdown").forEach((d) => d.classList.remove("open"));
        docMeta.querySelectorAll(".doc-action-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
      }
    };
    document.addEventListener("click", handleOutsideClick);
    docMetaCleanup = () => document.removeEventListener("click", handleOutsideClick);

    // Handle actions
    docMeta.querySelectorAll(".doc-action-option").forEach((option) => {
      option.addEventListener("click", () => {
        const action = (option as HTMLElement).dataset.action;
        const span = option.querySelector("span");
        if (action === "copy-md") {
          const md = pageMap[pageName] || "";
          navigator.clipboard.writeText(md).then(() => {
            if (span) { const orig = span.textContent; span.textContent = translate("content.share.copied"); setTimeout(() => { if (span) span.textContent = orig; }, 1500); }
          });
        } else if (action === "copy-text") {
          const text = contentEl.innerText || "";
          navigator.clipboard.writeText(text).then(() => {
            if (span) { const orig = span.textContent; span.textContent = translate("content.share.copied"); setTimeout(() => { if (span) span.textContent = orig; }, 1500); }
          });
        } else if (action === "copy-link") {
          const url = `${window.location.origin}${window.location.pathname}#${pageName}`;
          navigator.clipboard.writeText(url).then(() => {
            if (span) { span.textContent = translate("content.share.copied"); setTimeout(() => { if (span) span.textContent = translate("content.share.copy"); }, 1500); }
          });
        } else if (action === "llms-txt") {
          openLlmsTxt(pageName);
        }
        docMeta.querySelectorAll(".doc-action-dropdown").forEach((d) => d.classList.remove("open"));
        docMeta.querySelectorAll(".doc-action-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
      });
    });
  }

  buildTOC();
}

function navigate(): void {
  const hash = decodeURIComponent(window.location.hash.slice(1) || DEFAULT_PAGE);

  if (hash.includes(":")) {
    const colonIndex = hash.indexOf(":");
    const pagePart = hash.slice(0, colonIndex);
    const headingPart = hash.slice(colonIndex + 1);
    renderPage(pagePart);
    const target = document.getElementById(headingPart);
    if (target) {
      target.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
    }
  } else {
    renderPage(hash);
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  closeMobileMenu();
}

function buildTOC(): void {
  const tocNav = document.getElementById("toc-nav");
  if (!tocNav) {
    return;
  }

  tocObserver?.disconnect();
  tocObserver = null;
  if (tocScrollHandler) {
    window.removeEventListener("scroll", tocScrollHandler);
    tocScrollHandler = null;
  }
  tocNav.replaceChildren();

  const headings = Array.from(contentEl.querySelectorAll("h2, h3, h4"));
  if (headings.length === 0) {
    return;
  }

  const fragment = document.createDocumentFragment();
  let currentGroup: HTMLElement | null = null;

  headings.forEach((heading) => {
    // Generate slug from heading text for better URLs
    const text = heading.textContent ?? "";
    const slug = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .substring(0, 50);

    // Add unique suffix if needed
    const id = heading.id || slug || `heading-${Math.random().toString(36).substr(2, 9)}`;
    heading.id = id;

    // Add anchor link with copy-to-clipboard
    if (!heading.querySelector('.anchor-link')) {
      const anchor = document.createElement("a");
      anchor.href = `#${currentPageName}:${id}`;
      anchor.className = "anchor-link";
      anchor.setAttribute("aria-label", `Link to ${text}`);
      anchor.textContent = "#";
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        const url = `${window.location.origin}${window.location.pathname}#${currentPageName}:${id}`;
        navigator.clipboard.writeText(url).then(() => {
          anchor.textContent = "\u2713";
          anchor.classList.add("copied");
          setTimeout(() => {
            anchor.textContent = "#";
            anchor.classList.remove("copied");
          }, 1500);
        });
      });
      heading.appendChild(anchor);
    }

    const link = document.createElement("a");
    link.href = `#${currentPageName}:${id}`;

    // Set class based on heading level
    const level = heading.tagName.toLowerCase();
    link.className = level === "h4" ? "toc-link toc-h4" :
                     level === "h3" ? "toc-link toc-h3" :
                     "toc-link toc-h2";
    link.dataset.target = id;
    link.textContent = text;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.getElementById(id)?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
    });

    if (level === "h2") {
      // Start a new group for this h2
      currentGroup = document.createElement("div");
      currentGroup.className = "toc-group";
      currentGroup.dataset.collapsed = "true";
      fragment.appendChild(link);
      fragment.appendChild(currentGroup);

      // Toggle collapse on h2 click
      link.addEventListener("click", () => {
        const group = link.nextElementSibling as HTMLElement;
        if (group?.classList.contains("toc-group")) {
          const wasCollapsed = group.dataset.collapsed === "true";
          // Collapse all groups first
          tocNav.querySelectorAll(".toc-group").forEach((g) => {
            (g as HTMLElement).dataset.collapsed = "true";
          });
          if (wasCollapsed) {
            group.dataset.collapsed = "false";
          }
        }
      });
    } else {
      // h3/h4 go into the current group
      if (currentGroup) {
        currentGroup.appendChild(link);
      } else {
        fragment.appendChild(link);
      }
    }
  });

  tocNav.appendChild(fragment);

  // Scroll-based active heading tracking for precise detection
  const navHeight = 80;

  tocScrollHandler = () => {
    let activeId = headings[0]?.id || "";

    for (const heading of headings) {
      const rect = heading.getBoundingClientRect();
      if (rect.top <= navHeight) {
        activeId = heading.id;
      }
    }

    tocNav.querySelectorAll(".toc-link").forEach((link) => {
      link.classList.toggle("active", (link as HTMLElement).dataset.target === activeId);
    });

    // Auto-expand the group containing the active heading
    tocNav.querySelectorAll(".toc-group").forEach((group) => {
      const hasActive = group.querySelector(".toc-link.active");
      const h2Link = group.previousElementSibling;
      const h2Active = h2Link?.classList.contains("active");
      if (hasActive || h2Active) {
        (group as HTMLElement).dataset.collapsed = "false";
      } else {
        (group as HTMLElement).dataset.collapsed = "true";
      }
    });
  };

  window.addEventListener("scroll", tocScrollHandler, { passive: true });
  tocScrollHandler();
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
      renderPage(currentPageName);
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
