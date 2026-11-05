/**
 * PKH-maker3 설정 파일
 * 칼(실버) 이미지 수령 시 public/assets/bomb_silver.png 파일만 교체하시면 됩니다.
 */
window.PKH_CONFIG = {
  // 1. 타이틀 & 로고 설정
  brand: {
    title: 'P.K.H☆ MAKER3',
    logoImage: 'assets/logo.webp',
    playButtonImage: 'assets/btn_play.webp',
    stageBackground: 'assets/bg_stage.webp',
    subtitle: 'P.K.H☆의 운명을 결정할\n운명의 징표를 모아보세요',
    simpleRules: '좌우로 이동 · 주어진 기회는 세 번!',
    guideIntro:
      '좌우로 움직이며 운명을 상징하는 징표를 모아보세요.\n당신의 선택에 따라 P.K.H☆의 운명이 결정됩니다.',
  },

  // 2. 플레이어(기니피그) & 기회(목숨) 설정
  canvas: {
    width: 450,
    height: 800,
  },
  player: {
    image: 'assets/char_guinea.webp',
    size: 112,
    y: 668,
    minX: 58,
    maxX: 392,
    keyboardSpeed: 465,
    invincibleMs: 1200,
  },
  lives: {
    max: 3,
    icon: 'assets/life_guinea.webp',
  },

  // 3. 피해야 할 소품 — 실버 (현재 임시 이미지: 장미 -> 추후 칼 이미지로 파일 교체)
  bomb: {
    id: 'silver',
    name: '실버',
    guideDesc:
      '위험한 소품입니다! 닿을 때마다 남은 기회가 하나씩 줄어듭니다. 세 번의 실수로 P.K.H☆ 여정이 끝날 수 있으니 조심하세요!',
    image: 'assets/bomb_silver.png',
    size: 54,
    hitboxScale: 0.56,
  },

  // 4. 배역별 캐릭터 & 징표 & 결과 화면 문구
  roles: [
    {
      id: 'simon',
      name: '사이먼',
      themeColor: '#3f5682',
      bgTint: '#e7e8ec',
      characterImage: 'assets/char_simon.webp',
      resultTitle: '사이먼',
      resultComment:
        '도넛과 힙플라스크가 이끈 운명은 사이먼이었습니다. 모스크바의 낮은 하늘 아래 첫발을 내디딘 당신. 볼티모어에서는 또 어떤 일이 기다리고 있을까요?',
      items: [
        { id: 'simon_donut', name: '엔젤스 도넛', image: 'assets/item_simon_1.webp' },
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
      resultComment:
        '나르치스와 수많은 사랑이 이끈 운명은 골드문트였습니다. 수많은 감각의 조각을 품고 환희의 베일을 걷어낸 끝에 마주할 비밀. 각자의 길 끝에서 만나게 될 마음은 어떤 모습일까요?',
      items: [
        { id: 'goldmund_cross', name: '십자가', image: 'assets/item_goldmund_1.webp' },
        { id: 'goldmund_mask', name: '꽃가면', image: 'assets/item_goldmund_2.webp' },
      ],
    },
    {
      id: 'philos',
      name: '필로스',
      themeColor: '#6d4b7d',
      bgTint: '#eae2ec',
      characterImage: 'assets/char_philos.webp',
      resultTitle: '필로스',
      resultComment:
        '나비와 황금빛 목걸이가 이끈 운명은 필로스였습니다\n맨하튼의 작은 빈티지샵에서 펼쳐지는 연극 속으로 당신을 초대합니다. 나만의 신을 따라 광야를 찾아나서볼까요?',
      items: [
        { id: 'philos_butterfly', name: '나비', image: 'assets/item_philos_1.webp' },
        { id: 'philos_necklace', name: '황금빛 목걸이', image: 'assets/item_philos_2.webp' },
      ],
    },
    {
      id: 'remy',
      name: '레미',
      themeColor: '#9c3b38',
      bgTint: '#f0dfdd',
      characterImage: 'assets/char_remy.webp',
      resultTitle: '레미',
      resultComment:
        '새빨간 피와 300년 후 미래에서 온 선물이 이끈 운명은 레미였습니다. 새빨간 열매보다, 새빨간 보석보다 더 아름다운 레미와 시간을 거스르는 뱀파이어 로맨스를 완성해 볼까요?',
      items: [
        { id: 'remy_blood', name: '달콤한 피', image: 'assets/item_remy_1.webp' },
        { id: 'remy_chess', name: '300년 후 선물', image: 'assets/item_remy_2.webp' },
      ],
    },
  ],

  // 5) 최다 획득 징표가 2개 이상 동률일 때 — 히든 엔딩 P.K.H☆ (기본.png)
  hiddenRole: {
    id: 'basic',
    name: 'P.K.H☆',
    themeColor: '#462d28',
    bgTint: '#ebe2d5',
    characterImage: 'assets/char_basic.webp',
    resultTitle: 'P.K.H☆',
    resultComment:
      '운명의 갈림길에서 아직 헤메는 중이군요. 괜찮습니다. 다시 한 번 운명의 갈림길 위에 올라 어떤 미래가 펼쳐질지 도전해보세요!',
  },

  // 6) 0점(징표를 하나도 못 먹고 종료)일 때 — 기니피그 엔딩
  zeroRole: {
    id: 'guinea',
    name: '기니피그',
    themeColor: '#7a583b',
    bgTint: '#efe4d4',
    characterImage: 'assets/char_guinea.webp',
    resultTitle: '인간이 되고 싶었어...',
    resultComment: '꾸...이... 꾸...이꾸이... (재..도전... 재도전...)',
  },

  // 5. 점수 설정 (기본 100점 + 연속 콤보당 +10점(최대 +100점), 암전 구간 전체 2배)
  scoring: {
    baseItemScore: 100,
    comboStepScore: 10,
    maxComboBonus: 100,
    blackoutMultiplier: 2,
    survivalTickScore: 0,
    itemSize: 54,
    itemHitboxScale: 0.92,
  },

  survival: {
    chillEndSec: 15,          // 0~15초: 여유로운 초반 구간
    climaxStartSec: 26,       // 26초~: 암전 및 고난도 리듬 패턴 구간 시작
    climaxDurationSec: 11.5,  // 암전 몰아치기 구간 유지 시간
    breatherDurationSec: 4.5, // 숨 고르기 구간 유지 시간
  },

  audio: {
    bgmVolume: 0.05,
    sfxVolume: 0.12,
  },
};
