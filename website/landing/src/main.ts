// TideSurf Landing

type Language = 'en' | 'ja' | 'ko';
type Theme = 'light' | 'dark';

interface Translations {
  [key: string]: { en: string; ja: string; ko: string };
}

const translations: Translations = {
  'nav.docs': { en: 'Docs', ja: 'ドキュメント', ko: '문서' },
  'nav.github': { en: 'GitHub', ja: 'GitHub', ko: 'GitHub' },
  'nav.npm': { en: 'npm', ja: 'npm', ko: 'npm' },
  'hero.title.line1': { en: 'Surf', ja: '波に', ko: '파도를' },
  'hero.title.line2': { en: 'the', ja: '', ko: '' },
  'hero.title.line3': { en: 'Tide', ja: '乗れ', ko: '타라' },
  'hero.tagline1': {
    en: 'Your AI doesn\'t need eyes to browse.',
    ja: 'AIにスクリーンショットは要らない。',
    ko: 'AI에게 스크린샷은 필요 없습니다.'
  },
  'hero.tagline2': {
    en: 'We compress every page to what matters.',
    ja: 'ページを本当に必要な部分だけに圧縮。',
    ko: '웹 페이지를 핵심만 남겨 압축합니다.'
  },
  'hero.scroll': { en: 'Scroll', ja: 'スクロール', ko: '아래로' },
  'compare.label': { en: 'How it works', ja: '仕組み', ko: '동작 원리' },
  'compare.headline': { en: 'XML is all you need.', ja: 'XMLさえあればいい。', ko: 'XML, 그것이면 충분합니다.' },
  'compare.desc': {
    en: 'TideSurf strips wrapper elements, classes, scripts and styles. What\'s left is clean, semantic XML that any LLM can consume.',
    ja: 'TideSurfはラッパー要素、クラス、スクリプト、スタイルを除去。残るのは、どのLLMでも消費できるクリーンなセマンティックXMLです。',
    ko: '래퍼 요소, 클래스, 스크립트, 스타일을 모두 걷어내고 LLM이 바로 이해할 수 있는 깔끔한 시맨틱 XML만 남깁니다.'
  },
  'compare.nav.label': { en: 'Navigation', ja: 'ナビゲーション', ko: '네비게이션' },
  'compare.form.label': { en: 'Search form', ja: '検索フォーム', ko: '검색 폼' },
  'compare.product.label': { en: 'Product card', ja: '商品カード', ko: '상품 카드' },
  'compare.table.label': { en: 'Data table', ja: 'データテーブル', ko: '데이터 테이블' },
  'compare.raw': { en: 'Raw HTML', ja: '生HTML', ko: '원본 HTML' },
  'compare.tidesurf': { en: 'TideSurf XML', ja: 'TideSurf XML', ko: 'TideSurf XML' },
  'features.label': { en: 'Features', ja: '機能', ko: '기능' },
  'features.title': { en: 'Built for agents', ja: 'エージェントのために構築', ko: 'AI 에이전트를 위한 설계' },
  'feature.compression.title': { en: 'DOM compression', ja: 'DOM圧縮', ko: 'DOM 압축' },
  'feature.compression.desc': {
    en: 'Strips classes, wrapper divs, scripts and styles while preserving interactive elements, semantic structure and text at 100-800 tokens per page',
    ja: 'クラス、ラッパーdiv、スクリプト、スタイルを除去し、インタラクティブ要素と意味構造、テキストを保持。1ページ100-800トークン',
    ko: '클래스, 래퍼 div, 스크립트, 스타일을 제거하되 인터랙티브 요소와 시맨틱 구조, 텍스트는 보존합니다. 페이지당 100~800 토큰'
  },
  'feature.tools.title': { en: '12 standard tools', ja: '12の標準ツール', ko: '12가지 표준 도구' },
  'feature.tools.desc': {
    en: 'Navigate, click, type, scroll, extract and more. Works with any LLM that supports function calling',
    ja: 'ナビゲート、クリック、入力、スクロール、抽出など。関数呼び出しをサポートする任意のLLMで動作',
    ko: '탐색, 클릭, 입력, 스크롤, 추출 등 모든 브라우저 조작을 지원합니다. 함수 호출이 가능한 어떤 LLM에서도 동작합니다'
  },
  'feature.multitab.title': { en: 'Multi-tab', ja: 'マルチタブ', ko: '멀티탭' },
  'feature.multitab.desc': {
    en: 'Open, switch and close tabs with independent state per tab. Full browser control through one API',
    ja: 'タブごとに独立した状態で開く、切り替える、閉じる。1つのAPIでブラウザを完全に制御',
    ko: '각 탭이 독립된 상태를 유지하며, 하나의 API로 브라우저 전체를 제어할 수 있습니다'
  },
  'feature.tokens.title': { en: 'Token budget', ja: 'トークン予算', ko: '토큰 예산' },
  'feature.tokens.desc': {
    en: 'Set a max token limit and TideSurf prioritizes interactive and visible elements, pruning the rest',
    ja: '最大トークン制限を設定すると、TideSurfはインタラクティブで可視の要素を優先し、残りを削減',
    ko: '최대 토큰 수를 지정하면, 인터랙티브 요소와 핵심 콘텐츠를 우선 배치하고 나머지는 자동으로 제거합니다'
  },
  'feature.mcp.title': { en: 'MCP server', ja: 'MCPサーバー', ko: 'MCP 서버' },
  'feature.mcp.desc': {
    en: 'Ships with a Model Context Protocol server. Drop it into Claude Code or any MCP client',
    ja: 'Model Context Protocolサーバーを同梱。Claude Codeや任意のMCPクライアントにドロップイン',
    ko: 'Model Context Protocol 서버가 기본 내장되어 있어, Claude Code를 비롯한 모든 MCP 클라이언트에 바로 연결됩니다'
  },
  'feature.typescript.title': { en: 'TypeScript-first', ja: 'TypeScriptファースト', ko: 'TypeScript 우선' },
  'feature.typescript.desc': {
    en: 'Full type definitions, typed error classes. Built for Bun and works with Node',
    ja: '完全な型定義、型付きエラークラス。Bun用に構築され、Nodeでも動作',
    ko: '완전한 타입 정의와 타입 기반 에러 클래스를 제공합니다. Bun에 최적화되어 있으며 Node에서도 사용 가능합니다'
  },
  'quickstart.label': { en: 'Quick Start', ja: 'クイックスタート', ko: '빠른 시작' },
  'quickstart.title': { en: 'Get started in seconds', ja: '数秒で開始', ko: '몇 초면 시작할 수 있습니다' },
  'step1.title': { en: 'Install', ja: 'インストール', ko: '설치' },
  'step1.desc': { en: 'Add @tidesurf/core to your project', ja: 'プロジェクトに@tidesurf/coreを追加', ko: '프로젝트에 @tidesurf/core를 추가합니다' },
  'step2.title': { en: 'Launch', ja: '起動', ko: '실행' },
  'step2.desc': { en: 'Start a browser instance', ja: 'ブラウザインスタンスを開始', ko: '브라우저 인스턴스를 시작합니다' },
  'step3.title': { en: 'Control', ja: '制御', ko: '제어' },
  'step3.desc': { en: 'Navigate and interact with pages', ja: 'ページをナビゲートして操作', ko: '페이지를 탐색하고 상호작용합니다' },
  'hero.shortline': {
    en: 'In the modern web era, the tide is strong. Let\'s surf.',
    ja: '現代のウェブ時代、潮流は激しい。波に乗ろう。',
    ko: '현대 웹 시대, 조류는 거세다. 파도를 타자.'
  }
};

// ── State ──

let currentLang: Language = 'en';
let currentTheme: Theme = 'dark';
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

// ── Tide Animation ──

class TideWave {
  private phase: number;
  private amplitude: number;
  private frequency: number;
  private speed: number;
  private yOffset: number;
  private color: string;

  constructor(phase: number, amplitude: number, frequency: number, speed: number, yOffset: number, color: string) {
    this.phase = phase;
    this.amplitude = amplitude;
    this.frequency = frequency;
    this.speed = speed;
    this.yOffset = yOffset;
    this.color = color;
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 3) {
      const y = this.yOffset +
        Math.sin(x * this.frequency + time * this.speed + this.phase) * this.amplitude +
        Math.sin(x * this.frequency * 0.4 + time * this.speed * 0.6) * (this.amplitude * 0.3);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = this.color;
    ctx.fill();
  }

  update(): void {
    this.phase += 0.001;
  }
}

let waves: TideWave[] = [];

function initTideAnimation(): void {
  canvas = document.getElementById('tide-canvas') as HTMLCanvasElement;
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  if (!ctx) return;

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas, { passive: true });

  waves = [
    new TideWave(0, 20, 0.002, 0.0003, 0, 'rgba(120, 120, 120, 0.035)'),
    new TideWave(1.5, 15, 0.003, 0.0004, 30, 'rgba(160, 160, 160, 0.02)'),
  ];

  animate();
}

function resizeCanvas(): void {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function animate(): void {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const time = Date.now();
  waves.forEach(w => {
    w.update();
    w.draw(ctx!, canvas!.width, canvas!.height, time);
  });
  requestAnimationFrame(animate);
}

// ── Floating Tags ──

function initFloatingTags(): void {
  const container = document.getElementById('floating-tags');
  if (!container) return;

  const tagPool = [
    '<div>', '<span>', '<nav>', '<header>', '<footer>', '<section>',
    '<article>', '<main>', '<aside>', '<form>', '<input>', '<button>',
    '<a>', '<ul>', '<ol>', '<li>', '<p>', '<h1>', '<h2>', '<h3>',
    '<img>', '<table>', '<tr>', '<td>', '<th>', '<select>', '<textarea>',
    '<label>', '<canvas>', '<video>', '<audio>', '<svg>', '<path>',
    '<dialog>', '<details>', '<summary>', '<figure>', '<picture>',
    '<template>', '<slot>',
    '</div>', '</span>', '</nav>', '</header>', '</section>', '</form>',
    '</button>', '</a>', '</ul>', '</li>', '</p>', '</table>', '</svg>',
    '</body>', '</html>',
    '<div class="container">', '<div id="root">', '<a href="/about">',
    '<input type="text">', '<button type="submit">', '<img src="..." alt="">',
    '<form action="/api">', '<link rel="stylesheet">', '<meta charset="UTF-8">',
    '<script src="app.js">', '<div data-id="42">', '<span role="alert">',
    'display: flex;', 'margin: 0 auto;', 'padding: 1rem;',
    'color: inherit;', 'font-size: 16px;', 'position: relative;',
    'z-index: 10;', 'overflow: hidden;', 'border-radius: 8px;',
    'opacity: 0.5;', 'grid-template-columns:', 'justify-content: center;',
    'align-items: center;', 'transform: scale(1);', 'transition: all 0.3s;',
    'class="..."', 'id="app"', 'style="..."', 'onClick={}',
    'aria-label=""', 'role="button"', 'data-testid=""',
    'key={id}', 'ref={el}', 'className="..."',
  ];

  const strippedTags = new Set([
    '<script src="app.js">', 'class="..."', 'style="..."', 'onClick={}',
    '<div class="container">', 'className="..."', 'data-testid=""',
    'display: flex;', 'margin: 0 auto;', 'padding: 1rem;',
    'color: inherit;', 'font-size: 16px;', 'position: relative;',
    'z-index: 10;', 'overflow: hidden;', 'border-radius: 8px;',
    'opacity: 0.5;', 'grid-template-columns:', 'justify-content: center;',
    'align-items: center;', 'transform: scale(1);', 'transition: all 0.3s;',
  ]);

  const count = 100;

  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'floating-tag';
    const tagText = tagPool[i % tagPool.length];
    el.textContent = tagText;

    if (strippedTags.has(tagText)) {
      el.classList.add('is-stripped');
    }

    const animRoll = Math.random();
    if (animRoll > 0.6) {
      el.classList.add(animRoll > 0.8 ? 'anim-wave' : 'anim-drift');
    }

    const layer = Math.random();
    let size: number, opacity: number, duration: number, blur: number;

    if (layer < 0.25) {
      size = 0.55 + Math.random() * 0.15;
      opacity = 0.06 + Math.random() * 0.04;
      duration = 75 + Math.random() * 45;
      blur = 1;
    } else if (layer < 0.6) {
      size = 0.75 + Math.random() * 0.2;
      opacity = 0.09 + Math.random() * 0.06;
      duration = 48 + Math.random() * 28;
      blur = 0;
    } else if (layer < 0.85) {
      size = 0.95 + Math.random() * 0.3;
      opacity = 0.13 + Math.random() * 0.07;
      duration = 32 + Math.random() * 20;
      blur = 0;
    } else {
      size = 1.15 + Math.random() * 0.35;
      opacity = 0.16 + Math.random() * 0.08;
      duration = 25 + Math.random() * 18;
      blur = 0;
    }

    const x = Math.random() * 96 + 2;
    const y = Math.random() * 90 + 5;
    const delay = -(Math.random() * duration);
    const sway = (Math.random() - 0.5) * 40;
    const rotation = (Math.random() - 0.5) * 12;

    const hue = 0;
    const sat = 0;
    const lit = 32 + Math.random() * 28;

    el.style.cssText = `--x:${x}%;--y:${y}%;--s:${size}rem;--o:${opacity};--d:${duration}s;--delay:${delay}s;--sway:${sway}px;--r:${rotation}deg;--blur:${blur}px;color:hsl(${hue},${sat}%,${lit}%)`;

    container.appendChild(el);
  }
}

// ── Mouse Parallax ──

function initMouseParallax(): void {
  const hero = document.querySelector('.hero') as HTMLElement | null;
  const container = document.getElementById('floating-tags');
  if (!hero || !container) return;

  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;
  let rafId = 0;

  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  function updateParallax(): void {
    currentX = lerp(currentX, targetX, 0.06);
    currentY = lerp(currentY, targetY, 0.06);

    if (Math.abs(currentX - targetX) > 0.01 || Math.abs(currentY - targetY) > 0.01) {
      container!.style.setProperty('--mx', `${currentX}px`);
      container!.style.setProperty('--my', `${currentY}px`);
      rafId = requestAnimationFrame(updateParallax);
    } else {
      container!.style.setProperty('--mx', `${targetX}px`);
      container!.style.setProperty('--my', `${targetY}px`);
      rafId = 0;
    }
  }

  hero.addEventListener('mousemove', (e: MouseEvent) => {
    const rect = hero.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    targetX = nx * -18;
    targetY = ny * -12;
    if (!rafId) rafId = requestAnimationFrame(updateParallax);
  });

  hero.addEventListener('mouseleave', () => {
    targetX = 0;
    targetY = 0;
    if (!rafId) rafId = requestAnimationFrame(updateParallax);
  });
}

// ── Slot Machine ──

function initSlotMachine(): void {
  const track = document.getElementById('slot-track') as HTMLElement | null;
  const copyBtn = document.querySelector('.install-box .copy-btn') as HTMLElement | null;
  if (!track || !copyBtn) return;

  const commands = [
    'bun add @tidesurf/core',
    'npm install @tidesurf/core',
    'yarn add @tidesurf/core',
    'pnpm add @tidesurf/core',
  ];
  const total = commands.length;
  let current = 0;

  setInterval(() => {
    current++;
    track.style.transition = 'transform 0.45s cubic-bezier(0.23, 1, 0.32, 1)';
    track.style.transform = `translateY(-${current * (100 / (total + 1))}%)`;
    copyBtn.dataset.copy = commands[current % total];

    if (current >= total) {
      setTimeout(() => {
        track.style.transition = 'none';
        track.style.transform = 'translateY(0)';
        current = 0;
      }, 500);
    }
  }, 3000);
}

// ── Showcase Carousel ──

function initShowcase(): void {
  const track = document.querySelector('.showcase-track') as HTMLElement | null;
  const prevBtn = document.querySelector('.showcase-prev');
  const nextBtn = document.querySelector('.showcase-next');
  const dots = document.querySelectorAll('.showcase-dot');
  if (!track || !prevBtn || !nextBtn) return;

  const slides = track.querySelectorAll('.showcase-slide');
  const total = slides.length;
  let current = 0;

  function goTo(index: number): void {
    current = ((index % total) + total) % total;
    track!.style.transform = `translateX(-${current * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === current));
  }

  prevBtn.addEventListener('click', () => goTo(current - 1));
  nextBtn.addEventListener('click', () => goTo(current + 1));
  dots.forEach((d, i) => d.addEventListener('click', () => goTo(i)));
}

// ── Syntax Highlighting ──

interface CodeLine {
  text: string;
  step: number; // 1, 2, or 3
}

const quickstartLines: CodeLine[] = [
  { text: 'import { TideSurf } from "@tidesurf/core"', step: 1 },
  { text: '', step: 1 },
  { text: 'const browser = await TideSurf.launch()', step: 2 },
  { text: 'await browser.navigate("https://example.com")', step: 2 },
  { text: '', step: 2 },
  { text: '// Get compressed page state', step: 3 },
  { text: 'const state = await browser.getState()', step: 3 },
  { text: 'console.log(state.xml)', step: 3 },
  { text: '', step: 3 },
  { text: '// Execute agent actions', step: 3 },
  { text: 'const page = browser.getPage()', step: 3 },
  { text: 'await page.click("B1")', step: 3 },
  { text: 'await page.type("I1", "hello world")', step: 3 },
  { text: '', step: 3 },
  { text: 'await browser.close()', step: 3 },
];

function highlightTS(line: string): string {
  if (!line) return '\n';

  // Comments
  if (line.trimStart().startsWith('//')) {
    return `<span class="tk-cm">${escapeHtml(line)}</span>`;
  }

  let result = escapeHtml(line);

  // Strings (double-quoted)
  result = result.replace(/&quot;([^&]*)&quot;/g, '<span class="tk-str">&quot;$1&quot;</span>');
  // Also handle literal quotes that didn't get escaped
  result = result.replace(/"([^"<]*)"/g, '<span class="tk-str">"$1"</span>');

  // Keywords
  const keywords = ['import', 'from', 'const', 'await', 'let', 'var', 'async', 'function', 'return', 'type', 'interface', 'export', 'new'];
  keywords.forEach(kw => {
    result = result.replace(new RegExp(`\\b(${kw})\\b`, 'g'), '<span class="tk-kw">$1</span>');
  });

  // Types/constructors
  result = result.replace(/\b(TideSurf|TideSurfConfig|BrowserState|PageAction)\b/g, '<span class="tk-type">$1</span>');

  // Booleans & numbers
  result = result.replace(/\b(true|false|null|undefined)\b/g, '<span class="tk-num">$1</span>');
  result = result.replace(/\b(\d+)\b/g, '<span class="tk-num">$1</span>');

  // Method calls: .word(
  result = result.replace(/\.(\w+)\(/g, '.<span class="tk-fn">$1</span>(');

  // Property access: .word (no paren)
  result = result.replace(/\.(\w+)(?![(<\w])/g, '.<span class="tk-pr">$1</span>');

  // Object braces
  result = result.replace(/([{}])/g, '<span class="tk-br">$1</span>');

  return result;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function initQuickstart(): void {
  const codeEl = document.getElementById('quickstart-code');
  if (!codeEl) return;

  // Render all lines with syntax highlighting
  const html = quickstartLines.map((line, i) => {
    const highlighted = highlightTS(line.text);
    return `<span class="code-line" data-line-step="${line.step}" data-line-index="${i}">${highlighted}</span>`;
  }).join('');
  codeEl.innerHTML = html;

  // Set initial highlight to step 1
  updateCodeHighlight(1);

  // Bind step clicks
  document.querySelectorAll('.step[data-step]').forEach(step => {
    step.addEventListener('click', () => {
      const stepNum = parseInt(step.getAttribute('data-step') || '1', 10);
      document.querySelectorAll('.step[data-step]').forEach(s => s.classList.remove('active'));
      step.classList.add('active');
      updateCodeHighlight(stepNum);
    });
  });
}

function updateCodeHighlight(activeStep: number): void {
  document.querySelectorAll('.code-line').forEach(line => {
    const lineStep = parseInt(line.getAttribute('data-line-step') || '0', 10);
    line.classList.toggle('dimmed', lineStep !== activeStep);
  });
}

// ── Theme ──

function initTheme(): void {
  const saved = localStorage.getItem('tidesurf-theme') as Theme | null;
  currentTheme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme();
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
}

function toggleTheme(): void {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('tidesurf-theme', currentTheme);
  applyTheme();
}

function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', currentTheme);
}

// ── Language ──

function initLanguage(): void {
  const saved = localStorage.getItem('tidesurf-lang') as Language | null;
  currentLang = saved || detectLanguage();
  applyLanguage();

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const lang = (e.currentTarget as HTMLElement).dataset.lang as Language;
      if (lang && lang !== currentLang) {
        currentLang = lang;
        localStorage.setItem('tidesurf-lang', lang);
        applyLanguage();
        updateLangButtons();
      }
    });
  });
}

function detectLanguage(): Language {
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('ko')) return 'ko';
  return 'en';
}

function applyLanguage(): void {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key && translations[key]) {
      const text = translations[key][currentLang];
      if (el.hasAttribute('data-i18n-attr')) {
        const attr = el.getAttribute('data-i18n-attr');
        if (attr) el.setAttribute(attr, text);
      } else {
        el.textContent = text;
      }
    }
  });
  document.documentElement.lang = currentLang;
}

function updateLangButtons(): void {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-lang') === currentLang);
  });
}

// ── Copy ──

function initCopyButtons(): void {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const text = (e.currentTarget as HTMLElement).dataset.copy;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        const el = e.currentTarget as HTMLElement;
        el.classList.add('copied');
        const original = el.innerHTML;
        el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        setTimeout(() => {
          el.classList.remove('copied');
          el.innerHTML = original;
        }, 1200);
      } catch (err) {
        console.error('Copy failed:', err);
      }
    });
  });
}

// ── Scroll Morph ──

function initScrollMorph(): void {
  const hero = document.querySelector('.hero') as HTMLElement;
  const floatingTags = document.getElementById('floating-tags');
  const scrollHint = document.querySelector('.scroll-hint') as HTMLElement;

  if (!hero) return;

  let scrollHintReady = false;
  if (scrollHint) {
    scrollHint.addEventListener('animationend', () => {
      scrollHint.style.animation = 'none';
      scrollHint.style.opacity = '1';
      scrollHintReady = true;
    }, { once: true });
  }

  let ticking = false;

  function onScroll(): void {
    if (!ticking) {
      requestAnimationFrame(() => {
        const heroH = hero.offsetHeight;
        const scrolled = window.scrollY;
        const progress = Math.min(1, Math.max(0, scrolled / heroH));

        // Floating tags: scroll parallax via CSS custom property
        if (floatingTags) {
          floatingTags.style.setProperty('--sy', `${progress * -150}px`);
        }

        // Scroll hint: disappears immediately on scroll
        if (scrollHint && scrollHintReady) {
          scrollHint.style.opacity = `${Math.max(0, 1 - progress * 6)}`;
        }

        ticking = false;
      });
      ticking = true;
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
}

// ── Nav Scroll ──

function initNavScroll(): void {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        nav.classList.toggle('scrolled', window.scrollY > 50);
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

// ── Scroll Reveal ──

function initScrollReveal(): void {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// ── Init ──

function highlightAllCodeBlocks(): void {
  document.querySelectorAll('.feature-code code').forEach(block => {
    const raw = block.textContent || '';
    const lines = raw.split('\n');
    block.innerHTML = lines.map(line => highlightTS(line)).join('\n');
  });
}

function init(): void {
  initTideAnimation();
  initFloatingTags();
  initMouseParallax();
  initScrollMorph();
  initSlotMachine();
  initShowcase();
  initQuickstart();
  highlightAllCodeBlocks();
  initTheme();
  initLanguage();
  initCopyButtons();
  initNavScroll();
  initScrollReveal();
  updateLangButtons();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
