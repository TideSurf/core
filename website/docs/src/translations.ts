interface TranslationSet {
  en: string;
  ja: string;
  ko: string;
}

export const translations: Record<string, TranslationSet> = {
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
