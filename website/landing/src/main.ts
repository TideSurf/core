import "./style.css";

// TideSurf Landing main script

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
  "hero.tagline": {
    en: "DOM-to-text for browser agents.",
    ja: "ブラウザエージェント向けのDOM-to-text。",
    ko: "브라우저 에이전트를 위한 DOM-to-text.",
  },
  "hero.lede": {
    en: "TideSurf turns live pages into a compact control surface for LLMs, so agents can read more, click stable IDs, and stay on local CDP instead of pixel guessing.",
    ja: "TideSurfはライブページをLLM用の小さな操作面に変換します。より多くを読み、安定したIDをクリックし、ピクセル推測ではなくローカルCDPで動きます。",
    ko: "TideSurf는 라이브 페이지를 LLM용 작은 제어면으로 바꿉니다. 에이전트가 더 많이 읽고, 안정적인 ID를 클릭하고, 픽셀 추측 대신 로컬 CDP로 움직이게 합니다.",
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
  "compare.raw": { en: "raw DOM", ja: "원본 DOM", ko: "원본 DOM" },
  "compare.tidesurf": {
    en: "TideSurf",
    ja: "TideSurf",
    ko: "TideSurf",
  },
  "bento.connect.title": { en: "Connect", ja: "연결", ko: "연결" },
  "bento.connect.desc": {
    en: "Attach to Chromium over CDP. Launch headless or use a browser you already trust.",
    ja: "CDP経由でChromiumに接続。ヘッドレスで起動するか、信頼している既存ブラウザを使えます。",
    ko: "CDP로 Chromium에 연결합니다. 헤드리스로 실행하거나 이미 신뢰하는 브라우저를 그대로 씁니다.",
  },
  "bento.compress.title": { en: "Compress", ja: "압축", ko: "압축" },
  "bento.compress.desc": {
    en: "Give the model the page, not the markup landfill. Keep enough context for another task.",
    ja: "モデルにページを渡し、マークアップの山は渡しません。次の作業のための文脈を残します。",
    ko: "모델에는 페이지를 주고, 마크업 더미는 주지 않습니다. 다음 작업을 위한 컨텍스트를 남깁니다.",
  },
  "bento.act.title": { en: "Act", ja: "실행", ko: "실행" },
  "bento.act.desc": {
    en: "The model picks L3 or B1. TideSurf clicks through DevTools with no brittle selector ritual.",
    ja: "モデルはL3やB1を選ぶだけ。TideSurfがDevTools経由でクリックし、壊れやすいセレクタ儀式を避けます。",
    ko: "모델은 L3나 B1을 고릅니다. TideSurf가 DevTools로 클릭하고 깨지기 쉬운 셀렉터 의식을 줄입니다.",
  },
  "bento.ids.title": { en: "Stable IDs across navigations", ja: "이동 중에도 유지되는 안정적인 ID", ko: "이동 중에도 유지되는 안정적인 ID" },
  "bento.ids.desc": {
    en: "Element references stay short and predictable as L1, B2, and L3. The loop stays getState() → LLM → click().",
    ja: "要素の参照はL1、B2、L3として永続化: getState() → LLM → click()と同じリズムです。",
    ko: "요소 참조가 L1, B2, L3로 유지됩니다: getState() → LLM → click()과 동일한 리듬입니다.",
  },
  "patterns.label": { en: "Patterns", ja: "パターン", ko: "패턴" },
  "patterns.title": {
    en: "The agent loop",
    ja: "エージェントループ",
    ko: "에이전트 루프",
  },
  "patterns.sub": {
    en: "TideSurf keeps the loop simple: read compressed page text, decide, act, then call the next tool.",
    ja: "TideSurfは getState() → LLM → click() の実行環境です。圧縮されたページテキストを読み、判断し、実行する: ほかのツールと同じリズムです。",
    ko: "TideSurf는 getState() → LLM → click() 실행 환경입니다. 압축된 페이지 텍스트를 읽고, 판단하고, 실행하는 과정은 다른 도구와 같습니다.",
  },
  "mock.chat": { en: "Chat", ja: "チャット", ko: "채팅" },
  "mock.pageState": { en: "Page state", ja: "ページ状態", ko: "페이지 상태" },
  "mock.agent": { en: "Agent", ja: "エージェント", ko: "에이전트" },
  "mock.usage.aria": {
    en: "TideSurf usage mock-up",
    ja: "TideSurf利用例のモックアップ",
    ko: "TideSurf 사용 예시 목업",
  },
  "metric.tokens.num": { en: "32×", ja: "32×", ko: "32×" },
  "metric.tokens.label": {
    en: "fewer tokens",
    ja: "トークン削減",
    ko: "토큰 절약",
  },
  "metric.time.num": { en: "<25ms", ja: "<25ms", ko: "<25ms" },
  "metric.time.label": {
    en: "parse time",
    ja: "解析時間",
    ko: "파싱 시간",
  },
  "metric.screenshots.num": { en: "0", ja: "0", ko: "0" },
  "metric.screenshots.label": {
    en: "screenshots",
    ja: "スクリーンショット",
    ko: "스크린샷",
  },
  "metric.ids.num": { en: "L1, B2", ja: "L1, B2", ko: "L1, B2" },
  "metric.ids.label": {
    en: "stable IDs",
    ja: "安定したID",
    ko: "안정적인 ID",
  },
  "features.title": {
    en: "What ships in one package",
    ja: "1つのパッケージに含まれるもの",
    ko: "패키지 구성 요소",
  },
  "ship.desc": {
    en: "TideSurf is a small TypeScript library for Bun and Node. It includes direct CDP tools, token budgets, tab lifecycle, content extraction, and MCP wiring.",
    ja: "TideSurfはBunとNode向けの小さなTypeScriptライブラリです：直接のCDPツール、トークン予算、タブのライフサイクル、コンテンツ抽出、MCP接続。ローカルWebSocketのみ。",
    ko: "TideSurf는 Bun 및 Node용 소형 TypeScript 라이브러리입니다: 직접 CDP 도구, 토큰 예산, 탭 라이프사이클, 콘텐츠 추출, MCP 연결. 로컬 WebSocket 전용.",
  },
  "ship.note": {
    en: "Use read-only mode, path confinement, and input validation when you need guardrails. Built for engineers making function-calling browser agents.",
    ja: "ガードレールが必要な場合の読み取り専用モード、パス制限、および入力検証。関数呼び出しブラウザエージェントを構築するエンジニア向け: 単発のスクレイピングやピクセルQAではありません。",
    ko: "가드레일이 필요할 때 사용할 수 있는 읽기 전용 모드, 경로 격리, 입력 검증. 함수 호출 브라우저 에이전트를 빌드하는 엔지니어를 위함: 일회성 크롤링이나 픽셀 QA용이 아닙니다.",
  },
  "quickstart.title": {
    en: "Start building",
    ja: "개발 시작하기",
    ko: "시작하기",
  },
  "try.aria": {
    en: "TideSurf examples",
    ja: "TideSurfの例",
    ko: "TideSurf 예시",
  },
  "try.launch": { en: "Launch", ja: "起動", ko: "실행" },
  "try.connect": { en: "Connect", ja: "接続", ko: "연결" },
  "try.mcp": { en: "MCP", ja: "MCP", ko: "MCP" },
  "try.lede": {
    en: "Install, launch a browser, and read your first page in a few lines.",
    ja: "インストールし、ブラウザを起動して、数行で最初のページを読み込みます。",
    ko: "설치하고 브라우저를 실행하여 몇 줄 만에 첫 페이지를 읽어보세요.",
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

// ── Theme ──

function initTheme(): void {
  const saved = safeStorageGet("tidesurf-theme") as Theme | null;
  currentTheme =
    saved ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light");
  applyTheme();

  document.querySelectorAll(".theme-btn[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = (btn as HTMLElement).dataset.theme as Theme;
      if (theme) {
        currentTheme = theme;
        safeStorageSet("tidesurf-theme", theme);
        applyTheme();
      }
    });
  });
}

function applyTheme(): void {
  document.documentElement.setAttribute("data-theme", currentTheme);
  document.querySelectorAll(".theme-btn[data-theme]").forEach((btn) => {
    btn.classList.toggle(
      "active",
      (btn as HTMLElement).dataset.theme === currentTheme
    );
  });
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
      btn.getAttribute("data-lang") === currentLang
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
        el.classList.add("is-copied");
        const label = el.querySelector(".copy-label");
        if (label) label.textContent = "copied";
        setTimeout(() => {
          el.classList.remove("is-copied");
          if (label) label.textContent = "copy";
        }, 1800);
      } catch (err) {
        console.error("Copy failed:", err);
      }
    });
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

// ── GitHub Star Fetcher ──

async function initGitHubStars(): Promise<void> {
  const el = document.getElementById("star-count");
  if (!el) return;

  try {
    const response = await fetch("https://api.github.com/repos/TideSurf/core", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;

    const data = (await response.json()) as { stargazers_count?: number };
    if (data.stargazers_count == null) return;

    el.textContent =
      data.stargazers_count >= 1000
        ? `${(data.stargazers_count / 1000).toFixed(1)}k`
        : String(data.stargazers_count);
  } catch {
    // Ignore network failures for the decorative star counter.
  }
}

// ── Hero Verb Cycle ──

function initHeroVerbCycle(): void {
  const slot = document.querySelector<HTMLElement>(".hero-verb-slot");
  const current = document.getElementById("hero-verb-current");
  const next = document.getElementById("hero-verb-next");
  if (!slot || !current || !next) return;

  const verbs = ["browse", "compress", "reason", "act"];
  if (prefersReducedMotion()) return;

  let index = 0;
  let switching = false;
  setInterval(() => {
    if (switching) return;
    const nextIndex = (index + 1) % verbs.length;
    switching = true;
    next.textContent = verbs[nextIndex];
    slot.classList.add("is-switching");
    setTimeout(() => {
      slot.classList.add("is-resetting");
      index = nextIndex;
      current.textContent = verbs[index];
      next.textContent = "";
      slot.classList.remove("is-switching");
      void slot.offsetHeight; // force repaint reflow
      requestAnimationFrame(() => {
        slot.classList.remove("is-resetting");
        switching = false;
      });
    }, 400);
  }, 3000);
}

// ── Package Installation Command Cycle ──

function initPkgCycle() {
  const commandText = document.getElementById("install-command-text");
  const copyBtn = document.getElementById("install-copy-btn");
  if (!commandText || !copyBtn) return;

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
    const parent = commandText!.parentElement;
    parent?.classList.add("is-switching");
    setTimeout(() => {
      const command = commands[currentIndex];
      commandText!.textContent = command;
      copyBtn!.setAttribute("data-copy", command);
      parent?.classList.remove("is-switching");
    }, 150);
  }

  const hero = document.querySelector(".hero");
  if (hero && "IntersectionObserver" in window) {
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

// ── Comparison Demo Interactivity ──

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

// ── Try Tabs ──

function initTryTabs(): void {
  const tabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-try-tab]")
  );
  const panels = Array.from(
    document.querySelectorAll<HTMLElement>("[data-try-panel]")
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

// ── Scroll Reveal Staggers ──

function initScrollReveal(): void {
  if (prefersReducedMotion() || !("IntersectionObserver" in window)) return;

  const revealDuration = "0.95s";
  const revealEasing = "cubic-bezier(0.16, 1, 0.3, 1)";
  const heroReveals = document.querySelectorAll(".hero .reveal");
  const sectionReveals = document.querySelectorAll(
    ".section.reveal, .stat-ribbon.reveal, .footer.reveal"
  );

  function primeForObserver(el: HTMLElement, delayMs: number) {
    el.style.opacity = "0";
    el.style.transform = "translateY(22px)";
    if (delayMs) el.style.transitionDelay = `${delayMs}ms`;
  }

  heroReveals.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const delay = htmlEl.style.getPropertyValue("--reveal-delay") || "0ms";
    const delayMs = parseInt(delay, 10) || 0;
    primeForObserver(htmlEl, delayMs);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          target.style.transition = `opacity ${revealDuration} ${revealEasing}, transform ${revealDuration} ${revealEasing}`;
          target.style.opacity = "1";
          target.style.transform = "translateY(0)";
          target.classList.add("is-visible");
          observer.unobserve(target);
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(htmlEl);
  });

  sectionReveals.forEach((el, index) => {
    const htmlEl = el as HTMLElement;
    primeForObserver(htmlEl, index * 60);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          target.style.transition = `opacity ${revealDuration} ${revealEasing}, transform ${revealDuration} ${revealEasing}`;
          target.style.opacity = "1";
          target.style.transform = "translateY(0)";
          target.classList.add("is-visible");
          observer.unobserve(target);
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -6% 0px" }
    );
    observer.observe(htmlEl);
  });
}

// ── Terminal Sequence Highlights ──

function initTerminalHighlight(): void {
  const termSteps = document.querySelectorAll("[data-term-step]");
  if (!termSteps.length || prefersReducedMotion()) {
    termSteps.forEach((el) => el.classList.add("is-active"));
    return;
  }

  let step = 0;
  const maxStep = Math.max(
    ...Array.from(termSteps).map((el) => Number((el as HTMLElement).dataset.termStep))
  );

  function setStep(n: number) {
    termSteps.forEach((el) => {
      el.classList.toggle("is-active", Number((el as HTMLElement).dataset.termStep) === n);
    });
  }

  setStep(0);
  setInterval(() => {
    step = step >= maxStep ? 0 : step + 1;
    setStep(step);
  }, 2200);
}

// ── Cookie Notice ──

function initCookieNotice(): void {
  const notice = document.getElementById("cookie-notice");
  const dismiss = document.getElementById("cookie-dismiss");
  if (!notice || !dismiss) return;

  const saved = safeStorageGet("tidesurf-cookie-dismissed");
  if (saved === "true") {
    notice.hidden = true;
    notice.style.display = "none";
    return;
  }

  notice.hidden = false;
  notice.style.display = "flex";

  dismiss.addEventListener("click", () => {
    safeStorageSet("tidesurf-cookie-dismissed", "true");
    notice.hidden = true;
    notice.style.display = "none";
  });
}

// ── Scroll nudge ──

function initScrollNudge(): void {
  const loopScroller = document.querySelector(".loop-scroller");
  if (!loopScroller || prefersReducedMotion() || !("IntersectionObserver" in window)) return;

  let nudged = false;
  const nudgeObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || nudged) return;
        nudged = true;
        const firstPanel = loopScroller.querySelector(".loop-panel") as HTMLElement;
        if (!firstPanel) return;

        setTimeout(() => {
          loopScroller.scrollTo({
            left: firstPanel.offsetWidth * 0.35,
            behavior: "smooth",
          });
          setTimeout(() => {
            loopScroller.scrollTo({ left: 0, behavior: "smooth" });
          }, 900);
        }, 400);

        nudgeObserver.unobserve(loopScroller);
      });
    },
    { threshold: 0.4 }
  );

  nudgeObserver.observe(loopScroller);
}

// ── Init ──

async function init(): Promise<void> {
  initTheme();
  initLanguage();
  initCopyButtons();
  initHeroVerbCycle();
  initComparisonDemo();
  initTryTabs();
  initPkgCycle();
  initScrollReveal();
  initTerminalHighlight();
  initCookieNotice();
  initScrollNudge();
  updateLangButtons();
  await initGitHubStars();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}
