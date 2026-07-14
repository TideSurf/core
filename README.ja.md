<img src="https://tidesurf.org/logo.svg" width="180" height="48" alt="TideSurf">

# TideSurf

**ライブページを、エージェントがサーフする。**

[Webサイト](https://tidesurf.org) · [ドキュメント](https://tidesurf.org/docs) · [llms.txt](https://tidesurf.org/llms.txt) · [npm](https://www.npmjs.com/package/@tidesurf/core) · [スポンサー](https://github.com/sponsors/MercuriusDream)

TideSurfは、実行中のChromiumをモデルが読めるコンパクトなテキストへ変換します。操作可能な要素には実ページと結び付いた短いIDが付き、エージェントはChrome DevTools Protocol経由でページを読み、選び、操作できます。

## はじめる

```sh
bun add @tidesurf/core
```

```ts
import { TideSurf } from "@tidesurf/core";

const browser = await TideSurf.launch();
await browser.navigate("https://example.com");

const state = await browser.getState();
console.log(state.content);

const page = browser.getPage();
await page.click("B1");
await browser.close();
```

ページは、実際に操作できるハンドルを含むプレーンテキストになります。

```text
# Example Search
> example.com/search
NAV
  [L1](/) Home
  [L2](/about) About
FORM F1
  I1 ~Search... ="TideSurf"
  [B1] Search
```

`B1`は実ページのSearchボタンを指します。リンク、入力欄、タブ、フォームも同じ方法でライブページと結び付きます。CSSクラス、ラッパー、スクリプト、装飾用DOMはモデルのコンテキストに入りません。

ライブベンチマークでは、GitHubの推定84,236トークンを2,593トークンに圧縮しました。結果はページ構造で変わります。手元では`bun scripts/benchmark-live.ts`で計測できます。

## 使い方を広げる

`getState()`はビューポート絞り込み、`full`・`interactive`・`minimal`モード、`maxTokens`による上限指定に対応します。タブ操作、ファイル境界、型付きエラー、読み取り専用モード、LLM関数呼び出し向けの標準18ツールも備えています。BunとNode.js 18+をサポートします。

読み取り専用モードでは、書き込み系と機密性の高いツールをエージェントから外します。

```ts
const browser = await TideSurf.launch({ readOnly: true });
```

MCPサーバーとして起動できます。

```sh
bunx tidesurf mcp --auto-connect
```

Chrome 144+では、`chrome://inspect#remote-debugging`でリモートデバッグを許可してください。TideSurfはChromiumを新しく起動するほか、ポート`9222`で待機中のセッションにも接続できます。

続きは[Getting started](https://tidesurf.org/docs#getting-started)、[Page format](https://tidesurf.org/docs#page-format)、[Security](https://tidesurf.org/docs#security)、[API reference](https://tidesurf.org/docs#api-reference)をご覧ください。

[English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Apache 2.0](LICENSE)
