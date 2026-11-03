# PKH-maker3

박경호 캐릭터가 하늘에서 떨어지는 배역별 소품을 모아 결과에 따라 연뮤캐 SD(사이먼·골드문트·필로스·레미)로 변신하는 무한 서바이벌 웹 게임입니다.

> **다른 세션에서 이어서 작업할 때 참고 문서**
> - **[docs/SPEC.md](./docs/SPEC.md)**: 게임 규칙, 캐릭터·아이템 매핑, 난이도/점수 구조, Cloudflare D1 API 명세 및 **추후 고객 수령 후 교체할 체크리스트**
> - **[docs/DESIGN.md](./docs/DESIGN.md)**: UI/UX 디자인 원칙(AI 클리셰 배제 규칙), 컬러 시스템, 화면별 레이아웃 기준

---

## 1. 추후 고객 전달 리소스 반영 위치 요약

1. **게임 제목 & 소개 문구 확정 시**: `public/config.js` → `brand.title`, `brand.subtitle` 수정
2. **게임 로고 이미지 수령 시**: `public/assets/`에 이미지 추가 후 `public/config.js` → `brand.logoImage`에 경로 입력 (시작 화면 점선 `'로고 영역'` 자동 대체)
3. **`실버(칼 모양)` 이미지 수령 시**: `public/assets/bomb_silver.png` 파일 덮어쓰기 (현재 임시 `장미.png` 적용 중)
4. **배역별 결과 문구 확정 시**: `public/config.js` → `roles` 및 `fallbackRole`의 `resultTitle`, `resultComment` 수정
5. **(선택) 콤보/생존 점수 활성화 시**: `public/config.js` → `scoring.comboStepScore`, `scoring.survivalTickScore` 수치 조정

---

## 2. 로컬 실행 방법

```bash
npm install
npm run dev
```
- `http://localhost:8787` 접속 시 프론트엔드와 로컬 Cloudflare D1(닉네임/PIN 등록 및 랭킹)까지 통합 테스트할 수 있습니다.

---

## 3. Cloudflare Workers + D1 배포 방법

```bash
# 1. Cloudflare 계정 로그인 (최초 1회)
npx wrangler login

# 2. D1 데이터베이스 생성 후 출력되는 database_id를 wrangler.toml에 기입
npx wrangler d1 create pkh-maker3-db

# 3. 스키마 반영 (선택 - 첫 요청 시 자동 생성도 지원됨)
npm run db:init:remote

# 4. (권장) 세션 서명용 시크릿 설정
npx wrangler secret put AUTH_SECRET

# 5. 배포
npm run deploy
```
