# P.K.H☆ MAKER3 (PKH-maker3)

> 박경호 캐릭터가 하늘에서 떨어지는 배역별 소품을 모아 운명에 따라 연뮤캐 SD(사이먼·골드문트·필로스·레미·동점 히든·0점 기니피그)로 변신하는 무한 서바이벌 웹 아케이드 게임입니다.  
> Cloudflare Workers와 D1(SQLite) 서버리스 인프라를 기반으로 실시간 랭킹, 엔딩 도감, 운영 관리자 대시보드를 제공합니다.

---

## 📖 문서 바로가기
- **[docs/SPEC.md](./docs/SPEC.md)**: 게임 시스템 규칙, 채보/난이도 곡선, 점수 공식, D1 DB 스키마 및 REST API 상세 명세
- **[docs/DESIGN.md](./docs/DESIGN.md)**: 앤틱 로즈 핑크 픽셀아트 UI 가이드, 모바일 9:16 반응형 기준, AI 클리셰 지양 원칙

---

## ✨ 핵심 기능

### 1. 인게임 서바이벌 & 엔딩 시스템
- **6종 엔딩 수집**:
  - `사이먼`: 엔젤스 도넛 & 힙플라스크 최다 획득
  - `골드문트`: 십자가 & 꽃가면 최다 획득
  - `필로스`: 나비 & 황금빛 목걸이 최다 획득
  - `레미`: 달콤한 피 & 300년 후 선물(체스말) 최다 획득
  - `P.K.H☆` (동점 히든): 2개 이상 배역의 소품 수가 동률일 때
  - `인간이 되고 싶었어...` (0점 기니피그): 소품을 하나도 먹지 못하고 게임오버 시
- **실버(위험 소품) & 3회 기회**: 실버 피격 시 기회 1개 감소 및 1.2초 무적/찡그림 이펙트 발동.
- **콤보 & 암전 고난도 채보**: 연속 획득 시 콤보 가산점, 11.5초간 이어지는 5가지 패턴의 암전 고난도 구간에서는 점수 2배 획득.
- **Web Audio 합성 사운드**: 별도 무거운 MP3 다운로드 없이 브라우저 내장 Web Audio API로 효과음 및 BGM을 무지연 생성·재생.

### 2. 조작 방식 (플랫폼별 최적화)
- **PC 환경**: 키보드 좌우 방향키(`←`, `→`) 또는 `A` / `D`, 마우스 클릭 및 드래그 조작 지원.
- **모바일 환경**: 화면 터치 위치 이동 및 직관적인 손가락 터치 드래그 추적.

### 3. 엔딩 도감 (Ending Collection - 6종 수집)
- **로그인 유저 전용**: 닉네임/PIN 등록 유저에게만 시작 화면 독(Dock)과 결과 화면에 `[엔딩 도감]` 버튼 노출 (비로그인 시 완벽 은닉).
- **미해금 카드 미스터리 처리**: 어두운 종이 질감 실루엣 + `? ? ?` 마크만 표시하여 힌트 및 스포일러 차단.
- **카드 상세 뷰어**: 해금 카드 클릭 시 풀 일러스트와 배역별 감성 엔딩 멘트 전문 감상 가능.
- **올클리어(`COMPLETE!`)**: 6종 엔딩 모두 수집 시 단정하고 세련된 완료 배너 표시.
- **신규 해금 연출**: 플레이 종료 시 처음 보는 엔딩일 경우 결과 화면 상단에 `[NEW! 도감 등록]` 태그 애니메이션 출력.
- **모바일 최적화**: 9:16 화면비에 맞춘 2열 3행 반응형 그리드 적용 (가로 스크롤 완전 차단).

### 4. 운영 관리자 페이지 (`/admin.html`)
- **보안 로그인**: 관리자 비밀번호 인증 (환경 변수 `ADMIN_PASSWORD` 설정 지원).
- **실시간 대시보드**: 총 등록 유저 수, 랭커 인원, 누적 플레이 판수, 배역별 엔딩 점유율 통계.
- **랭킹 동결(시즌 집계 제한)**: 동결 시작/종료 일시 설정 시 해당 시간 동안 게임 플레이와 닉네임 등록 자동 차단 및 기간 종료 시 자동 해제.
- **유저 & 로그 통합 조회**: 닉네임 검색, 배역별 필터, **`도감 6종 COMPLETE 달성자만`** 보기 필터, 정렬, 악성 유저 개별 삭제.
- **2중 확인 초기화**: 점수·랭킹만 초기화(계정 유지) 또는 전체 데이터 완전 초기화.
- **Local Dev Fallback**: 로컬 정적 서버에서도 `localStorage` 기반으로 관리자 화면이 정상 작동하도록 내장.

### 5. 링크 공유(OG Tag) 최적화
- 상단 파비콘과 동일한 기니피그 고화질 썸네일(`assets/guinea_front.png`, 280x280) 및 Open Graph / Twitter Card 메타태그 적용.
- 카카오톡, 디스코드, 슬랙, 트위터 공유 시 깔끔한 미리보기 카드 제공.

---

## 📁 디렉터리 구조

```text
PKH-maker3/
├── public/                     # 정적 웹 프론트엔드 리소스 (Cloudflare ASSETS)
│   ├── assets/                 # WebP 이미지 에셋 (배경, 캐릭터 SD, 소품, UI, 파비콘)
│   ├── admin.html              # 운영 관리자 대시보드
│   ├── config.js               # 게임 규칙, 배역, 점수, 문구 설정 파일
│   ├── fonts.css               # 웹폰트(DOS명조, 갈무리11) 정의
│   ├── game.js                 # 캔버스 렌더링, 물리 엔진, 도감 및 게임 상태 로직
│   ├── index.html              # 게임 메인 진입 페이지 (OG 태그, 모달 구조)
│   └── style.css               # 앤틱 로즈 핑크 픽셀아트 CSS (반응형 9:16)
├── src/
│   └── worker.js               # Cloudflare Workers API 백엔드 (인증, 랭킹, 도감, 관리자)
├── docs/                       # 기획·설계 사양서 (SPEC.md, DESIGN.md)
├── schema.sql                  # Cloudflare D1 (SQLite) 테이블 및 인덱스 정의
├── wrangler.toml               # Cloudflare Workers + D1 바인딩 설정
└── package.json
```

---

## 🛠 로컬 개발 및 실행

### 방법 A. Cloudflare Workers 로컬 개발 (권장)
```bash
npm install
npm run dev
```
- 브라우저에서 `http://localhost:8787` 접속 시 로컬 D1 에뮬레이션과 함께 프론트엔드-백엔드 전체 기능을 테스트할 수 있습니다.

### 방법 B. 로컬 D1 초기 데이터 세팅 (선택)
```bash
npm run db:init:local
```

---

## ☁️ Cloudflare Workers + D1 배포 가이드

```bash
# 1. Cloudflare CLI 로그인 (최초 1회)
npx wrangler login

# 2. D1 데이터베이스 생성 후 출력되는 database_id를 wrangler.toml에 기입
npx wrangler d1 create pkh-maker3-db

# 3. 원격 D1 데이터베이스에 스키마 반영
npm run db:init:remote

# 4. (권장) 운영 관리자 비밀번호 및 세션 서명 시크릿 설정
npx wrangler secret put ADMIN_PASSWORD   # 운영 관리자 페이지 접근 비밀번호 설정
npx wrangler secret put AUTH_SECRET      # 세션 HMAC 서명용 시크릿 (선택)

# 5. 전체 배포
npm run deploy
```

---

## ⚙️ 커스터마이징 안내 (`public/config.js`)

대부분의 게임 룰과 텍스트는 `public/config.js`에서 코드 수정 없이 즉시 변경할 수 있습니다:

- `brand.title`, `brand.subtitle`: 메인 타이틀 및 서브타이틀
- `player.speed`, `player.invincibleMs`: 기니피그 이동 속도 및 피격 무적 시간
- `scoring.baseItemScore`, `scoring.comboStepScore`: 기본 점수 및 콤보 보너스 공식
- `survival.climaxStartSec`, `survival.climaxDurationSec`: 암전 고난도 구간 시작 시각 및 지속 시간
- `roles[].resultTitle`, `roles[].resultComment`: 6종 배역별 엔딩 타이틀 및 상세 해설 멘트
