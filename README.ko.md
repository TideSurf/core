<img src="https://tidesurf.org/logo.svg" width="180" height="48" alt="TideSurf">

# TideSurf

**살아 있는 페이지. 서핑하는 에이전트.**

[웹사이트](https://tidesurf.org) · [문서](https://tidesurf.org/docs) · [llms.txt](https://tidesurf.org/llms.txt) · [npm](https://www.npmjs.com/package/@tidesurf/core) · [후원](https://github.com/sponsors/MercuriusDream)

TideSurf는 실행 중인 Chromium을 모델이 읽기 좋은 간결한 텍스트로 바꿉니다. 조작 가능한 요소에는 실제 페이지와 연결된 짧은 ID가 붙습니다. 에이전트는 Chrome DevTools Protocol을 통해 페이지를 읽고, 고르고, 조작합니다.

## 시작하기

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

페이지는 실제로 조작할 수 있는 핸들이 포함된 일반 텍스트로 돌아옵니다.

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

`B1`은 실제 Search 버튼을 가리킵니다. 링크, 입력창, 탭, 폼도 같은 방식으로 살아 있는 페이지에 연결됩니다. CSS 클래스, 래퍼, 스크립트, 장식용 DOM은 모델 컨텍스트에서 빠집니다.

라이브 벤치마크에서 GitHub의 추정 84,236토큰을 2,593토큰으로 압축했습니다. 결과는 페이지 구조에 따라 달라집니다. 로컬 측정은 `bun scripts/benchmark-live.ts`로 실행할 수 있습니다.

## 활용하기

`getState()`는 뷰포트 필터, `full`·`interactive`·`minimal` 출력 모드, `maxTokens` 예산을 지원합니다. 탭 제어, 파일 경계, 타입 오류, 읽기 전용 모드, LLM 함수 호출용 표준 도구 18개도 제공합니다. Bun과 Node.js 18+를 지원합니다.

읽기 전용 모드는 쓰기 도구와 민감한 도구를 에이전트 표면에서 제거합니다.

```ts
const browser = await TideSurf.launch({ readOnly: true });
```

MCP 서버로 실행할 수 있습니다.

```sh
bunx tidesurf mcp --auto-connect
```

Chrome 144+에서는 `chrome://inspect#remote-debugging`에서 원격 디버깅을 허용해야 합니다. TideSurf는 Chromium을 새로 실행하거나 `9222` 포트에서 대기 중인 세션에 연결할 수 있습니다.

다음으로 [Getting started](https://tidesurf.org/docs#getting-started), [Page format](https://tidesurf.org/docs#page-format), [Security](https://tidesurf.org/docs#security), [API reference](https://tidesurf.org/docs#api-reference)를 확인하세요.

[English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Apache 2.0](LICENSE)
