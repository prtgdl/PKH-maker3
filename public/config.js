/**
 * PKH-maker3 설정 파일
 * 추후 게임 제목 확정 시 brand 항목을, 결과 문구 확정 시 roles 항목을,
 * 칼(실버) 이미지 수령 시 public/assets/bomb_silver.png 파일만 교체하시면 됩니다.
 */
window.PKH_CONFIG = {
  // 1. 타이틀 & 로고 설정
  brand: {
    title: 'PKH MAKER',
    logoImage: 'assets/logo.webp',
    playButtonImage: 'assets/btn_play.webp',
    stageBackground: 'assets/bg_stage.webp',
    subtitle: '떨어지는 소품을 모아\n오늘의 배역을 완성해 보세요.',
    desktopNote: '모은 소품의 개수에 따라\n마지막에 등장하는 캐릭터가 달라집니다.',
  },

  // 2. 플레이어 & 기회(목숨) 설정
  canvas: {
    width: 450,
    height: 800,
  },
  player: {
    image: 'assets/char_basic.webp',
    size: 118,
    y: 666,
    minX: 58,
    maxX: 392,
    keyboardSpeed: 465,
    invincibleMs: 1200,
  },
  lives: {
    max: 3,
    icon: 'assets/life_guinea.webp',
  },

  // 3. 피해야 할 아이템 — 실버 (현재 임시 이미지: 장미 -> 추후 칼 이미지로 파일 교체)
  bomb: {
    id: 'silver',
    name: '실버',
    guideDesc: '닿으면 기회가 한 번 줄어듭니다. 세 번 닿으면 게임이 끝나요.',
    image: 'assets/bomb_silver.png',
    size: 54,
    hitboxScale: 0.56,
  },

  // 4. 배역별 캐릭터 & 아이콘 & 결과 화면 문구 (고객 전달용 문구 영역)
  roles: [
    {
      id: 'simon',
      name: '사이먼',
      themeColor: '#3f5682',
      bgTint: '#e7e8ec',
      characterImage: 'assets/char_simon.webp',
      resultTitle: '사이먼',
      resultComment: '도넛과 힙플라스크를 가장 많이 모았어요. 오늘의 배역은 사이먼!',
      items: [
        { id: 'simon_donut', name: '도넛', image: 'assets/item_simon_1.webp' },
        { id: 'simon_flask', name: '힙플라스크', image: 'assets/item_simon_2.webp' },
      ],
    },
    {
      id: 'goldmund',
      name: '골드문트',
      themeColor: '#856442',
      bgTint: '#efe5d6',
      characterImage: 'assets/char_goldmund.webp',
      resultTitle: '골드문트',
      resultComment: '은색십자가와 가면을 가장 많이 모았어요. 오늘의 배역은 골드문트!',
      items: [
        { id: 'goldmund_cross', name: '은색십자가', image: 'assets/item_goldmund_1.webp' },
        { id: 'goldmund_mask', name: '가면', image: 'assets/item_goldmund_2.webp' },
      ],
    },
    {
      id: 'philos',
      name: '필로스',
      themeColor: '#6d4b7d',
      bgTint: '#eae2ec',
      characterImage: 'assets/char_philos.webp',
      resultTitle: '필로스',
      resultComment: '나비와 금색목걸이를 가장 많이 모았어요. 오늘의 배역은 필로스!',
      items: [
        { id: 'philos_butterfly', name: '나비', image: 'assets/item_philos_1.webp' },
        { id: 'philos_necklace', name: '금색목걸이', image: 'assets/item_philos_2.webp' },
      ],
    },
    {
      id: 'remy',
      name: '레미',
      themeColor: '#9c3b38',
      bgTint: '#f0dfdd',
      characterImage: 'assets/char_remy.webp',
      resultTitle: '레미',
      resultComment: '피와 체스말을 가장 많이 모았어요. 오늘의 배역은 레미!',
      items: [
        { id: 'remy_blood', name: '피', image: 'assets/item_remy_1.webp' },
        { id: 'remy_chess', name: '체스말', image: 'assets/item_remy_2.webp' },
      ],
    },
  ],

  // 소품을 하나도 못 먹고(모두 0개) 종료되었을 때 뜨는 기본 결과
  fallbackRole: {
    id: 'basic',
    name: '박경호',
    themeColor: '#462d28',
    bgTint: '#ebe2d5',
    characterImage: 'assets/char_basic.webp',
    resultTitle: '준비 중인 경호',
    resultComment: '아직 모은 소품이 없어요. 다시 한 번 도전해 볼까요?',
  },

  // 5. 점수 설정 (현재는 기본 점수만 적용 / 추후 고객 요청 시 콤보·생존 점수 숫자만 올리면 바로 활성화됨)
  scoring: {
    baseItemScore: 100,   // 소품 1개당 기본 점수
    comboStepScore: 0,    // 연속 획득(놓치면 초기화) 콤보 가산점 — 예: 15 로 변경 시 활성화
    maxComboBonus: 0,     // 콤보 가산점 상한 — 예: 150 으로 변경 시 활성화
    survivalTickScore: 0, // 생존 1초당 점수 — 예: 5 로 변경 시 활성화
    itemSize: 54,
    itemHitboxScale: 0.92,
  },

  survival: {
    chillEndSec: 15,          // 0~15초: 여유로운 초반 구간
    climaxStartSec: 26,       // 26초~: 고난도 리듬 패턴 구간 시작
    climaxDurationSec: 11.5,  // 몰아치는 구간 유지 시간
    breatherDurationSec: 4.5, // 숨 고르기 구간 유지 시간
  },

  audio: {
    bgmVolume: 0.05,
    sfxVolume: 0.12,
  },
};
