// TideSurf Landing

type Language = "en" | "ja" | "ko";
type Theme = "light" | "dark";

interface Translations {
  [key: string]: { en: string; ja: string; ko: string };
}

const translations: Translations = {
  "nav.docs": { en: "Docs", ja: "Docs", ko: "Docs" },
  "nav.github": { en: "GitHub", ja: "GitHub", ko: "GitHub" },
  "nav.npm": { en: "npm", ja: "npm", ko: "npm" },
  "hero.title.line1": { en: "Surf", ja: "波に", ko: "파도를" },
  "hero.title.line2": { en: "the", ja: "", ko: "" },
  "hero.title.line3": { en: "Tide", ja: "乗れ", ko: "타라" },
  "hero.tagline1": {
    en: "Your AI doesn't need eyes to browse.",
    ja: "AIにスクリーンショットは要らない。",
    ko: "AI에게 스크린샷은 필요 없습니다.",
  },
  "hero.tagline2": {
    en: "We compress every page to what matters.",
    ja: "ページを本当に必要な部分だけに圧縮。",
    ko: "웹 페이지를 핵심만 남겨 압축합니다.",
  },
  "hero.scroll": { en: "Scroll", ja: "スクロール", ko: "아래로" },
  "hero.tagline": {
    en: "Compressed DOM for agents.",
    ja: "エージェント向けの圧縮DOM。",
    ko: "에이전트를 위한 압축 DOM.",
  },
  "compare.label": { en: "How it works", ja: "仕組み", ko: "동작 원리" },
  "compare.headline": {
    en: "HTML in, text out",
    ja: "HTML in, text out",
    ko: "HTML in, text out",
  },
  "compare.desc": {
    en: "TideSurf strips wrapper elements, classes, scripts and styles. What's left is clean, compact text that any LLM can consume.",
    ja: "TideSurfはラッパー要素、クラス、スクリプト、スタイルを除去。残るのは、どのLLMでも消費できるクリーンでコンパクトなテキストです。",
    ko: "래퍼 요소, 클래스, 스크립트, 스타일을 걷어내고 LLM이 바로 이해할 수 있는 깔끔한 텍스트만 남깁니다.",
  },
  "compare.nav.label": {
    en: "Navigation",
    ja: "ナビゲーション",
    ko: "네비게이션",
  },
  "compare.form.label": {
    en: "Search form",
    ja: "検索フォーム",
    ko: "검색 폼",
  },
  "compare.product.label": {
    en: "Product card",
    ja: "商品カード",
    ko: "상품 카드",
  },
  "compare.table.label": {
    en: "Data table",
    ja: "データテーブル",
    ko: "데이터 테이블",
  },
  "compare.raw": { en: "Raw HTML", ja: "生HTML", ko: "원본 HTML" },
  "compare.tidesurf": {
    en: "TideSurf",
    ja: "TideSurf",
    ko: "TideSurf",
  },
  "bench.label": { en: "Compression", ja: "圧縮", ko: "압축" },
  "bench.title": {
    en: "Fewer tokens, less cost",
    ja: "Fewer tokens, less cost",
    ko: "Fewer tokens, less cost",
  },
  "bench.chart.tokens": { en: "Tokens", ja: "トークン数", ko: "토큰 수" },
  "bench.stat.peak": {
    en: "Peak compression on GitHub",
    ja: "GitHubでの最高圧縮率",
    ko: "GitHub 최고 압축률",
  },
  "bench.stat.reduction": {
    en: "Token reduction",
    ja: "トークン圧縮率",
    ko: "토큰 압축률",
  },
  "bench.stat.speed": {
    en: "Average parse time",
    ja: "平均解析時間",
    ko: "평균 파싱 시간",
  },
  "bench.legend.raw": { en: "Raw HTML", ja: "生HTML", ko: "원본 HTML" },
  "bench.legend.tidesurf": {
    en: "TideSurf",
    ja: "TideSurf",
    ko: "TideSurf",
  },
  "bench.why.title": {
    en: "Why this matters",
    ja: "なぜ重要なのか",
    ko: "왜 중요한가",
  },
  "bench.why.body": {
    en: "Every token your agent reads costs money and eats into the context window. A GitHub page that takes 84,236 tokens raw fits in just 2,593 with TideSurf — that's 32x compression. Browse dozens of pages in a single session instead of one page filling your context.",
    ja: "エージェントが読むトークンにはすべてコストが発生し、コンテキストウィンドウを消費します。生HTMLで84,236トークンのGitHubページがTideSurfではわずか2,593トークンに — 32倍の圧縮です。1ページでコンテキストが埋まるか、1セッションで数十ページを閲覧できるかの違いです。",
    ko: "에이전트가 읽는 모든 토큰에는 비용이 발생하고 컨텍스트 윈도우도 줄어듭니다. 원본 HTML로 84,236 토큰인 GitHub 페이지가 TideSurf에서는 단 2,593 토큰 — 32배 압축입니다. 한 페이지에 컨텍스트가 가득 차는 것이 아니라 수십 페이지를 탐색할 수 있습니다.",
  },
  "bench.how.title": { en: "How we measure", ja: "測定方法", ko: "측정 방법" },
  "bench.how.body": {
    en: "We launch headless Chrome, navigate to each site, and compare the full rendered DOM against TideSurf's compressed output. Token counts use cl100k_base estimation. No cherry-picking — these are live pages, measured as-is.",
    ja: "ヘッドレスChromeを起動し、各サイトに遷移して、レンダリング済みDOMとTideSurfの圧縮出力を比較しています。トークン数はcl100k_base推定を使用しています。意図的な選別はしていません。すべて実際のページをそのまま計測しています。",
    ko: "헤드리스 Chrome으로 각 사이트에 접속한 뒤, 렌더링된 DOM과 TideSurf 출력을 비교합니다. 토큰 수는 cl100k_base 추정치를 사용합니다. 선별 없이 실제 페이지를 있는 그대로 측정합니다.",
  },
  "bench.varies.title": {
    en: "Compression varies",
    ja: "圧縮率はサイトによって異なります",
    ko: "압축률은 사이트마다 다릅니다",
  },
  "bench.varies.body": {
    en: "Heavy sites like GitHub (deep nesting, SVGs, generated classes) see 32x compression. Even lean sites like Hacker News still achieve 8x thanks to the compact output format, URL compression, and text truncation.",
    ja: "GitHubのように重いサイト（深いネスト、SVG、自動生成クラス）は32倍の圧縮を実現します。Hacker Newsのような軽量なサイトでも、コンパクトな出力形式、URL圧縮、テキスト切り詰めにより8倍の圧縮を達成します。",
    ko: "GitHub처럼 무거운 사이트(깊은 중첩, SVG, 자동 생성 클래스)는 32배 압축됩니다. Hacker News처럼 가벼운 사이트도 출력 형식 최적화, URL 압축, 텍스트 트런케이션 덕분에 8배 압축을 달성합니다.",
  },
  "features.label": { en: "Features", ja: "機能", ko: "기능" },
  "features.title": {
    en: "What ships",
    ja: "What ships",
    ko: "What ships",
  },
  "feature.compression.title": {
    en: "DOM compression",
    ja: "DOM圧縮",
    ko: "DOM 압축",
  },
  "feature.compression.desc": {
    en: "Strips classes, wrapper divs, scripts and styles while preserving interactive elements, semantic structure and text at 50-200 tokens per page",
    ja: "クラス、ラッパーdiv、スクリプト、スタイルを除去し、インタラクティブ要素と意味構造、テキストを保持。1ページ50-200トークン",
    ko: "클래스, 래퍼 div, 스크립트, 스타일을 제거하되 인터랙티브 요소와 시맨틱 구조, 텍스트는 보존합니다.",
  },
  "feature.tools.title": {
    en: "18 standard tools",
    ja: "18の標準ツール",
    ko: "18가지 표준 도구",
  },
  "feature.tools.desc": {
    en: "Navigate, click, type, scroll, extract and more. Works with any LLM that supports function calling",
    ja: "ナビゲート、クリック、入力、スクロール、抽出など。関数呼び出しをサポートする任意のLLMで動作",
    ko: "탐색, 클릭, 입력, 스크롤, 추출 등 모든 브라우저 조작을 지원합니다. 함수 호출이 가능한 어떤 LLM에서도 동작합니다.",
  },
  "feature.multitab.title": { en: "Multi-tab", ja: "マルチタブ", ko: "멀티탭" },
  "feature.multitab.desc": {
    en: "Open, switch and close tabs with independent state per tab. Full browser control through one API",
    ja: "タブごとに独立した状態で開く、切り替える、閉じる。1つのAPIでブラウザを完全に制御",
    ko: "독립적으로 동작하는 API로 브라우저 전체를 제어할 수 있습니다.",
  },
  "feature.tokens.title": {
    en: "Token budget",
    ja: "トークン予算",
    ko: "토큰 예산",
  },
  "feature.tokens.desc": {
    en: "Set a max token limit and TideSurf prioritizes interactive and visible elements, pruning the rest",
    ja: "最大トークン制限を設定すると、TideSurfはインタラクティブで可視の要素を優先し、残りを削減",
    ko: "최대 토큰 수를 지정하면 인터랙티브 요소와 핵심 콘텐츠를 우선 배치하고 나머지는 자동으로 제거합니다.",
  },
  "feature.mcp.title": { en: "MCP server", ja: "MCPサーバー", ko: "MCP 서버" },
  "feature.mcp.desc": {
    en: "Ships with a Model Context Protocol server. Directly drop into any agent.",
    ja: "Model Context Protocolサーバーを同梱。任意のMCPクライアントにドロップイン",
    ko: "Model Context Protocol 서버가 기본 내장되어 있어 별도 설정 없이 바로 사용할 수 있습니다.",
  },
  "feature.typescript.title": {
    en: "TypeScript-first",
    ja: "TypeScriptファースト",
    ko: "TypeScript 우선",
  },
  "feature.typescript.desc": {
    en: "Full type definitions and error classes are built-in. Built for Bun, also works with Node",
    ja: "完全な型定義とエラークラスが内蔵されています。Bun用に構築され、Nodeでも動作",
    ko: "완전한 타입 정의와 에러 클래스를 제공합니다. Bun 기반이지만 Node에서도 동작합니다.",
  },
  "feature.autoconnect.title": {
    en: "Auto Connect",
    ja: "オートコネクト",
    ko: "자동 연결",
  },
  "feature.autoconnect.desc": {
    en: "Connect to an already-running Chrome instead of launching a new one. Re-use logged-in sessions, debug active pages, seamlessly hand off between manual browsing and agent control",
    ja: "新しいChromeを起動する代わりに、既に実行中のChromeに接続。ログイン済みセッションの再利用、ライブページのデバッグ、手動ブラウジングとエージェント制御のシームレスな切り替え",
    ko: "새 Chrome을 실행하는 대신 이미 실행 중인 Chrome에 연결합니다. 로그인된 세션 재사용, 활성 페이지 디버깅, 수동 브라우징과 에이전트 제어 간의 원활한 전환이 모두 가능합니다.",
  },
  "patterns.label": { en: "Patterns", ja: "パターン", ko: "패턴" },
  "patterns.title": {
    en: "Built for agents",
    ja: "Built for agents",
    ko: "Built for agents",
  },
  "patterns.sub": {
    en: "Three lines to browse. One tool call to act.",
    ja: "3行でブラウジング。1回のツール呼び出しで操作。",
    ko: "세 줄로 브라우징. 한 번의 도구 호출로 동작.",
  },
  "patterns.observe.label": { en: "Observe", ja: "観察", ko: "관찰" },
  "patterns.observe.title": {
    en: "Read any page in 50 tokens",
    ja: "50トークンでどんなページも読む",
    ko: "50토큰으로 어떤 페이지든 읽기",
  },
  "patterns.act.label": { en: "Act", ja: "操作", ko: "실행" },
  "patterns.act.title": {
    en: "One tool call per action",
    ja: "1アクション1ツール呼び出し",
    ko: "동작 하나에 도구 호출 하나",
  },
  "patterns.integrate.label": { en: "Integrate", ja: "統合", ko: "통합" },
  "patterns.integrate.title": {
    en: "Works with any LLM",
    ja: "あらゆるLLMに対応",
    ko: "모든 LLM과 호환",
  },
  "security.label": { en: "Security", ja: "セキュリティ", ko: "보안" },
  "security.title": {
    en: "Safe by default",
    ja: "Safe by default",
    ko: "Safe by default",
  },
  "security.sub": {
    en: "Production-grade guardrails for autonomous agents.",
    ja: "自律エージェントのための本番品質ガードレール。",
    ko: "자율 에이전트를 위한 프로덕션 수준의 가드레일.",
  },
  "security.readonly.title": {
    en: "Read-only mode",
    ja: "読み取り専用モード",
    ko: "읽기 전용 모드",
  },
  "security.readonly.desc": {
    en: "Restrict agents to observation only. No clicks, no typing, no navigation — just compressed page state.",
    ja: "エージェントを観察のみに制限。クリック、入力、ナビゲーション不可 — 圧縮されたページ状態のみ。",
    ko: "에이전트를 관찰 전용으로 제한. 클릭, 입력, 탐색 불가 — 압축된 페이지 상태만.",
  },
  "security.filesystem.title": {
    en: "Filesystem confinement",
    ja: "ファイルシステム制限",
    ko: "파일시스템 격리",
  },
  "security.filesystem.desc": {
    en: "Upload and download paths are locked to explicit roots. No access outside your working directory by default.",
    ja: "アップロードとダウンロードパスは明示的なルートに制限。デフォルトでは作業ディレクトリ外にアクセス不可。",
    ko: "업로드 및 다운로드 경로는 명시적 루트로 제한. 기본적으로 작업 디렉토리 외부 접근 불가.",
  },
  "security.validation.title": {
    en: "Input validation",
    ja: "入力検証",
    ko: "입력 검증",
  },
  "security.validation.desc": {
    en: "URLs, selectors, expressions, and file paths are validated before execution. Blocked patterns prevent common injection vectors.",
    ja: "URL、セレクター、式、ファイルパスは実行前に検証。ブロックパターンが一般的なインジェクションを防止。",
    ko: "URL, 선택자, 표현식, 파일 경로는 실행 전 검증. 차단 패턴으로 일반적인 인젝션 방지.",
  },
  "security.local.title": {
    en: "Local CDP only",
    ja: "ローカルCDPのみ",
    ko: "로컬 CDP 전용",
  },
  "security.local.desc": {
    en: "Chrome DevTools Protocol runs over local WebSocket. No remote connections, no cloud dependencies, no data leaves your machine.",
    ja: "Chrome DevTools ProtocolはローカルWebSocketで実行。リモート接続なし、クラウド依存なし、データ漏洩なし。",
    ko: "Chrome DevTools Protocol은 로컬 WebSocket으로 실행. 원격 연결 없음, 클라우드 의존 없음, 데이터 유출 없음.",
  },
  "quickstart.label": {
    en: "Start",
    ja: "開始",
    ko: "시작",
  },
  "quickstart.title": {
    en: "Try it",
    ja: "試す",
    ko: "써보기",
  },
  "qs.cta.title": {
    en: "Surf deeper?",
    ja: "さらに深く？",
    ko: "더 깊이 살펴볼까요?",
  },
  "qs.cta.btn": {
    en: "Read the docs",
    ja: "ドキュメントを読む",
    ko: "문서 보기",
  },
  "step1.title": { en: "Install", ja: "インストール", ko: "설치" },
  "step1.desc": {
    en: "Add @tidesurf/core to your project",
    ja: "プロジェクトに@tidesurf/coreを追加",
    ko: "프로젝트에 @tidesurf/core를 추가합니다",
  },
  "step2.title": { en: "Launch", ja: "起動", ko: "실행" },
  "step2.desc": {
    en: "Start a browser instance",
    ja: "ブラウザインスタンスを開始",
    ko: "브라우저 인스턴스를 시작합니다",
  },
  "step3.title": { en: "Control", ja: "制御", ko: "제어" },
  "step3.desc": {
    en: "Navigate and interact with pages",
    ja: "ページをナビゲートして操作",
    ko: "페이지를 탐색하고 조작합니다",
  },
  "mock.product.aria": {
    en: "Rendered page compressed into TideSurf DOM output",
    ja: "ライブページをTideSurfのDOM出力へ圧縮する例",
    ko: "렌더링된 페이지를 TideSurf DOM 출력으로 압축하는 예시",
  },
  "mock.tokens": { en: "~132 tokens", ja: "約132トークン", ko: "약 132 토큰" },
  "mock.usage.aria": {
    en: "TideSurf usage mock-up",
    ja: "TideSurf利用例のモックアップ",
    ko: "TideSurf 사용 예시 목업",
  },
  "mock.chat": { en: "Chat", ja: "チャット", ko: "채팅" },
  "mock.request": { en: "request", ja: "リクエスト", ko: "요청" },
  "mock.agent": { en: "Agent", ja: "エージェント", ko: "에이전트" },
  "mock.toolLoop": { en: "tool loop", ja: "ツールループ", ko: "도구 루프" },
  "mock.browser": { en: "Browser", ja: "ブラウザ", ko: "브라우저" },
  "mock.pageState": { en: "page state", ja: "ページ状態", ko: "페이지 상태" },
  "try.aria": {
    en: "TideSurf examples",
    ja: "TideSurfの例",
    ko: "TideSurf 예시",
  },
  "try.launch": { en: "Launch", ja: "起動", ko: "실행" },
  "try.connect": { en: "Connect", ja: "接続", ko: "연결" },
  "try.mcp": { en: "MCP", ja: "MCP", ko: "MCP" },
  "hero.shortline": {
    en: "In the modern web era, the tide is strong. Let's surf.",
    ja: "現代のウェブ時代、潮流は激しい。波に乗ろう。",
    ko: "현대 웹 시대, 조류는 거세다. 파도를 타자.",
  },
  "privacy.cookie.text": {
    en: "Cloudflare Analytics only.",
    ja: "Cloudflare Analyticsのみ。",
    ko: "Cloudflare Analytics만 사용합니다.",
  },
  "privacy.cookie.action": { en: "OK", ja: "OK", ko: "확인" },
};

// ── State ──

let currentLang: Language = "en";
let currentTheme: Theme = "dark";
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
    // Ignore storage failures.
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Theme ──

function initTheme(): void {
  const saved = safeStorageGet("tidesurf-theme") as Theme | null;
  currentTheme =
    saved ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light");
  applyTheme();
  document
    .getElementById("theme-toggle")
    ?.addEventListener("click", toggleTheme);
}

function toggleTheme(): void {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  safeStorageSet("tidesurf-theme", currentTheme);
  applyTheme();
}

function applyTheme(): void {
  document.documentElement.setAttribute("data-theme", currentTheme);
}

// ── Language ──

function initLanguage(): void {
  const saved = safeStorageGet("tidesurf-lang") as Language | null;
  currentLang = saved || detectLanguage();
  loadCJKFont(currentLang);
  applyLanguage();

  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const lang = (e.currentTarget as HTMLElement).dataset.lang as Language;
      if (lang && lang !== currentLang) {
        currentLang = lang;
        safeStorageSet("tidesurf-lang", lang);
        loadCJKFont(lang);
        applyLanguage();
        updateLangButtons();
      }
    });
  });
}

function detectLanguage(): Language {
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("ko")) return "ko";
  return "en";
}

function applyLanguage(): void {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key && translations[key]) {
      const text = translations[key][currentLang];
      if (el.hasAttribute("data-i18n-attr")) {
        const attr = el.getAttribute("data-i18n-attr");
        if (attr) el.setAttribute(attr, text);
      } else {
        el.textContent = text;
      }
    }
  });
  document.documentElement.lang = currentLang;
}

function updateLangButtons(): void {
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle(
      "active",
      btn.getAttribute("data-lang") === currentLang,
    );
  });
}

// ── Copy ──

function initCopyButtons(): void {
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const text = (e.currentTarget as HTMLElement).dataset.copy;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        const el = e.currentTarget as HTMLElement;
        el.classList.add("copied");
        const original = el.innerHTML;
        el.innerHTML =
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        setTimeout(() => {
          el.classList.remove("copied");
          el.innerHTML = original;
        }, 1200);
      } catch (err) {
        console.error("Copy failed:", err);
      }
    });
  });
}

// ── Scroll Morph ──

function initScrollMorph(): void {
  const hero = document.querySelector(".hero") as HTMLElement;
    const scrollHint = document.querySelector(".scroll-hint") as HTMLElement;

  if (!hero) return;

  let scrollHintReady = false;
  if (scrollHint) {
    scrollHint.addEventListener(
      "animationend",
      () => {
        scrollHint.style.animation = "none";
        scrollHint.style.opacity = "1";
        scrollHintReady = true;
      },
      { once: true },
    );
  }

  let ticking = false;

  function onScroll(): void {
    if (!ticking) {
      requestAnimationFrame(() => {
        const heroH = hero.offsetHeight;
        const scrolled = window.scrollY;
        const progress = Math.min(1, Math.max(0, scrolled / heroH));


        // Scroll hint: disappears immediately on scroll
        if (scrollHint && scrollHintReady) {
          scrollHint.style.opacity = `${Math.max(0, 1 - progress * 6)}`;
        }

        ticking = false;
      });
      ticking = true;
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
}

// ── Nav Scroll ──

function initNavScroll(): void {
  const nav = document.querySelector(".nav");
  if (!nav) return;
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          nav.classList.toggle("scrolled", window.scrollY > 50);
          ticking = false;
        });
        ticking = true;
      }
    },
    { passive: true },
  );
}

// ── Scroll Reveal ──

function initScrollReveal(): void {
  const revealEls = document.querySelectorAll(".reveal");

  if (prefersReducedMotion()) {
    revealEls.forEach((el) => {
      el.classList.add("is-visible");
    });
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -40px 0px" },
  );
  revealEls.forEach((el) => {
    el.classList.add("is-visible");
    observer.observe(el);
  });
}

// ── Story Motion Budget ──

function initStoryMotion(): void {
  const bands = Array.from(document.querySelectorAll<HTMLElement>(".story-band"));
  if (!bands.length || prefersReducedMotion()) return;

  if (!("IntersectionObserver" in window)) {
    bands.forEach((band) => band.classList.add("is-motion-active"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle("is-motion-active", entry.isIntersecting);
      });
    },
    { threshold: 0.08, rootMargin: "18% 0px 18% 0px" },
  );

  bands.forEach((band) => observer.observe(band));
}

// ── Mobile Menu ──

function initMobileMenu(): void {
  const btn = document.getElementById("mobile-menu-btn") as HTMLButtonElement | null;
  const menu = document.getElementById("mobile-menu") as HTMLElement | null;
  if (!btn || !menu) return;

  const menuLinks = Array.from(menu.querySelectorAll<HTMLAnchorElement>("a"));

  function setMenuInteractive(isOpen: boolean): void {
    const inertMenu = menu as HTMLElement & { inert?: boolean };
    inertMenu.inert = !isOpen;
    menu.toggleAttribute("inert", !isOpen);
    menu.setAttribute("aria-hidden", String(!isOpen));
    menuLinks.forEach((link) => {
      link.tabIndex = isOpen ? 0 : -1;
    });
  }

  function openMenu(): void {
    btn!.setAttribute("aria-expanded", "true");
    setMenuInteractive(true);
    menu!.classList.add("is-open");
  }

  function closeMenu(): void {
    btn!.setAttribute("aria-expanded", "false");
    menu!.classList.remove("is-open");
    setMenuInteractive(false);
  }

  setMenuInteractive(false);

  btn.addEventListener("click", () => {
    const isOpen = btn!.getAttribute("aria-expanded") === "true";
    if (isOpen) closeMenu(); else openMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu!.classList.contains("is-open")) {
      closeMenu();
      btn!.focus();
    }
  });

  menuLinks.forEach((link) => {
    link.addEventListener("click", closeMenu);
  });
}

// ── CJK Font Lazy Loader ──

function loadCJKFont(lang: Language): void {
  if (lang === "ja") {
    if (!document.getElementById("font-noto-jp")) {
      const link = document.createElement("link");
      link.id = "font-noto-jp";
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap";
      document.head.appendChild(link);
    }
  } else if (lang === "ko") {
    if (!document.getElementById("font-noto-kr")) {
      const link = document.createElement("link");
      link.id = "font-noto-kr";
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap";
      document.head.appendChild(link);
    }
  }
}

// ── Init ──

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

// ── Count Up Animation ──

function initCountUp(): void {
  if (prefersReducedMotion()) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target as HTMLElement;
        if (el.dataset.counted) return;
        el.dataset.counted = "true";

        const unitEl = el.querySelector(".bench-stat-unit");
        const unitText = unitEl?.textContent || "";
        const numStr = (el.textContent || "").replace(unitText, "").trim();
        const target = parseFloat(numStr);
        if (isNaN(target)) return;

        const hasDot = numStr.includes(".");
        const decimals = hasDot ? (numStr.split(".")[1]?.length || 1) : 0;
        const dur = 1600;
        const t0 = performance.now();

        function tick(now: number): void {
          const p = Math.min((now - t0) / dur, 1);
          const ease = 1 - Math.pow(1 - p, 4);
          const val = target * ease;
          const display = hasDot
            ? val.toFixed(decimals)
            : String(Math.round(val));
          const tn = el.childNodes[0];
          if (tn?.nodeType === Node.TEXT_NODE) tn.textContent = display;
          if (p < 1) requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
        observer.unobserve(el);
      });
    },
    { threshold: 0.5 },
  );

  document
    .querySelectorAll(".bench-stat-value")
    .forEach((el) => observer.observe(el));
}

// ── Bar Growth Animation ──

function initBenchGraph(): void {
  if (prefersReducedMotion()) return;

  // Use transform: scaleY() instead of height to avoid layout recalculation
  const bars = document.querySelectorAll(".bench-col-bar") as NodeListOf<HTMLElement>;
  bars.forEach((bar) => {
    bar.style.transform = "scaleY(0)";
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const all = entry.target.querySelectorAll(".bench-col-bar") as NodeListOf<HTMLElement>;
        all.forEach((bar, i) => {
          setTimeout(() => {
            bar.style.transform = "scaleY(1)";
          }, i * 60);
        });
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.1 },
  );

  const chart = document.querySelector(".bench-duo") || document.querySelector(".bench-chart");
  if (chart) observer.observe(chart);
}

// ── Try Tabs ──

function initTryTabs(): void {
  const tabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-try-tab]"),
  );
  const panels = Array.from(
    document.querySelectorAll<HTMLElement>("[data-try-panel]"),
  );
  if (!tabs.length || !panels.length) return;

  function activateTab(tab: HTMLButtonElement, focus = false): void {
    const key = tab.dataset.tryTab;
    if (!key) return;

    tabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    });

    panels.forEach((panel) => {
      const active = panel.dataset.tryPanel === key;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });

    if (focus) tab.focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (event) => {
      const last = tabs.length - 1;
      let nextIndex = index;

      if (event.key === "ArrowRight") nextIndex = index === last ? 0 : index + 1;
      else if (event.key === "ArrowLeft") nextIndex = index === 0 ? last : index - 1;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = last;
      else return;

      event.preventDefault();
      activateTab(tabs[nextIndex], true);
    });
  });
}

function initHeroVerbCycle(): void {
  const slot = document.querySelector<HTMLElement>(".hero-verb-slot");
  const current = document.getElementById("hero-verb-current");
  const next = document.getElementById("hero-verb-next");
  if (!slot || !current || !next) return;

  const verbs = ["SURF", "BROWSE", "INTERACT", "CLICK", "ENTER"];
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let index = 0;
  let switching = false;
  window.setInterval(() => {
    if (switching) return;
    const nextIndex = (index + 1) % verbs.length;
    switching = true;
    next.textContent = verbs[nextIndex];
    slot.classList.add("is-switching");
    window.setTimeout(() => {
      slot.classList.add("is-resetting");
      index = nextIndex;
      current.textContent = verbs[index];
      next.textContent = "";
      slot.classList.remove("is-switching");
      void slot.offsetHeight;
      window.requestAnimationFrame(() => {
        slot.classList.remove("is-resetting");
        switching = false;
      });
    }, 460);
  }, 3000);
}

function initCookieNotice(): void {
  const notice = document.getElementById("cookie-note");
  const dismiss = document.getElementById("cookie-dismiss");
  if (!notice || !dismiss) return;

  if (safeStorageGet("tidesurf-cookie-note") === "dismissed") return;

  notice.classList.remove("is-hidden");
  dismiss.addEventListener("click", () => {
    safeStorageSet("tidesurf-cookie-note", "dismissed");
    notice.classList.add("is-hidden");
  });
}

function initMotionModal(): void {
  const modal = document.getElementById("motion-modal");
  const title = document.getElementById("motion-modal-title");
  const body = document.getElementById("motion-modal-body");
  const triggers = Array.from(
    document.querySelectorAll<HTMLElement>("[data-motion-modal]"),
  );
  if (!modal || !title || !body || !triggers.length) return;

  let lastTrigger: HTMLElement | null = null;

  function closeModal(): void {
    modal.setAttribute("aria-hidden", "true");
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    lastTrigger?.focus();
  }

  function openModal(trigger: HTMLElement): void {
    lastTrigger = trigger;
    title.textContent = trigger.dataset.modalTitle || "";
    body.textContent = trigger.dataset.modalBody || "";
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    modal.querySelector<HTMLButtonElement>(".motion-modal-close")?.focus();
  }

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", () => openModal(trigger));
    trigger.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openModal(trigger);
    });
  });

  modal.querySelectorAll<HTMLElement>("[data-motion-close]").forEach((item) => {
    item.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.getAttribute("aria-hidden") === "false") {
      closeModal();
    }
  });
}

function initComparisonDemo(): void {
  const demo = document.querySelector<HTMLElement>("[data-comparison-demo]");
  if (!demo) return;

  demo.addEventListener("click", () => {
    demo.classList.toggle("is-comparing");
  });

  demo.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    demo.classList.toggle("is-comparing");
  });
}

async function init(): Promise<void> {
  initScrollMorph();
  initTheme();
  initLanguage();
  initCopyButtons();
  initHeroVerbCycle();
  initMotionModal();
  initComparisonDemo();
  initNavScroll();
  initMobileMenu();
  initScrollReveal();
  initStoryMotion();
  initCountUp();
  initBenchGraph();
  initTryTabs();
  initPkgCycle();
  initCookieNotice();
  updateLangButtons();
  await initGitHubStars();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}

function initPkgCycle() {
  const cycle = document.querySelector<HTMLElement>(".pkg-cycle");
  const commandText = document.getElementById("install-command-text");
  const copyBtn = document.getElementById("install-copy-btn");
  if (!cycle || !commandText || !copyBtn) return;

  const commands = [
    "bun add @tidesurf/core",
    "npm install @tidesurf/core",
    "yarn add @tidesurf/core",
    "pnpm add @tidesurf/core",
  ];

  let currentIndex = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function step(): void {
    currentIndex = (currentIndex + 1) % commands.length;
    cycle!.classList.add("is-switching");
    window.setTimeout(() => {
      const command = commands[currentIndex];
      commandText!.textContent = command;
      copyBtn!.setAttribute("data-copy", command);
      cycle!.classList.remove("is-switching");
    }, 170);
  }

  // Only run the cycle when the hero is visible — saves CPU on scroll
  const hero = document.querySelector(".hero");
  if (hero) {
    new IntersectionObserver((entries) => {
      const visible = entries[0].isIntersecting;
      if (visible && !intervalId) {
        intervalId = setInterval(step, 3000);
      } else if (!visible && intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }).observe(hero);
  } else {
    intervalId = setInterval(step, 3000);
  }
}
