# StarLight Web IDE

PC 브라우저에서 기기의 StarLight 프로젝트를 편집하고, 컴파일하고, 디버그룸으로 바로 시험해 볼 수 있는 웹 IDE 플러그인입니다.
에디터는 VS Code의 Monaco이고, StarLight API 자동완성을 지원합니다.

**필수 의존성:** [Ktor](https://github.com/mooner1022/starlight-ktor)(`ktor@3.6.0`), [Workspace](https://github.com/mooner1022/starlight-workspace)(`workspace@1.0.0`).
같은 Workspace를 쓰는 MCP 서버와 변경 사항을 공유하므로, AI가 MCP로 고친 파일이 열려 있는 탭에 바로 반영됩니다.

## 연결하기

1. 플러그인 설정 > 보안에서 **접근 토큰**을 정합니다(8자 이상). 토큰이 없으면 로그인할 수 없습니다.
2. 제어 > 상태를 눌러 주소(`http://<기기 IP>:8766`)를 복사합니다.
3. PC 브라우저에서 열고 토큰으로 로그인합니다.

## 기능

- **편집:** 프로젝트·파일 트리, 탭, Monaco 에디터.
  - JS/TS 언어 서비스로 자동완성, 오류 표시, 정의로 이동, 이름 바꾸기를 지원합니다.
  - 명령 팔레트(F1), 줄 이동(Ctrl+G), 심볼 이동(Ctrl+Shift+O)을 쓸 수 있습니다.
- **StarLight 타입:** 앱의 API(`Api`, `Bot` 등)와 이벤트 인자 타입(`StarLight.Message` 등)을 실행 중인 앱에서 읽어 자동완성합니다.
  `onMessage`처럼 이벤트 함수 이름을 입력하면 JSDoc 타입이 붙은 함수 틀을 넣어 줍니다.
- **저장과 충돌:** 저장(Ctrl+S)할 때 파일 해시를 함께 보냅니다. 그사이 앱이나 AI가 파일을 바꿨다면 비교 화면에서 남길 버전을 고릅니다.
  저장하지 않은 파일은 다른 곳에서 바뀌면 알림만 띄우고, 저장된 파일은 바로 다시 불러옵니다.
- **컴파일:** 컴파일(Ctrl+Shift+B)하면 열린 파일을 저장하고 결과와 로그를 보여 줍니다. 실패하면 오류 줄로 이동해 표시합니다.
- **패널:** 출력, 실시간 로그(수준 필터), 프로젝트 검색(정규식·대소문자), 문제 목록.
- **디버그룸:** 오른쪽 패널에서 봇에게 메시지를 보내고 답장·오류를 확인합니다. AI가 MCP로 보낸 디버그룸 메시지도 함께 보입니다.
- **이벤트:** 프로젝트가 받을 이벤트를 켜고 끄고, 함수 틀을 에디터에 넣습니다.
- **기타:** 프로젝트 만들기·켜기/끄기, 파일 찾기 팔레트(Ctrl+P), 다크·라이트 테마, 패널 크기 조절,
  좌우 패널 접기(Ctrl+B / Ctrl+Alt+B 또는 상단 버튼, 상태 기억).
- **켜기/끄기:** StarLight에서 컴파일되지 않은 프로젝트는 항상 꺼져 있어요(컴파일에 실패하면 꺼져요).
  그런 프로젝트를 켜려 하면 이유를 알려 주고 "컴파일하고 켜기"를 제안하며, 실행 중이던 봇이 컴파일 실패로 꺼지면 알려 줘요.
- **디자인:** StarLight 앱과 같은 따뜻한 차콜·샌드 베이지 팔레트와 로고를 쓰고, 에디터 테마도 같은 팔레트에서 만듭니다.
  글꼴(Pretendard, JetBrains Mono)은 PC가 인터넷에 연결되어 있을 때 CDN에서 받고, 아니면 시스템 글꼴을 씁니다.

## 보안

이 IDE는 기기의 스크립트를 수정하고 실행할 수 있습니다.

- **로그인:** 토큰으로 로그인하면 `HttpOnly; SameSite=Strict` 세션 쿠키를 받습니다(7일). 토큰은 SHA-256 해시로만 저장되고, 토큰을 바꾸거나 "모든 브라우저 로그아웃"을 누르면 세션이 모두 끊깁니다.
- **다른 사이트 차단:** 다른 사이트의 페이지는 API를 쓸 수 없습니다. 같은 출처가 아닌 `Origin`은 거부하고, GET이 아닌 요청에는 `X-Requested-With` 헤더를 요구합니다.
- **암호화 없음:** 연결은 HTTP입니다. 신뢰할 수 없는 네트워크에서는 접속 범위를 **이 기기에서만**으로 두고 `adb forward tcp:8766 tcp:8766` 후 `http://127.0.0.1:8766`으로 접속하세요.

## 구조

| 경로 | 내용 |
|---|---|
| `app/` | Kotlin 백엔드: Ktor 서버, 로그인, [API](API.md), SSE, TypeScript 선언 생성 |
| `web/` | 웹 페이지: TypeScript + Vite + Monaco(필요한 기능만 포함) |
| `API.md` | 백엔드와 페이지 사이의 계약 |

- **페이지 빌드:** Gradle이 Node(22.12.0)를 내려받아 빌드하므로 따로 설치할 필요가 없습니다.
- **배포 형태:** 빌드 결과는 `.slp` 안의 Java 리소스 `web/`으로 들어가고, 큰 파일은 gzip 압축본만 담습니다.
- **로딩:** Monaco 핵심은 약 800KB(gzip)입니다. TypeScript 언어 서비스(약 1.3MB, gzip)는 JS 파일을 처음 열 때 불러옵니다.

## 빌드와 개발

```sh
./gradlew :app:assembleReleaseSlp   # app/build/outputs/starlight/release/ide-release.slp
./gradlew :app:testReleaseUnitTest  # 로그인, API, 충돌, SSE, 정적 파일, 타입 생성 테스트
./gradlew :app:deployReleaseSlp -Pstarlight.device=<serial>

# 앱 없이 페이지 작업: 가짜 StarLight와 예제 프로젝트로 IDE 실행 (토큰: dev-token)
IDE_DEV_SERVER=8799 ./gradlew :app:testReleaseUnitTest --tests '*DevServer*'
```

`app/libs/workspace-api-<버전>.jar`는 Workspace 저장소의 `./gradlew :app:apiJar` 결과물입니다.
`app/libs`의 `PluginCore-release.aar`, `ConfigDSL-release.aar`은 StarLight 저장소에서 빌드한 것입니다.
