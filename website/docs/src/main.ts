import { marked } from "marked";

// ─────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────

type Language = 'en' | 'ja' | 'ko';
type Theme = 'light' | 'dark';

interface Translations {
  [key: string]: {
    en: string;
    ja: string;
    ko: string;
  };
}

// ─────────────────────────────────────
// Translations
// ─────────────────────────────────────

const translations: Translations = {
  // Navigation
  'nav.github': {
    en: 'GitHub',
    ja: 'GitHub',
    ko: 'GitHub'
  },
  'nav.npm': {
    en: 'npm',
    ja: 'npm',
    ko: 'npm'
  },
  'docs.title': {
    en: 'Documentation',
    ja: 'ドキュメント',
    ko: '문서'
  },

  // Search
  'search.placeholder': {
    en: 'Search docs...',
    ja: 'ドキュメントを検索...',
    ko: '문서 검색...'
  },

  // Sidebar
  'sidebar.gettingstarted': {
    en: 'Getting started',
    ja: 'はじめに',
    ko: '시작하기'
  },
  'sidebar.intro': {
    en: 'Introduction',
    ja: '導入',
    ko: '소개'
  },
  'sidebar.guide': {
    en: 'Guide',
    ja: 'ガイド',
    ko: '가이드'
  },
  'sidebar.pageformat': {
    en: 'Page format',
    ja: 'ページ形式',
    ko: '페이지 형식'
  },
  'sidebar.tokenbudget': {
    en: 'Token budget',
    ja: 'トークン予算',
    ko: '토큰 예산'
  },
  'sidebar.multitab': {
    en: 'Multi-tab',
    ja: 'マルチタブ',
    ko: '멀티탭'
  },
  'sidebar.errors': {
    en: 'Error handling',
    ja: 'エラー処理',
    ko: '오류 처리'
  },
  'sidebar.troubleshoot': {
    en: 'Troubleshooting',
    ja: 'トラブルシューティング',
    ko: '문제 해결'
  },
  'sidebar.reference': {
    en: 'Reference',
    ja: 'リファレンス',
    ko: '참조'
  },
  'sidebar.api': {
    en: 'API reference',
    ja: 'APIリファレンス',
    ko: 'API 참조'
  },
  'sidebar.bench': {
    en: 'Benchmarks',
    ja: 'ベンチマーク',
    ko: '벤치마크'
  },
  'sidebar.arch': {
    en: 'Architecture',
    ja: 'アーキテクチャ',
    ko: '아키텍처'
  },
  'sidebar.changelog': {
    en: 'Changelog',
    ja: '変更履歴',
    ko: '변경 이력'
  },
  'sidebar.feedback': {
    en: 'Feedback',
    ja: 'フィードバック',
    ko: '피드백'
  },
  'toc.heading': {
    en: 'On this page',
    ja: 'このページの内容',
    ko: '이 페이지'
  }
};

// ─────────────────────────────────────
// State
// ─────────────────────────────────────

let currentLang: Language = 'en';
let currentTheme: Theme = 'dark';
let pages: Record<string, string> = {};
let pageMap: Record<string, string> = {};

// ─────────────────────────────────────
// Content Loading
// ─────────────────────────────────────

async function loadContent() {
  const modules = import.meta.glob("../content/*.md", {
    eager: true,
    query: "?raw",
    import: "default",
  });

  pages = modules as Record<string, string>;
  for (const [path, content] of Object.entries(pages)) {
    const name = path.split("/").pop()?.replace(".md", "") ?? "";
    pageMap[name] = content as string;
  }
}

// ─────────────────────────────────────
// Page Rendering
// ─────────────────────────────────────

const contentEl = document.getElementById("content")!;

function renderPage(pageName: string) {
  const md = pageMap[pageName];
  if (!md) {
    contentEl.innerHTML = `<div class="error-page">
      <h1>404</h1>
      <p>Page not found</p>
      <a href="#getting-started">Go to Introduction</a>
    </div>`;
    return;
  }

  // Render markdown — sanitize by stripping raw HTML tags to prevent XSS
  const html = marked.parse(md, { async: false }) as string;
  const sanitized = html
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '');
  contentEl.innerHTML = sanitized;

  // Add copy buttons to pre blocks
  document.querySelectorAll('pre').forEach(pre => {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-wrapper';
    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-code-btn';
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>`;
    copyBtn.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.textContent || '';
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.classList.add('copied');
        setTimeout(() => copyBtn.classList.remove('copied'), 1500);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });
    wrapper.appendChild(copyBtn);
  });

  // Update sidebar active state
  document.querySelectorAll(".sidebar-link").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("data-page") === pageName);
  });

  // Update page title
  const title = contentEl.querySelector('h1')?.textContent;
  if (title) {
    document.title = `${title} — TideSurf Docs`;
  }

  // Build "On this page" TOC
  buildTOC();
}

function navigate() {
  const hash = window.location.hash.slice(1) || "getting-started";
  renderPage(hash);
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Close mobile menu on navigation
  closeMobileMenu();
}

// ─────────────────────────────────────
// Table of Contents
// ─────────────────────────────────────

function buildTOC() {
  const tocNav = document.getElementById('toc-nav');
  if (!tocNav) return;

  const headings = contentEl.querySelectorAll('h2, h3');
  if (headings.length === 0) {
    tocNav.innerHTML = '';
    return;
  }

  let html = '';
  headings.forEach((h, i) => {
    const id = `heading-${i}`;
    h.id = id;
    const level = h.tagName === 'H3' ? 'toc-h3' : '';
    html += `<a href="#" class="toc-link ${level}" data-target="${id}">${h.textContent}</a>`;
  });
  tocNav.innerHTML = html;

  // Click handler for TOC links
  tocNav.querySelectorAll('.toc-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById((link as HTMLElement).dataset.target || '');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Scroll spy — highlight active TOC item
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        tocNav.querySelectorAll('.toc-link').forEach(l => l.classList.remove('active'));
        const active = tocNav.querySelector(`[data-target="${entry.target.id}"]`);
        active?.classList.add('active');
      }
    });
  }, { rootMargin: '-80px 0px -70% 0px' });

  headings.forEach(h => observer.observe(h));
}

// ─────────────────────────────────────
// Search
// ─────────────────────────────────────

function initSearch() {
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const resultsEl = document.getElementById('search-results');
  if (!searchInput || !resultsEl) return;

  searchInput.addEventListener('input', (e) => {
    const query = (e.target as HTMLInputElement).value.toLowerCase().trim();
    if (!query) {
      resultsEl.innerHTML = '';
      resultsEl.style.display = 'none';
      // Show all sidebar sections
      document.querySelectorAll('.sidebar-section').forEach(section => {
        (section as HTMLElement).style.display = '';
      });
      return;
    }

    // Search page content
    const results: { name: string; title: string; snippet: string }[] = [];
    for (const [name, content] of Object.entries(pageMap)) {
      const lower = content.toLowerCase();
      const idx = lower.indexOf(query);
      if (idx !== -1) {
        const titleMatch = content.match(/^#\s+(.+)/m);
        const title = titleMatch ? titleMatch[1] : name;
        // Extract snippet around match
        const start = Math.max(0, idx - 40);
        const end = Math.min(content.length, idx + query.length + 60);
        let snippet = content.slice(start, end).replace(/[#*`\n]/g, ' ').trim();
        if (start > 0) snippet = '...' + snippet;
        if (end < content.length) snippet += '...';
        results.push({ name, title, snippet });
      }
    }

    if (results.length > 0) {
      resultsEl.innerHTML = results.map(r =>
        `<a href="#${r.name}" class="search-result">
          <span class="search-result-title">${r.title}</span>
          <span class="search-result-snippet">${r.snippet}</span>
        </a>`
      ).join('');
      resultsEl.style.display = 'block';
    } else {
      resultsEl.innerHTML = '<div class="search-empty">No results</div>';
      resultsEl.style.display = 'block';
    }

    // Also filter sidebar sections
    document.querySelectorAll('.sidebar-section').forEach(section => {
      const links = section.querySelectorAll('.sidebar-link');
      let hasMatch = false;
      links.forEach(link => {
        const pageName = link.getAttribute('data-page') || '';
        const text = link.textContent?.toLowerCase() || '';
        if (text.includes(query) || (pageMap[pageName] && pageMap[pageName].toLowerCase().includes(query))) {
          hasMatch = true;
        }
      });
      (section as HTMLElement).style.display = hasMatch ? '' : 'none';
    });
  });

  // Close search results on navigation
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      resultsEl.style.display = 'none';
      document.querySelectorAll('.sidebar-section').forEach(section => {
        (section as HTMLElement).style.display = '';
      });
    }
  });

  // Close results when clicking a result
  resultsEl.addEventListener('click', () => {
    searchInput.value = '';
    resultsEl.style.display = 'none';
    document.querySelectorAll('.sidebar-section').forEach(section => {
      (section as HTMLElement).style.display = '';
    });
  });
}

// ─────────────────────────────────────
// Theme Toggle
// ─────────────────────────────────────

function initTheme(): void {
  const savedTheme = localStorage.getItem('tidesurf-docs-theme') as Theme | null;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  currentTheme = savedTheme || (prefersDark ? 'dark' : 'light');
  applyTheme();

  const themeBtn = document.getElementById('theme-toggle');
  themeBtn?.addEventListener('click', toggleTheme);
}

function toggleTheme(): void {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('tidesurf-docs-theme', currentTheme);
  applyTheme();
}

function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', currentTheme);
}

// ─────────────────────────────────────
// Language Switcher
// ─────────────────────────────────────

function initLanguage(): void {
  const savedLang = localStorage.getItem('tidesurf-docs-lang') as Language | null;
  currentLang = savedLang || detectLanguage();

  applyLanguage();

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const lang = (e.currentTarget as HTMLElement).dataset.lang as Language;
      if (lang && lang !== currentLang) {
        currentLang = lang;
        localStorage.setItem('tidesurf-docs-lang', lang);
        applyLanguage();
        updateLangButtons();
      }
    });
  });
}

function detectLanguage(): Language {
  const browserLang = navigator.language.toLowerCase();
  if (browserLang.startsWith('ja')) return 'ja';
  if (browserLang.startsWith('ko')) return 'ko';
  return 'en';
}

function applyLanguage(): void {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key && translations[key]) {
      el.textContent = translations[key][currentLang];
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && translations[key]) {
      (el as HTMLInputElement).placeholder = translations[key][currentLang];
    }
  });

  document.documentElement.lang = currentLang === 'ja' ? 'ja' : currentLang === 'ko' ? 'ko' : 'en';
}

function updateLangButtons(): void {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-lang') === currentLang);
  });
}

// ─────────────────────────────────────
// Mobile Menu
// ─────────────────────────────────────

function initMobileMenu(): void {
  const toggle = document.getElementById('mobile-menu-toggle');
  const overlay = document.getElementById('mobile-overlay');
  const sidebar = document.querySelector('.sidebar');

  toggle?.addEventListener('click', () => {
    document.body.classList.toggle('mobile-menu-open');
  });

  overlay?.addEventListener('click', closeMobileMenu);
}

function closeMobileMenu(): void {
  document.body.classList.remove('mobile-menu-open');
}

// ─────────────────────────────────────
// Initialize
// ─────────────────────────────────────

async function init(): Promise<void> {
  await loadContent();

  initTheme();
  initLanguage();
  initSearch();
  initMobileMenu();

  window.addEventListener("hashchange", navigate);
  navigate();

  // Set initial active states
  updateLangButtons();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
