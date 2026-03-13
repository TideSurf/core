<p align="center">
  <img src="assets/logo.svg" width="80" height="80" alt="TideSurf">
</p>

<h1 align="center">TideSurf</h1>

<p align="center"><a href="README.md">English</a> | <strong>日本語</strong> | <a href="README.ko.md">한국어</a></p>

<p align="center">
  <a href="https://github.com/TideSurf/core/actions/workflows/ci.yml"><img src="https://github.com/TideSurf/core/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@tidesurf/core"><img src="https://img.shields.io/npm/v/@tidesurf/core" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
</p>

<p align="center">
  <strong>スクリーンショットもビジョンモデルも不要です。<br>DOMを圧縮して、LLMに直接渡します。</strong>
</p>

<p align="center">
  TideSurfはブラウザのDOMを軽量なXMLに変換し、LLMがそのまま扱える形にします。<br>
  生HTMLでは5,000〜50,000トークン以上になるページも、100〜800トークンに収まります。<br>
  LLMが出した操作指示はCDPを通じてブラウザ上で実行されます。
</p>

<br>

## インストール

```bash
bun add @tidesurf/core
```

## クイックスタート

```typescript
import { TideSurf } from "@tidesurf/core";

const browser = await TideSurf.launch();
await browser.navigate("https://example.com");

const state = await browser.getState();
console.log(state.xml);

const page = browser.getPage();
await page.click("B1");
await page.type("I1", "hello world");

await browser.close();
```

## ベンチマーク

<p align="center">実サイトでのトークン圧縮率を測定した結果です。</p>

| サイト | 生HTML | TideSurf | 圧縮率 | 倍率 |
|--------|--------|----------|--------|------|
| Wikipedia | 123,631 トークン | 25,189 トークン | 80% | **4.9x** |
| GitHub | 84,668 トークン | 10,968 トークン | 87% | **7.7x** |
| Reddit | 47,489 トークン | 21,972 トークン | 54% | **2.2x** |
| MDN Docs | 24,919 トークン | 18,769 トークン | 25% | **1.3x** |
| Hacker News | 8,694 トークン | 7,364 トークン | 15% | **1.2x** |

> `bun scripts/benchmark-live.ts` で再現いただけます。

## ドキュメント

<p align="center">
  詳しくは <strong><a href="https://tidesurf.org/docs">tidesurf.org/docs</a></strong> をご覧ください。
</p>

- [はじめに](https://tidesurf.org/docs/#getting-started) — インストールからLLM連携までの手順をご案内します
- [ページフォーマット](https://tidesurf.org/docs/#page-format) — DOMがどのように圧縮されるかをご説明します
- [トークン予算](https://tidesurf.org/docs/#token-budget) — 出力サイズの調整方法について解説します
- [マルチタブ](https://tidesurf.org/docs/#multi-tab) — 複数タブの管理方法をご紹介します
- [エラー処理](https://tidesurf.org/docs/#error-handling) — 型付きエラーとリトライの仕組みをご説明します
- [APIリファレンス](https://tidesurf.org/docs/#api-reference) — すべてのクラスとツールの詳細をまとめています
- [アーキテクチャ](https://tidesurf.org/docs/#architecture) — TideSurfの全体構成をご紹介します

## ライセンス

<p align="center">Apache 2.0</p>
