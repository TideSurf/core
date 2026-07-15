<img src="https://tidesurf.org/logo.svg" width="180" height="48" alt="TideSurf">

# TideSurf

**ライブページを、エージェントがサーフする。**

[Webサイト](https://tidesurf.org) · [ドキュメント](https://tidesurf.org/docs) · [llms.txt](https://tidesurf.org/llms.txt) · [npm](https://www.npmjs.com/package/@tidesurf/core) · [スポンサー](https://github.com/sponsors/MercuriusDream)

TideSurfは、実行中のChromiumページをエージェント向けのコンパクトなテキストへ変換します。操作可能な要素には、現在のDOMに結び付いた短いIDが付きます。CLI、SDK executor、MCPは同じ18ツールを使います。

## エージェントCLI

ツールコマンドを直接実行できます。最初のコマンドが非公開のローカルセッションと、ヘッドレスの分離ブラウザーを起動します。次のシェル呼び出しでも、ブラウザー、タブ、アクティブタブ、要素IDマップが維持されます。

```sh
bunx @tidesurf/core navigate https://example.com
bunx @tidesurf/core get-state
bunx @tidesurf/core click L1
bunx @tidesurf/core status
bunx @tidesurf/core stop
```

並行する作業には名前付きセッションを使います。

```sh
bunx @tidesurf/core --session research navigate https://example.com
bunx @tidesurf/core --session research get-state --mode interactive
```

直接実行できるコマンドは次の18個です。

```text
get-state       navigate        click           type
select          scroll          extract         evaluate
list-tabs       new-tab         switch-tab      close-tab
search          screenshot      upload          clipboard-read
clipboard-write download
```

`get_state`や`switch_tab`などのMCP名もエイリアスとして使えます。`tidesurf tools`はツール一覧、`tidesurf help <command>`はコマンド別ヘルプを表示します。`tidesurf call <tool> --input '<json>'`は生のツール呼び出しを実行します。

既定では、TideSurfが管理ブラウザーを起動します。Chrome stable、Beta、Dev、Canary、Chromiumを検索し、動的なデバッグポートを使います。検索順は`--chrome-path`、`CHROME_PATH`、`PATH`、OSの標準インストール先です。ブラウザーをダウンロードすることはありません。既存ブラウザーを優先する場合は`--auto-connect`、起動を禁止する場合は`--connect-only`を指定します。

読み取り専用ポリシーはセッション終了まで固定されます。

```sh
bunx @tidesurf/core --session audit --read-only get-state
```

読み取り専用セッションでは、`get-state`、`extract`、`list-tabs`、`switch-tab`、`search`、`screenshot`だけを使用できます。ナビゲーション、ページ操作、JavaScript、クリップボード、アップロード/ダウンロード、タブの作成と終了はSDKとツールの全境界で拒否されます。

起動ポリシーは変更できません。以降の呼び出しでは起動フラグを省略できます。`--read-only`のような独立したフラグは同じ値だけを繰り返せます。異なる値は拒否されます。

## SDK

```sh
bun add @tidesurf/core
```

```ts
import { TideSurf } from "@tidesurf/core";

const browser = await TideSurf.launch();
await browser.navigate("https://example.com");

const state = await browser.getState();
console.log(state.content);

await browser.getPage().click("B1");
await browser.close();
```

ページは実際に操作できるハンドルを含むプレーンテキストになります。

```text
# Example Search
> example.com/search | 0/1200 800vh

NAV
  [L1](/) Home
  [L2](/about) About
FORM F1
  I1 ~Search... ="TideSurf"
  [B1] Search
```

`B1`は現在のSearchボタンを指します。ページが変化した後は、もう一度状態を取得してください。

`TideSurf.launch()`はChromiumを起動して所有します。`userDataDir`を指定しない場合は、分離された一時プロファイルを使います。`TideSurf.connect()`は既存のエンドポイントにだけ接続し、既定ポートは`9222`です。接続したインスタンスを閉じても、ユーザーのブラウザーは終了しません。

`getState()`は`full`、`interactive`、`minimal`モード、ビューポート絞り込み、`maxTokens`に対応します。`includeHidden: true`はフルDOMのデバッグ設定です。非表示ノードを含め、ビューポート絞り込みを無効にします。

SDKのアップロードとダウンロードは、既定で作業ディレクトリとOSの一時ディレクトリに限定されます。SDKのファイル操作を無効にするには`fileAccessRoots: []`を指定します。

## MCP

MCPは同じレジストリとexecutorを使う薄いアダプターとして利用できます。

```json
{
  "mcpServers": {
    "tidesurf": {
      "command": "bunx",
      "args": ["@tidesurf/core", "mcp"]
    }
  }
}
```

MCPサーバーは標準18ツールと、互換性用の`launch_browser`を公開します。スクリーンショットはMCP画像ブロック、失敗は`isError`付きで返ります。

続きは[Getting started](https://tidesurf.org/docs#getting-started)、[CLI](https://tidesurf.org/docs#cli)、[Security](https://tidesurf.org/docs#security)、[API reference](https://tidesurf.org/docs#api-reference)をご覧ください。

[English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Apache 2.0](LICENSE)
