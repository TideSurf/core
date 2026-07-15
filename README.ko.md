<img src="https://tidesurf.org/logo.svg" width="180" height="48" alt="TideSurf">

# TideSurf

**살아 있는 페이지. 서핑하는 에이전트.**

[웹사이트](https://tidesurf.org) · [문서](https://tidesurf.org/docs) · [llms.txt](https://tidesurf.org/llms.txt) · [npm](https://www.npmjs.com/package/@tidesurf/core) · [후원](https://github.com/sponsors/MercuriusDream)

TideSurf는 실행 중인 Chromium 페이지를 에이전트용 간결한 텍스트로 바꿉니다. 조작 가능한 요소에는 현재 DOM과 연결된 짧은 ID가 붙습니다. CLI, SDK executor, MCP는 같은 18개 도구를 사용합니다.

## 에이전트 CLI

도구 명령을 바로 실행할 수 있습니다. 첫 도구 명령이 비공개 로컬 세션과 헤드리스 격리 브라우저를 시작합니다. 이후 셸 호출도 같은 브라우저, 탭, 활성 탭, 요소 ID 맵을 유지합니다.

```sh
bunx @tidesurf/core navigate https://example.com
bunx @tidesurf/core get_state
bunx @tidesurf/core click L1
bunx @tidesurf/core status
bunx @tidesurf/core stop
```

병렬 작업에는 이름 있는 세션을 사용합니다.

```sh
bunx @tidesurf/core --session research navigate https://example.com
bunx @tidesurf/core --session research get_state --mode interactive
```

직접 실행할 수 있는 명령은 다음 18개입니다.

```text
get_state       navigate        click           type
select          scroll          extract         evaluate
list_tabs       new_tab         switch_tab      close_tab
search          screenshot      upload          clipboard_read
clipboard_write download
```

직접 명령에는 레지스트리와 MCP에서 쓰는 도구 식별자를 그대로 지정합니다. `tidesurf tools`는 도구 목록을, `tidesurf help <command>`는 명령별 도움말을 출력합니다. `tidesurf call <tool> --input '<json>'`은 원시 도구 호출을 실행합니다.

기본값은 관리 브라우저 실행입니다. TideSurf는 Chrome stable, Beta, Dev, Canary, Chromium을 찾고 동적 디버깅 포트를 사용합니다. 검색 순서는 `--chrome-path`, `CHROME_PATH`, `PATH`, 운영체제 설치 경로입니다. 브라우저를 내려받지는 않습니다. 기존 브라우저를 우선하려면 `--auto-connect`, 실행을 금지하려면 `--connect-only`를 사용하세요.

읽기 전용 정책은 세션이 끝날 때까지 고정됩니다.

```sh
bunx @tidesurf/core --session audit --read-only get_state
```

읽기 전용 세션은 `get_state`, `extract`, `list_tabs`, `switch_tab`, `search`, `screenshot`만 허용합니다. 탐색, 페이지 조작, JavaScript, 클립보드, 업로드/다운로드, 탭 생성/닫기는 SDK와 도구의 모든 경계에서 거부됩니다.

시작 정책은 바꿀 수 없습니다. 이후 호출은 시작 플래그를 생략할 수 있습니다. `--read-only`처럼 독립적인 플래그는 같은 값만 다시 지정할 수 있으며, 충돌하는 값은 거부됩니다.

## SDK

```sh
bun add @tidesurf/core
```

```ts
import { TideSurf } from "@tidesurf/core";

const browser = await TideSurf.launch();
await browser.navigate("https://example.com");

const state = await browser.readPage();
console.log(state.content);

await browser.getPage().click("B1");
await browser.close();
```

페이지는 실제로 조작할 수 있는 핸들이 포함된 일반 텍스트로 돌아옵니다.

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

`B1`은 현재 Search 버튼을 가리킵니다. 페이지가 바뀐 뒤에는 상태를 다시 읽으세요.

`TideSurf.launch()`는 Chromium을 실행하고 소유합니다. `userDataDir`를 지정하지 않으면 격리된 임시 프로필을 사용합니다. `TideSurf.connect()`는 기존 엔드포인트에만 연결하며 기본 포트는 `9222`입니다. 연결한 인스턴스를 닫아도 사용자 브라우저는 종료하지 않습니다.

`readPage()`는 `full`, `interactive`, `minimal` 모드, 뷰포트 필터, `maxTokens`를 지원합니다. `includeHidden: true`는 숨겨진 노드를 포함하고 뷰포트 필터를 끕니다. 더 이상 권장하지 않는 `getState()`는 SDK 호환성을 위해 `readPage()`에 위임합니다.

SDK 업로드와 다운로드는 기본적으로 작업 디렉터리와 운영체제 임시 디렉터리로 제한됩니다. SDK 파일 작업을 끄려면 `fileAccessRoots: []`를 지정하세요.

## MCP

MCP는 같은 레지스트리와 executor를 사용하는 얇은 어댑터로 제공됩니다.

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

MCP 서버는 표준 18개 도구와 수명 주기용 `launch_browser`를 제공합니다. 스크린샷은 MCP 이미지 블록으로, 실패는 `isError`와 함께 반환됩니다.

다음으로 [Getting started](https://tidesurf.org/docs#getting-started), [CLI](https://tidesurf.org/docs#cli), [Security](https://tidesurf.org/docs#security), [API reference](https://tidesurf.org/docs#api-reference)를 확인하세요.

[English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Apache 2.0](LICENSE)
