# TideSurf

[English](README.md) | **日本語** | [한국어](README.ko.md)

[![CI](https://github.com/tidesurf/@tidesurf/core/actions/workflows/ci.yml/badge.svg)](https://github.com/tidesurf/@tidesurf/core/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@tidesurf/core)](https://www.npmjs.com/package/@tidesurf/core)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**スクリーンショットもビジョンモデルも不要です。DOMを圧縮して、LLMに直接渡します。**

TideSurfはブラウザのDOMを軽量なXMLに変換し、LLMがそのまま扱える形にします。生HTMLでは5,000〜50,000トークン以上になるページも、100〜800トークンに収まります。LLMが出した操作指示はCDPを通じてブラウザ上で実行されます。

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

## ドキュメント

詳しくは **[docs.tidesurf.org](https://docs.tidesurf.org)** をご覧ください。

- [はじめに](https://docs.tidesurf.org/#getting-started) — インストールからLLM連携までの手順をご案内します
- [ページフォーマット](https://docs.tidesurf.org/#page-format) — DOMがどのように圧縮されるかをご説明します
- [トークン予算](https://docs.tidesurf.org/#token-budget) — 出力サイズの調整方法について解説します
- [マルチタブ](https://docs.tidesurf.org/#multi-tab) — 複数タブの管理方法をご紹介します
- [エラー処理](https://docs.tidesurf.org/#error-handling) — 型付きエラーとリトライの仕組みをご説明します
- [APIリファレンス](https://docs.tidesurf.org/#api-reference) — すべてのクラスとツールの詳細をまとめています
- [アーキテクチャ](https://docs.tidesurf.org/#architecture) — TideSurfの全体構成をご紹介します

## ライセンス

Apache 2.0
