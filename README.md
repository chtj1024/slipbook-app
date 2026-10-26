# Slipbook

종이 영수증을 찍으면 Claude가 품목을 읽어 **가계부**, **물가 추적**, **장보기 목록**으로 정리해 주는 안드로이드 앱입니다.
서버 없이 폰 안에서만 동작하고, 모든 데이터는 기기(IndexedDB)에 저장됩니다.

## 주요 기능

### 🧾 가계부
- 영수증 사진을 찍거나 갤러리에서 고르면 Claude가 상호명·날짜·결제 금액·품목을 자동으로 채워 줍니다.
- 품목은 식료품, 외식·카페, 생활용품, 의류·잡화, 건강·의료, 교통·차량, 문화·여가, 기타로 분류됩니다.
- 월별 지출 합계와 분류별 비중을 보여 주고, 영수증 원본 사진도 함께 보관합니다.
- API 키 없이도 품목을 직접 입력해 쓸 수 있습니다.

### 📈 물가 추적
- 같은 상품을 영수증끼리 비교할 수 있도록 표준 품목명(예: `서울우유 1L`)으로 묶습니다.
- 품목별 최근가, 처음 산 가격 대비 변동률, 최저가와 그 상점, 평균 구매 주기를 계산합니다.
- 많이 오른 품목·내린 품목, 상점별 가격 비교, 가격 변화 차트를 제공합니다.

### 🛒 장보기
- 장보기 목록을 만들고, 영수증을 등록하면 산 항목이 자동으로 체크됩니다.
- 구매 주기를 바탕으로 "다시 살 때가 된" 품목을 추천합니다.

## 기술 스택

| 영역 | 사용 |
| --- | --- |
| 화면 | 바닐라 JavaScript (ES Modules), CSS |
| 번들 | [esbuild](https://esbuild.github.io/) |
| 앱 패키징 | [Capacitor](https://capacitorjs.com/) 8 (Android) |
| 영수증 인식 | [Anthropic Claude API](https://docs.anthropic.com/) (`@anthropic-ai/sdk`, 구조화 출력) |
| 저장소 | IndexedDB (기기 내부) |

## 프로젝트 구조

```
slipbook-app/
├── src/
│   ├── main.js          # 화면 렌더링과 이벤트 처리 (가계부·물가·장보기·설정)
│   ├── local-api.js     # 앱 내부 "API" 라우터 — /api/... 요청을 폰 안에서 처리
│   ├── parser.js        # Claude로 영수증 이미지 → 구조화된 JSON
│   ├── insights.js      # 가격 요약, 상점 비교, 재구매 추천 계산
│   ├── store.js         # IndexedDB 저장/불러오기
│   └── categories.js    # 가계부 분류 목록
├── www/                 # 웹 자산 (index.html, app.css, 빌드된 app.js)
├── android/             # Capacitor 안드로이드 프로젝트
├── capacitor.config.json
└── package.json
```

## 시작하기

### 준비물
- Node.js 18 이상
- Android Studio (Android SDK, JDK 포함)
- 영수증 자동 인식을 쓰려면 [Anthropic API 키](https://console.anthropic.com/)

### 설치 및 빌드

```bash
npm install
```

```bash
npm run build
```

`src/`를 번들링해 `www/app.js`를 만듭니다.

### 안드로이드 APK 만들기

```bash
npm run android
```

빌드 → `cap sync` → Gradle `assembleDebug`까지 한 번에 실행합니다.
결과물은 `android/app/build/outputs/apk/debug/app-debug.apk`에 생깁니다.
(Windows 기준 스크립트입니다. macOS/Linux에서는 `gradlew.bat` 대신 `./gradlew`를 쓰세요.)

Android Studio로 열어 실행하려면:

```bash
npx cap open android
```

## API 키와 개인정보

- 앱의 ⚙ 설정에서 Anthropic API 키를 입력하면 AI 영수증 분석이 켜집니다.
- 키는 **이 폰에만** 저장되며, 분석할 때 영수증 사진과 함께 Anthropic API로만 전송됩니다.
- 영수증·장보기 데이터는 외부 서버로 보내지 않고 기기 안에만 저장됩니다.
- 앱이 API를 폰에서 직접 호출하므로(`dangerouslyAllowBrowser`), 본인 기기에서 본인 키로 쓰는 개인용 앱을 전제로 합니다.
