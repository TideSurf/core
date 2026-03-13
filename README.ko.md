# TideSurf

[English](README.md) | [日本語](README.ja.md) | **한국어**

[![CI](https://github.com/tidesurf/@tidesurf/core/actions/workflows/ci.yml/badge.svg)](https://github.com/tidesurf/@tidesurf/core/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@tidesurf/core)](https://www.npmjs.com/package/@tidesurf/core)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**스크린샷도 비전 모델도 필요하지 않습니다. DOM을 압축하여 LLM에 직접 전달합니다.**

TideSurf는 브라우저의 DOM을 경량 XML로 변환하여 LLM이 바로 처리할 수 있도록 합니다. 원본 HTML에서 5,000~50,000 토큰 이상이 필요한 페이지도 100~800 토큰으로 충분합니다. LLM이 내린 조작 명령은 CDP를 통해 브라우저에서 실행됩니다.

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

## 문서

자세한 내용은 **[docs.tidesurf.org](https://docs.tidesurf.org)** 에서 확인하실 수 있습니다.

- [시작하기](https://docs.tidesurf.org/#getting-started) — 설치부터 LLM 연동까지의 과정을 안내합니다
- [페이지 포맷](https://docs.tidesurf.org/#page-format) — DOM이 어떻게 압축되는지 설명합니다
- [토큰 예산](https://docs.tidesurf.org/#token-budget) — 출력 크기를 조절하는 방법을 다룹니다
- [멀티탭](https://docs.tidesurf.org/#multi-tab) — 여러 탭을 관리하는 방법을 소개합니다
- [에러 처리](https://docs.tidesurf.org/#error-handling) — 타입 기반 에러와 재시도 구조를 설명합니다
- [API 레퍼런스](https://docs.tidesurf.org/#api-reference) — 모든 클래스와 도구에 대한 상세 정보를 정리하였습니다
- [아키텍처](https://docs.tidesurf.org/#architecture) — TideSurf의 전체 구조를 소개합니다

## 라이선스

Apache 2.0
