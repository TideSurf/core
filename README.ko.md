<p align="center">
  <img src="assets/logo.svg" width="80" height="80" alt="TideSurf">
</p>

<h1 align="center">TideSurf</h1>

<p align="center"><a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <strong>한국어</strong></p>

<p align="center">
  <a href="https://github.com/TideSurf/core/actions/workflows/ci.yml"><img src="https://github.com/TideSurf/core/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@tidesurf/core"><img src="https://img.shields.io/npm/v/@tidesurf/core" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
</p>

<p align="center">
  <strong>스크린샷도 비전 모델도 필요하지 않습니다.<br>DOM을 압축하여 LLM에 직접 전달합니다.</strong>
</p>

<p align="center">
  TideSurf는 브라우저의 DOM을 경량 XML로 변환하여 LLM이 바로 처리할 수 있도록 합니다.<br>
  원본 HTML에서 5,000~50,000 토큰 이상이 필요한 페이지도 100~800 토큰으로 충분합니다.<br>
  LLM이 내린 조작 명령은 CDP를 통해 브라우저에서 실행됩니다.
</p>

<br>

## 설치

```bash
bun add @tidesurf/core
```

## 빠른 시작

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

## 벤치마크

<p align="center">실제 웹사이트에서 측정한 토큰 압축 결과입니다.</p>

| 사이트 | 원본 HTML | TideSurf | 압축률 | 배율 |
|--------|-----------|----------|--------|------|
| Wikipedia | 123,631 토큰 | 25,189 토큰 | 80% | **4.9x** |
| GitHub | 84,668 토큰 | 10,968 토큰 | 87% | **7.7x** |
| Reddit | 47,489 토큰 | 21,972 토큰 | 54% | **2.2x** |
| MDN Docs | 24,919 토큰 | 18,769 토큰 | 25% | **1.3x** |
| Hacker News | 8,694 토큰 | 7,364 토큰 | 15% | **1.2x** |

> `bun scripts/benchmark-live.ts`로 직접 재현하실 수 있습니다.

## 문서

<p align="center">
  자세한 내용은 <strong><a href="https://tidesurf.org/docs">tidesurf.org/docs</a></strong> 에서 확인하실 수 있습니다.
</p>

- [시작하기](https://tidesurf.org/docs/#getting-started) — 설치부터 LLM 연동까지의 과정을 안내합니다
- [페이지 포맷](https://tidesurf.org/docs/#page-format) — DOM이 어떻게 압축되는지 설명합니다
- [토큰 예산](https://tidesurf.org/docs/#token-budget) — 출력 크기를 조절하는 방법을 다룹니다
- [멀티탭](https://tidesurf.org/docs/#multi-tab) — 여러 탭을 관리하는 방법을 소개합니다
- [에러 처리](https://tidesurf.org/docs/#error-handling) — 타입 기반 에러와 재시도 구조를 설명합니다
- [API 레퍼런스](https://tidesurf.org/docs/#api-reference) — 모든 클래스와 도구에 대한 상세 정보를 정리하였습니다
- [아키텍처](https://tidesurf.org/docs/#architecture) — TideSurf의 전체 구조를 소개합니다

## 라이선스

<p align="center">Apache 2.0</p>
