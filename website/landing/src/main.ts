// TideSurf Landing

type Language = "en" | "ja" | "ko";
type Theme = "light" | "dark";

interface Translations {
  [key: string]: { en: string; ja: string; ko: string };
}

const translations: Translations = {
  "nav.docs": { en: "Docs", ja: "ドキュメント", ko: "문서" },
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
    en: "Your agent does not need eyes to browse.",
    ja: "LLM向けDOM圧縮。不要な要素を除去し、ナビゲート、操作、抽出を実現。",
    ko: "LLM을 위한 DOM 압축. 불필요한 요소를 제거하고 탐색, 상호작용, 추출을 수행합니다.",
  },
  "compare.label": { en: "How it works", ja: "仕組み", ko: "동작 원리" },
  "compare.headline": {
    en: "HTML in, text out",
    ja: "HTMLを入れて、テキストを出す",
    ko: "HTML을 넣으면, 텍스트가 나온다",
  },
  "compare.desc": {
    en: "TideSurf strips wrapper elements, classes, scripts and styles. What's left is clean, compact text that any LLM can consume.",
    ja: "TideSurfはラッパー要素、クラス、スクリプト、スタイルを除去。残るのは、どのLLMでも消費できるクリーンでコンパクトなテキストです。",
    ko: "래퍼 요소, 클래스, 스크립트, 스타일을 모두 걷어내고 LLM이 바로 이해할 수 있는 깔끔하고 압축된 텍스트만 남깁니다.",
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
    ja: "少ないトークン、低いコスト",
    ko: "적은 토큰, 낮은 비용",
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
    ko: "에이전트가 읽는 모든 토큰에는 비용이 발생하며 컨텍스트 윈도우를 소모합니다. 원본 HTML로 84,236 토큰인 GitHub 페이지가 TideSurf에서는 단 2,593 토큰으로 — 32배 압축됩니다. 한 페이지로 컨텍스트가 가득 차는 것이 아니라 수십 페이지를 탐색할 수 있습니다.",
  },
  "bench.how.title": { en: "How we measure", ja: "測定方法", ko: "측정 방법" },
  "bench.how.body": {
    en: "We launch headless Chrome, navigate to each site, and compare the full rendered DOM against TideSurf's compressed output. Token counts use cl100k_base estimation. No cherry-picking — these are live pages, measured as-is.",
    ja: "ヘッドレスChromeを起動し、各サイトに遷移して、レンダリング済みDOMとTideSurfの圧縮出力を比較しています。トークン数はcl100k_base推定を使用しています。意図的な選別はしていません。すべて実際のページをそのまま計測しています。",
    ko: "헤드리스 Chrome을 실행하여 각 사이트에 접속한 후, 렌더링된 전체 DOM과 TideSurf의 압축 출력을 비교합니다. 토큰 수는 cl100k_base 추정을 사용합니다. 의도적인 선별 없이 실제 페이지를 있는 그대로 측정합니다.",
  },
  "bench.varies.title": {
    en: "Compression varies",
    ja: "圧縮率はサイトによって異なります",
    ko: "압축률은 사이트마다 다릅니다",
  },
  "bench.varies.body": {
    en: "Heavy sites like GitHub (deep nesting, SVGs, generated classes) see 32x compression. Even lean sites like Hacker News still achieve 8x thanks to the compact output format, URL compression, and text truncation.",
    ja: "GitHubのように重いサイト（深いネスト、SVG、自動生成クラス）は32倍の圧縮を実現します。Hacker Newsのような軽量なサイトでも、コンパクトな出力形式、URL圧縮、テキスト切り詰めにより8倍の圧縮を達成します。",
    ko: "GitHub처럼 무거운 사이트(깊은 중첩, SVG, 자동 생성 클래스)는 32배 압축됩니다. Hacker News처럼 가벼운 사이트도 압축된 출력 형식, URL 압축, 텍스트 트렁케이션 덕분에 8배 압축을 달성합니다.",
  },
  "features.label": { en: "Features", ja: "機能", ko: "기능" },
  "features.title": {
    en: "What ships",
    ja: "搭載機能",
    ko: "제공 기능",
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
    ko: "최대 토큰 수를 지정하면, 인터랙티브 요소와 핵심 콘텐츠를 우선 배치하고 나머지는 자동으로 제거합니다.",
  },
  "feature.mcp.title": { en: "MCP server", ja: "MCPサーバー", ko: "MCP 서버" },
  "feature.mcp.desc": {
    en: "Ships with a Model Context Protocol server. Directly drop into any agent.",
    ja: "Model Context Protocolサーバーを同梱。任意のMCPクライアントにドロップイン",
    ko: "Model Context Protocol 서버가 기본 내장되어 있어, 추가적 연결 과정이 필요 없습니다.",
  },
  "feature.typescript.title": {
    en: "TypeScript-first",
    ja: "TypeScriptファースト",
    ko: "TypeScript 우선",
  },
  "feature.typescript.desc": {
    en: "Full type definitions and error classes are built-in. Built for Bun, also works with Node",
    ja: "完全な型定義とエラークラスが内蔵されています。Bun用に構築され、Nodeでも動作",
    ko: "완전한 Type 정의와 클래스가 포함되었습니다. Bun 채택으로 속도와 호환성을 만족합니다.",
  },
  "feature.autoconnect.title": {
    en: "Auto Connect",
    ja: "オートコネクト",
    ko: "자동 연결",
  },
  "feature.autoconnect.desc": {
    en: "Connect to an already-running Chrome instead of launching a new one. Re-use logged-in sessions, debug live pages, seamlessly hand off between manual browsing and agent control",
    ja: "新しいChromeを起動する代わりに、既に実行中のChromeに接続。ログイン済みセッションの再利用、ライブページのデバッグ、手動ブラウジングとエージェント制御のシームレスな切り替え",
    ko: "새 Chrome을 실행하는 대신 이미 실행 중인 Chrome에 연결합니다. 로그인된 세션 재사용, 라이브 페이지 디버깅, 수동 브라우징과 에이전트 제어 간의 원활한 전환",
  },
  "patterns.title": {
    en: "Built for agents",
    ja: "エージェントのために",
    ko: "에이전트를 위해",
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
  "security.title": {
    en: "Safe by default",
    ja: "デフォルトで安全",
    ko: "기본부터 안전",
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
    ko: "에이전트를 관찰 전용으로 제한. 클릭, 입력, 내비게이션 불가 — 압축된 페이지 상태만.",
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
    en: "Three lines",
    ja: "たった3行",
    ko: "단 3줄",
  },
  "qs.cta.title": {
    en: "Surf deeper?",
    ja: "もっと深く?",
    ko: "더 깊이?",
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
    ko: "페이지를 탐색하고 상호작용합니다",
  },
  "bento.tools.title": { en: "Tools", ja: "ツール", ko: "도구" },
  "bento.tools.desc": {
    en: "18 tool schemas that map directly to LLM function calling. Click elements, fill forms, scroll, extract data. Works with OpenAI, Claude, Gemini, or local models.",
    ja: "LLMの関数呼び出しに直接マッピングされる18のツールスキーマ。要素のクリック、フォーム入力、スクロール、データ抽出。OpenAI、Claude、Gemini、ローカルモデルに対応。",
    ko: "LLM 함수 호출에 직접 매핑되는 18가지 도구 스키마. 요소 클릭, 폼 작성, 스크롤, 데이터 추출. OpenAI, Claude, Gemini, 로컬 모델과 호환.",
  },
  "bento.budget.title": {
    en: "Token Budget",
    ja: "トークン予算",
    ko: "토큰 예산",
  },
  "bento.budget.desc": {
    en: "Set a ceiling. Buttons, links, and inputs survive. Wrappers and decoration get cut by priority.",
    ja: "上限を設定。ボタン、リンク、入力は維持。ラッパーや装飾は優先度に基づいて削除。",
    ko: "상한을 설정하면 버튼, 링크, 입력은 유지되고 래퍼와 장식은 우선순위에 따라 제거됩니다.",
  },
  "bento.autoconnect.title": {
    en: "Auto-connect",
    ja: "オートコネクト",
    ko: "자동 연결",
  },
  "bento.autoconnect.desc": {
    en: "Skip the login flows. Attach to your running Chrome \u2014 sessions, cookies, and auth carry over.",
    ja: "ログインフローをスキップ。実行中のChromeに接続 \u2014 セッション、Cookie、認証はそのまま引き継ぎ。",
    ko: "로그인 과정을 건너뛰세요. 실행 중인 Chrome에 연결 \u2014 세션, 쿠키, 인증이 그대로 유지됩니다.",
  },
  "bento.plugin.title": { en: "Plug in", ja: "プラグイン", ko: "플러그인" },
  "bento.plugin.desc": {
    en: "Drop into any MCP-compatible agent.",
    ja: "任意のMCP対応エージェントに導入。",
    ko: "모든 MCP 호환 에이전트에 바로 연결.",
  },
  "hero.shortline": {
    en: "In the modern web era, the tide is strong. Let's surf.",
    ja: "現代のウェブ時代、潮流は激しい。波に乗ろう。",
    ko: "현대 웹 시대, 조류는 거세다. 파도를 타자.",
  },
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
  applyLanguage();

  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const lang = (e.currentTarget as HTMLElement).dataset.lang as Language;
      if (lang && lang !== currentLang) {
        currentLang = lang;
        safeStorageSet("tidesurf-lang", lang);
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
  if (prefersReducedMotion()) {
    document.querySelectorAll(".reveal").forEach((el) => {
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
  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
}

// ── Code Wall ──

interface CodeLine {
  tag: string;
  attrs: string[];
  content?: string;
  isSemantic: boolean;
  indent: number;
}

const codeTemplates: CodeLine[] = [
  { tag: "!DOCTYPE", attrs: ['html'], isSemantic: false, indent: 0 },
  { tag: "html", attrs: ['lang="en"', 'class="scroll-smooth"'], isSemantic: false, indent: 0 },
  { tag: "head", attrs: [], isSemantic: false, indent: 1 },
  { tag: "meta", attrs: ['charset="UTF-8"'], isSemantic: false, indent: 2 },
  { tag: "title", attrs: [], isSemantic: true, indent: 2, content: "My Website" },
  { tag: "/title", attrs: [], isSemantic: true, indent: 2 },
  { tag: "link", attrs: ['rel="stylesheet"', 'href="/styles.css"'], isSemantic: false, indent: 2 },
  { tag: "/head", attrs: [], isSemantic: false, indent: 1 },
  { tag: "body", attrs: ['class="antialiased"'], isSemantic: false, indent: 1 },
  { tag: "header", attrs: ['class="fixed top-0"'], isSemantic: true, indent: 2 },
  { tag: "nav", attrs: ['class="container mx-auto"'], isSemantic: true, indent: 3 },
  { tag: "a", attrs: ['href="/"', 'class="text-xl font-bold"'], isSemantic: true, indent: 4, content: "Logo" },
  { tag: "ul", attrs: ['class="flex gap-8"'], isSemantic: true, indent: 4 },
  { tag: "li", attrs: [], isSemantic: true, indent: 5 },
  { tag: "a", attrs: ['href="/features"'], isSemantic: true, indent: 6, content: "Features" },
  { tag: "/li", attrs: [], isSemantic: true, indent: 5 },
  { tag: "li", attrs: [], isSemantic: true, indent: 5 },
  { tag: "a", attrs: ['href="/pricing"'], isSemantic: true, indent: 6, content: "Pricing" },
  { tag: "/li", attrs: [], isSemantic: true, indent: 5 },
  { tag: "/ul", attrs: [], isSemantic: true, indent: 4 },
  { tag: "button", attrs: ['type="button"', 'class="md:hidden"'], isSemantic: true, indent: 4 },
  { tag: "/button", attrs: [], isSemantic: true, indent: 4 },
  { tag: "/nav", attrs: [], isSemantic: true, indent: 3 },
  { tag: "/header", attrs: [], isSemantic: true, indent: 2 },
  { tag: "main", attrs: [], isSemantic: true, indent: 2 },
  { tag: "section", attrs: ['class="py-20"'], isSemantic: true, indent: 3 },
  { tag: "div", attrs: ['class="container"'], isSemantic: false, indent: 4 },
  { tag: "h1", attrs: ['class="text-4xl font-bold"'], isSemantic: true, indent: 5, content: "Welcome" },
  { tag: "/h1", attrs: [], isSemantic: true, indent: 5 },
  { tag: "p", attrs: ['class="text-lg text-gray-600"'], isSemantic: true, indent: 5, content: "Build faster" },
  { tag: "/p", attrs: [], isSemantic: true, indent: 5 },
  { tag: "div", attrs: ['class="flex gap-4"'], isSemantic: false, indent: 5 },
  { tag: "a", attrs: ['href="/signup"', 'class="btn btn-primary"'], isSemantic: true, indent: 6, content: "Get Started" },
  { tag: "/a", attrs: [], isSemantic: true, indent: 6 },
  { tag: "a", attrs: ['href="/demo"', 'class="btn btn-secondary"'], isSemantic: true, indent: 6, content: "View Demo" },
  { tag: "/a", attrs: [], isSemantic: true, indent: 6 },
  { tag: "/div", attrs: [], isSemantic: false, indent: 5 },
  { tag: "/div", attrs: [], isSemantic: false, indent: 4 },
  { tag: "/section", attrs: [], isSemantic: true, indent: 3 },
  { tag: "section", attrs: ['class="py-20 bg-gray-50"'], isSemantic: true, indent: 3 },
  { tag: "div", attrs: ['class="container"'], isSemantic: false, indent: 4 },
  { tag: "h2", attrs: ['class="text-3xl font-bold"'], isSemantic: true, indent: 5, content: "Features" },
  { tag: "/h2", attrs: [], isSemantic: true, indent: 5 },
  { tag: "div", attrs: ['class="grid md:grid-cols-3 gap-8"'], isSemantic: false, indent: 5 },
  { tag: "article", attrs: ['class="p-6 rounded-xl border"'], isSemantic: true, indent: 6 },
  { tag: "h3", attrs: ['class="text-xl font-semibold"'], isSemantic: true, indent: 7, content: "Fast" },
  { tag: "/h3", attrs: [], isSemantic: true, indent: 7 },
  { tag: "p", attrs: ['class="text-gray-600"'], isSemantic: true, indent: 7, content: "Optimized" },
  { tag: "/p", attrs: [], isSemantic: true, indent: 7 },
  { tag: "/article", attrs: [], isSemantic: true, indent: 6 },
  { tag: "/div", attrs: [], isSemantic: false, indent: 5 },
  { tag: "/div", attrs: [], isSemantic: false, indent: 4 },
  { tag: "/section", attrs: [], isSemantic: true, indent: 3 },
  { tag: "section", attrs: ['class="py-20"'], isSemantic: true, indent: 3 },
  { tag: "div", attrs: ['class="container max-w-md"'], isSemantic: false, indent: 4 },
  { tag: "form", attrs: ['action="/subscribe"', 'method="POST"'], isSemantic: true, indent: 5 },
  { tag: "label", attrs: ['for="email"'], isSemantic: true, indent: 6, content: "Email" },
  { tag: "/label", attrs: [], isSemantic: true, indent: 6 },
  { tag: "input", attrs: ['type="email"', 'id="email"', 'placeholder="you@example.com"'], isSemantic: true, indent: 6 },
  { tag: "button", attrs: ['type="submit"'], isSemantic: true, indent: 6, content: "Subscribe" },
  { tag: "/button", attrs: [], isSemantic: true, indent: 6 },
  { tag: "/form", attrs: [], isSemantic: true, indent: 5 },
  { tag: "/div", attrs: [], isSemantic: false, indent: 4 },
  { tag: "/section", attrs: [], isSemantic: true, indent: 3 },
  { tag: "section", attrs: ['class="py-20"'], isSemantic: true, indent: 3 },
  { tag: "div", attrs: ['class="container"'], isSemantic: false, indent: 4 },
  { tag: "table", attrs: ['class="w-full"'], isSemantic: true, indent: 5 },
  { tag: "thead", attrs: [], isSemantic: true, indent: 6 },
  { tag: "tr", attrs: [], isSemantic: true, indent: 7 },
  { tag: "th", attrs: [], isSemantic: true, indent: 8, content: "Name" },
  { tag: "/th", attrs: [], isSemantic: true, indent: 8 },
  { tag: "th", attrs: [], isSemantic: true, indent: 8, content: "Status" },
  { tag: "/th", attrs: [], isSemantic: true, indent: 8 },
  { tag: "/tr", attrs: [], isSemantic: true, indent: 7 },
  { tag: "/thead", attrs: [], isSemantic: true, indent: 6 },
  { tag: "tbody", attrs: [], isSemantic: true, indent: 6 },
  { tag: "tr", attrs: [], isSemantic: true, indent: 7 },
  { tag: "td", attrs: [], isSemantic: true, indent: 8, content: "Alice" },
  { tag: "/td", attrs: [], isSemantic: true, indent: 8 },
  { tag: "td", attrs: [], isSemantic: true, indent: 8, content: "Active" },
  { tag: "/td", attrs: [], isSemantic: true, indent: 8 },
  { tag: "/tr", attrs: [], isSemantic: true, indent: 7 },
  { tag: "/tbody", attrs: [], isSemantic: true, indent: 6 },
  { tag: "/table", attrs: [], isSemantic: true, indent: 5 },
  { tag: "/div", attrs: [], isSemantic: false, indent: 4 },
  { tag: "/section", attrs: [], isSemantic: true, indent: 3 },
  { tag: "footer", attrs: ['class="bg-gray-900 text-white py-12"'], isSemantic: true, indent: 2 },
  { tag: "div", attrs: ['class="container"'], isSemantic: false, indent: 3 },
  { tag: "p", attrs: ['class="text-center"'], isSemantic: true, indent: 4, content: "© 2025" },
  { tag: "/p", attrs: [], isSemantic: true, indent: 4 },
  { tag: "/div", attrs: [], isSemantic: false, indent: 3 },
  { tag: "/footer", attrs: [], isSemantic: true, indent: 2 },
  { tag: "/body", attrs: [], isSemantic: false, indent: 1 },
  { tag: "/html", attrs: [], isSemantic: false, indent: 0 },
];

const interactiveTags = new Set(["a", "button", "input", "form", "select", "textarea", "label"]);

function generateHTMLSnippet(startIndex: number, length: number): string {
  let html = "";
  for (let i = 0; i < length; i++) {
    const template = codeTemplates[(startIndex + i) % codeTemplates.length];
    const indent = "  ".repeat(Math.min(template.indent, 4));
    const isClosing = template.tag.startsWith("/");
    const isSelfClosing = ["input", "img", "br", "hr", "meta", "link", "path"].includes(template.tag);
    
    html += indent;
    html += `&lt;`;
    if (isClosing) {
      html += `/${template.tag.slice(1)}`;
    } else {
      html += `${template.tag}`;
    }
    
    const visibleAttrs = template.attrs.slice(0, 1 + (i % 2));
    visibleAttrs.forEach(attr => {
      const eqIndex = attr.indexOf("=");
      if (eqIndex > 0) {
        const name = attr.slice(0, eqIndex);
        const value = attr.slice(eqIndex + 1);
        const highlightedValue = value.replace(/"/g, '<span class="cw-string">"</span>');
        html += ` <span class="cw-attr">${name}</span>=<span class="cw-value">${highlightedValue}</span>`;
      } else {
        html += ` <span class="cw-attr">${attr}</span>`;
      }
    });
    
    if (template.attrs.length > visibleAttrs.length) {
      html += `<span class="cw-attr">...</span>`;
    }
    
    html += `${isSelfClosing ? " /" : ""}&gt;`;
    
    if (template.content && !isClosing) {
      html += `<span class="cw-content">${escapeHtml(template.content)}</span>`;
      if (!isSelfClosing) {
        html += `&lt;/${template.tag}&gt;`;
      }
    }
    
    html += "  ";
  }
  return html;
}

function initCodeWall(): void {
  const container = document.getElementById("code-wall");
  if (!container) return;

  const stripCount = 10;
  const snippetLength = 25;
  
  for (let i = 0; i < stripCount; i++) {
    const strip = document.createElement("div");
    strip.className = "code-wall-strip";
    
    const startOffset = Math.floor(Math.random() * codeTemplates.length);
    
    const hasSemantic = codeTemplates.slice(startOffset, startOffset + 5).some(t => t.isSemantic);
    const hasInteractive = codeTemplates.slice(startOffset, startOffset + 5).some(t => interactiveTags.has(t.tag));
    
    if (hasSemantic) {
      strip.classList.add("is-semantic");
    }
    if (hasInteractive) {
      strip.classList.add("is-interactive");
    }
    
    const content = document.createElement("div");
    content.className = "code-wall-content";
    
    const snippet = generateHTMLSnippet(startOffset, snippetLength);
    content.innerHTML = snippet + "    " + snippet;

    const y = Math.round(i * (100 / stripCount));
    
    let baseOpacity = 0.12;
    if (hasInteractive) baseOpacity = 0.22;
    else if (hasSemantic) baseOpacity = 0.17;

    const opacity = baseOpacity + Math.random() * 0.06;
    
    const duration = 600 + Math.random() * 400;
    const startOffsetPx = Math.random() * -2000;
    
    strip.style.cssText = `
      --y: ${y}vh;
      --o: ${opacity};
      --o-highlight: ${opacity + 0.15};
      top: var(--y);
    `;
    
    content.style.cssText = `
      --duration: ${duration}s;
      --start-offset: ${startOffsetPx}px;
      --play-state: running;
      padding-left: var(--start-offset);
    `;
    
    strip.appendChild(content);
    container.appendChild(strip);
  }

  // Pause animations when hero is not visible (huge perf win)
  const heroEl = document.querySelector(".hero");
  if (heroEl) {
    new IntersectionObserver((entries) => {
      container.classList.toggle("paused", !entries[0].isIntersecting);
    }).observe(heroEl);
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

  const bars = document.querySelectorAll(".bench-col-bar") as NodeListOf<HTMLElement>;
  bars.forEach((bar) => {
    bar.dataset.h = bar.style.height;
    bar.style.height = "0";
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const all = entry.target.querySelectorAll(".bench-col-bar") as NodeListOf<HTMLElement>;
        all.forEach((bar, i) => {
          setTimeout(() => {
            bar.style.height = bar.dataset.h || "0";
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

// ── Bento Popup ──

function initBentoPopup(): void {
  const modal = document.getElementById("bento-modal");
  const content = document.getElementById("bento-modal-content");
  if (!modal || !content) return;

  function openModal(card: HTMLElement): void {
    const clone = card.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[hidden]").forEach((el) => el.removeAttribute("hidden"));
    content.innerHTML =
      '<button class="bento-modal-close" aria-label="Close">\u00d7</button>' +
      clone.innerHTML;
    content.querySelector(".bento-modal-close")?.addEventListener("click", closeModal);
    modal.classList.add("is-open");
  }

  function closeModal(): void {
    modal!.classList.remove("is-open");
  }

  document.querySelectorAll(".bento-card").forEach((card) => {
    (card as HTMLElement).style.cursor = "pointer";
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      openModal(card as HTMLElement);
    });
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal!.classList.contains("is-open")) closeModal();
  });
}

async function init(): Promise<void> {
  initCodeWall();
  initScrollMorph();
  initTheme();
  initLanguage();
  initCopyButtons();
  initNavScroll();
  initScrollReveal();
  initCountUp();
  initBenchGraph();
  initBentoPopup();
  initPkgCycle();
  updateLangButtons();
  await initGitHubStars();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}

function initPkgCycle() {
  const track = document.getElementById("pkg-track");
  const copyBtn = document.getElementById("install-copy-btn");
  if (!track || !copyBtn) return;

  const commands = [
    "bun add @tidesurf/core",
    "npm i @tidesurf/core",
    "yarn add @tidesurf/core",
    "pnpm add @tidesurf/core",
  ];
  
  let currentIndex = 0;
  const itemHeight = track.firstElementChild?.clientHeight || track.getBoundingClientRect().height / 5 || 24;

  setInterval(() => {
    currentIndex++;
    track.style.transition = "transform 0.45s cubic-bezier(0.23, 1, 0.32, 1)";
    track.style.transform = `translateY(-${currentIndex * itemHeight}px)`;

    const cmdIndex = currentIndex % commands.length;
    copyBtn.setAttribute("data-copy", commands[cmdIndex]);
    
    // Check if the current visible text has changed in translations if applicable, otherwise keep it English
    // Or we leave text as is since we just shift the div. The copy button holds the actual data to strip.

    if (currentIndex === commands.length) {
      setTimeout(() => {
        track.style.transition = "none";
        track.style.transform = "translateY(0)";
        currentIndex = 0;
      }, 500);
    }
  }, 3000);
}
