(() => {
  'use strict';

  const CFG = window.PKH_CONFIG;
  const W = CFG.canvas.width;
  const H = CFG.canvas.height;

  // =========================================================================
  // 1. 에셋 프리로드
  // =========================================================================
  const IMAGES = {};
  function loadImage(key, src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        IMAGES[key] = img;
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  const hiddenRole = CFG.hiddenRole || CFG.fallbackRole;
  const zeroRole = CFG.zeroRole || hiddenRole;

  async function preloadAssetsStaged() {
    // 1단계: 첫 화면 & 즉시 플레이 핵심 에셋 우선 로드
    const critical = [loadImage('player_basic', CFG.player.image)];
    if (CFG.brand.stageBackground) {
      critical.push(loadImage('bg_stage', CFG.brand.stageBackground));
    }
    await Promise.all(critical);

    // 2단계: 인게임 소품 & 결과 배역 에셋 백그라운드 로드
    const secondary = [
      loadImage('life_guinea', CFG.lives.icon),
      loadImage('bomb_silver', CFG.bomb.image),
      loadImage(`role_char_${hiddenRole.id}`, hiddenRole.characterImage),
      loadImage(`role_char_${zeroRole.id}`, zeroRole.characterImage),
    ];
    if (CFG.player.hurtImage1) secondary.push(loadImage('player_hurt1', CFG.player.hurtImage1));
    if (CFG.player.hurtImage2) secondary.push(loadImage('player_hurt2', CFG.player.hurtImage2));
    CFG.roles.forEach((role) => {
      secondary.push(loadImage(`role_char_${role.id}`, role.characterImage));
      role.items.forEach((it) => {
        secondary.push(loadImage(`item_${it.id}`, it.image));
      });
    });
    return Promise.all(secondary);
  }

  const ROLE_MAP = {};
  const ALL_ROLE_ITEMS = [];
  CFG.roles.forEach((role) => {
    ROLE_MAP[role.id] = role;
    role.items.forEach((it) => {
      ALL_ROLE_ITEMS.push({
        itemId: it.id,
        name: it.name,
        imageKey: `item_${it.id}`,
        roleId: role.id,
        themeColor: role.themeColor,
      });
    });
  });
  ROLE_MAP[hiddenRole.id] = hiddenRole;
  ROLE_MAP[zeroRole.id] = zeroRole;

  // =========================================================================
  // 2. 사운드 합성기
  // =========================================================================
  class StageSound {
    constructor() {
      this.ctx = null;
      this.enabled = localStorage.getItem('pkh_sound_off') !== '1';
      this.bgmTimer = null;
      this.step = 0;
      this.fastMode = false;
    }

    ensureContext() {
      if (!this.enabled) return null;
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }

    setEnabled(flag) {
      this.enabled = flag;
      localStorage.setItem('pkh_sound_off', flag ? '0' : '1');
      if (!flag) {
        this.stopBgm();
      } else if (gameState.phase === 'playing') {
        this.startBgm(this.fastMode);
      }
    }

    tone(freq, duration, type = 'triangle', gainPeak = 0.1, delay = 0, slideTo = null) {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), now + duration);
      }
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(gainPeak, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    playCatch(combo) {
      if (!this.enabled) return;
      const scale = [523.25, 587.33, 659.25, 783.99, 880.0];
      const base = scale[Math.min(scale.length - 1, Math.floor(combo / 4))];
      const v = CFG.audio.sfxVolume;
      this.tone(base, 0.1, 'sine', v);
      this.tone(base * 1.25, 0.12, 'triangle', v * 0.8, 0.04);
    }

    playHit() {
      if (!this.enabled) return;
      const v = CFG.audio.sfxVolume * 1.2;
      this.tone(195, 0.22, 'sawtooth', v, 0, 70);
      this.tone(140, 0.25, 'square', v * 0.65, 0.035, 58);
    }

    playResultReveal() {
      if (!this.enabled) return;
      const v = CFG.audio.sfxVolume;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
        this.tone(f, 0.24, 'triangle', v * 0.8, idx * 0.075);
      });
    }

    startBgm(fast = false) {
      this.stopBgm();
      this.fastMode = fast;
      if (!this.enabled) return;
      this.ensureContext();

      const bpm = fast ? 158 : 118;
      const stepMs = (60 / bpm / 2) * 1000;
      const normalMelody = [523.25, 0, 659.25, 587.33, 783.99, 0, 659.25, 523.25, 587.33, 0, 698.46, 659.25, 587.33, 523.25, 493.88, 0];
      const fastMelody = [659.25, 783.99, 987.77, 783.99, 880.0, 659.25, 987.77, 1046.5, 783.99, 659.25, 587.33, 783.99, 880.0, 987.77, 1174.66, 987.77];
      const bass = fast
        ? [164.81, 164.81, 196.0, 196.0, 220.0, 220.0, 196.0, 246.94]
        : [130.81, 0, 196.0, 0, 146.83, 0, 196.0, 0];

      this.bgmTimer = setInterval(() => {
        if (!this.enabled || gameState.phase !== 'playing') return;
        const notes = this.fastMode ? fastMelody : normalMelody;
        const n = notes[this.step % notes.length];
        const b = bass[Math.floor(this.step / 2) % bass.length];
        const vol = CFG.audio.bgmVolume;
        if (n > 0) {
          this.tone(n, this.fastMode ? 0.1 : 0.15, 'triangle', vol * 0.85);
        }
        if (this.step % 2 === 0 && b > 0) {
          this.tone(b, 0.14, 'sine', vol * 0.9);
        }
        this.step++;
      }, stepMs);
    }

    setFastMode(fast) {
      if (this.fastMode === fast) return;
      this.fastMode = fast;
      if (this.enabled && gameState.phase === 'playing') {
        this.startBgm(fast);
      }
    }

    stopBgm() {
      if (this.bgmTimer) {
        clearInterval(this.bgmTimer);
        this.bgmTimer = null;
      }
    }
  }

  const sound = new StageSound();

  // =========================================================================
  // 3. 스폰 패턴 디렉터 (초반 여유 -> 중반 이후 고난도 리듬 코스)
  // =========================================================================
  const LANES = [66, 130, 193, 257, 320, 384];

  class PatternDirector {
    constructor() {
      this.reset();
    }

    reset() {
      this.nextRandomTimer = 0.32;
      this.noteQueue = [];
      this.waveLevel = 0;
      this.inClimax = false;
      this.lastCycleIdx = -1;
      this.safeLaneCursor = 2;
      this.nonBombStreak = 0;
    }

    buildClimaxChart(startTime, duration, level) {
      const notes = [];
      let t = startTime + 0.25;
      const endTime = startTime + duration - 0.25;
      // 낙하 속도 상향 반영
      const baseSpeed = Math.min(525, 372 + (level - 1) * 34);
      const beat = Math.max(0.138, 0.202 - (level - 1) * 0.013);

      let patternIdx = (level - 1) % 5;

      while (t < endTime) {
        const pType = patternIdx % 5;
        patternIdx++;

        if (pType === 0) {
          // 계단식 연속 낙하
          const dir = Math.random() < 0.5 ? 1 : -1;
          for (let step = 0; step < 5 && t < endTime; step++) {
            const bombLane = dir === 1 ? step : 5 - step;
            const safeLane = dir === 1 ? 5 : 0;
            notes.push({ fireAt: t, x: LANES[bombLane], isBomb: true, speed: baseSpeed });
            if (level >= 2 && step % 2 === 1) {
              const secondBomb = Math.max(0, Math.min(5, bombLane + (dir === 1 ? -1 : 1)));
              if (secondBomb !== safeLane) {
                notes.push({ fireAt: t, x: LANES[secondBomb], isBomb: true, speed: baseSpeed });
              }
            }
            if (step % 2 === 0) {
              notes.push({ fireAt: t, x: LANES[safeLane], isBomb: false, speed: baseSpeed * 0.96 });
            }
            t += beat;
          }
          t += beat * 1.25;
        } else if (pType === 1) {
          // 지그재그 S자 동선
          let safe = this.safeLaneCursor;
          let moveDir = safe >= 3 ? -1 : 1;
          for (let s = 0; s < 6 && t < endTime; s++) {
            if (s % 2 === 0) {
              notes.push({ fireAt: t, x: LANES[safe], isBomb: false, speed: baseSpeed });
            }
            for (let l = 0; l < 6; l++) {
              if (Math.abs(l - safe) >= 2 && (l + s) % 2 === 0) {
                notes.push({ fireAt: t, x: LANES[l], isBomb: true, speed: baseSpeed });
              }
            }
            safe += moveDir;
            if (safe <= 1) moveDir = 1;
            if (safe >= 4) moveDir = -1;
            t += beat * 1.15;
          }
          this.safeLaneCursor = safe;
          t += beat * 1.15;
        } else if (pType === 2) {
          // 좌우 통로 이동 패턴
          for (let g = 0; g < 3 && t < endTime; g++) {
            const shift = Math.floor(Math.random() * 3) - 1;
            const gateLeft = Math.max(0, Math.min(4, this.safeLaneCursor + shift * 2));
            this.safeLaneCursor = gateLeft;
            for (let l = 0; l < 6; l++) {
              if (l === gateLeft || l === gateLeft + 1) {
                if (l === gateLeft) {
                  notes.push({ fireAt: t, x: (LANES[gateLeft] + LANES[gateLeft + 1]) / 2, isBomb: false, speed: baseSpeed });
                }
              } else if (l % 2 === 0 || level >= 2) {
                notes.push({ fireAt: t, x: LANES[l], isBomb: true, speed: baseSpeed });
              }
            }
            t += beat * 2.05;
          }
        } else if (pType === 3) {
          // 교차 소나기
          for (let k = 0; k < 4 && t < endTime; k++) {
            const parity = k % 2;
            for (let l = 0; l < 6; l++) {
              if (l % 2 === parity) {
                notes.push({ fireAt: t, x: LANES[l], isBomb: true, speed: baseSpeed * 0.95 });
              } else if (l === (parity === 0 ? 3 : 2)) {
                notes.push({ fireAt: t, x: LANES[l], isBomb: false, speed: baseSpeed * 0.95 });
              }
            }
            t += beat * 1.8;
          }
          t += beat;
        } else {
          // 양옆 좁혀오기 패턴
          const pairs = [
            [0, 5],
            [1, 4],
            [0, 5],
          ];
          for (let idx = 0; idx < pairs.length && t < endTime; idx++) {
            const [a, b] = pairs[idx];
            notes.push({ fireAt: t, x: LANES[a], isBomb: true, speed: baseSpeed });
            notes.push({ fireAt: t, x: LANES[b], isBomb: true, speed: baseSpeed });
            if (idx === 1) {
              notes.push({ fireAt: t, x: (LANES[2] + LANES[3]) / 2, isBomb: false, speed: baseSpeed });
            }
            t += beat * 1.25;
          }
          t += beat * 1.4;
        }
      }

      return notes;
    }

    update(dt, elapsed, spawnCallback, onClimaxStateChange) {
      const { chillEndSec, climaxStartSec, climaxDurationSec, breatherDurationSec } = CFG.survival;

      if (elapsed >= climaxStartSec) {
        const cycleLen = climaxDurationSec + breatherDurationSec;
        const sinceClimax = elapsed - climaxStartSec;
        const cycleIdx = Math.floor(sinceClimax / cycleLen);
        const posInCycle = sinceClimax - cycleIdx * cycleLen;
        const nowClimax = posInCycle < climaxDurationSec;

        if (nowClimax && (!this.inClimax || this.lastCycleIdx !== cycleIdx)) {
          this.inClimax = true;
          this.lastCycleIdx = cycleIdx;
          this.waveLevel = cycleIdx + 1;
          this.noteQueue = this.buildClimaxChart(elapsed, climaxDurationSec - posInCycle, this.waveLevel);
          onClimaxStateChange(true);
        } else if (!nowClimax && this.inClimax) {
          this.inClimax = false;
          this.noteQueue = [];
          this.nextRandomTimer = 0.22;
          onClimaxStateChange(false);
        }
      }

      if (this.inClimax) {
        while (this.noteQueue.length > 0 && this.noteQueue[0].fireAt <= elapsed) {
          const note = this.noteQueue.shift();
          const jitter = (Math.random() - 0.5) * 10;
          spawnCallback({
            x: Math.max(54, Math.min(W - 54, note.x + jitter)),
            isBomb: note.isBomb,
            speed: note.speed,
          });
        }
        return;
      }

      this.nextRandomTimer -= dt;
      if (this.nextRandomTimer > 0) return;

      if (elapsed < chillEndSec) {
        // 초반 구간: 설렁설렁하되 실버(칼)가 심심하지 않게 꾸준히 섞여서 등장
        const progress = elapsed / chillEndSec;
        this.nextRandomTimer = 0.49 - progress * 0.09;
        const speed = 236 + progress * 46 + (Math.random() - 0.5) * 28;
        let isBomb = elapsed > 0.8 && Math.random() < 0.34;
        if (elapsed > 1.2 && this.nonBombStreak >= 2) {
          isBomb = true;
        }
        this.nonBombStreak = isBomb ? 0 : this.nonBombStreak + 1;

        const x1 = 58 + Math.random() * (W - 116);
        spawnCallback({ x: x1, isBomb, speed });

        // 초반 중반부터 가끔 반대편에 하나 더 함께 드롭
        if (elapsed > 4.0 && Math.random() < 0.24) {
          const x2 = x1 < W / 2 ? W / 2 + 45 + Math.random() * 125 : 58 + Math.random() * 125;
          spawnCallback({ x: x2, isBomb: !isBomb && Math.random() < 0.45, speed: speed * 0.96 });
        }
      } else if (elapsed < climaxStartSec) {
        // 중반 진입 전 워밍업: 실버 빈도와 낙하 속도 점진 상승
        const progress = (elapsed - chillEndSec) / (climaxStartSec - chillEndSec);
        this.nextRandomTimer = 0.40 - progress * 0.08;
        const speed = 288 + progress * 64 + (Math.random() - 0.5) * 34;
        const x1 = 58 + Math.random() * (W - 116);
        const bombChance = 0.38 + progress * 0.1;
        let isBomb = Math.random() < bombChance;
        if (this.nonBombStreak >= 2) isBomb = true;
        this.nonBombStreak = isBomb ? 0 : this.nonBombStreak + 1;

        spawnCallback({ x: x1, isBomb, speed });

        if (Math.random() < 0.36) {
          const x2 = x1 < W / 2 ? W / 2 + 45 + Math.random() * 125 : 58 + Math.random() * 125;
          spawnCallback({ x: x2, isBomb: !isBomb && Math.random() < 0.4, speed: speed * 0.95 });
        }
      } else {
        // 코스 사이 짧은 숨 고르기 구간
        this.nextRandomTimer = 0.27;
        const speed = Math.min(435, 325 + this.waveLevel * 18);
        const isBomb = Math.random() < 0.26;
        spawnCallback({
          x: 58 + Math.random() * (W - 116),
          isBomb,
          speed,
        });
      }
    }
  }

  const director = new PatternDirector();

  // =========================================================================
  // 4. 게임 상태 & 인증/랭킹 상태
  // =========================================================================
  const LOCAL_RANK_KEY = 'pkh_maker3_local_ranks_v1';

  const authState = {
    token: localStorage.getItem('pkh_auth_token') || '',
    user: null,
    pendingResult: null,
  };

  const gameState = {
    phase: 'title',
    score: 0,
    survivalSec: 0,
    secondAccumulator: 0,
    combo: 0,
    lives: CFG.lives.max,
    caughtTotal: 0,
    roleCounts: { simon: 0, goldmund: 0, philos: 0, remy: 0 },
    lastRoleOrder: [],
    player: {
      x: W / 2,
      targetX: null,
      vx: 0,
      scaleX: 1,
      scaleY: 1,
      walkPhase: 0,
      invincibleTimer: 0,
    },
    items: [],
    particles: [],
    floatingTexts: [],
    climaxActive: false,
    climaxBlend: 0,
    screenShake: 0,
    hurtFlash: 0,
  };

  const keys = { left: false, right: false };

  // =========================================================================
  // 5. DOM 참조
  // =========================================================================
  const canvas = document.getElementById('stage-canvas');
  const ctx = canvas.getContext('2d');

  const elScreenStart = document.getElementById('screen-start');
  const elScreenPause = document.getElementById('screen-pause');
  const elScreenResult = document.getElementById('screen-result');

  const btnSound = document.getElementById('btn-sound');
  const elSoundLabel = document.getElementById('sound-label');
  const btnPause = document.getElementById('btn-pause');
  const btnOpenAuth = document.getElementById('btn-open-auth');
  const elAccountText = document.getElementById('account-pill-text');

  const elHudLives = document.getElementById('hud-lives');
  const elHudLifeIcons = Array.from(document.querySelectorAll('#hud-lives .hud-life-icon'));
  const elHudStats = document.getElementById('hud-stats');
  const elHudTime = document.getElementById('hud-time');
  const elHudScore = document.getElementById('hud-score');

  const modalAuth = document.getElementById('modal-auth');
  const modalRanking = document.getElementById('modal-ranking');
  const modalGuide = document.getElementById('modal-guide');

  function syncTopHudDOM() {
    const inTitle = gameState.phase === 'title';
    btnOpenAuth.hidden = !inTitle;
    elHudLives.hidden = inTitle;
    elHudStats.hidden = inTitle;

    if (!inTitle) {
      elHudTime.textContent = formatDuration(gameState.survivalSec);
      elHudScore.textContent = Math.floor(gameState.score).toLocaleString();
      elHudLifeIcons.forEach((img, idx) => {
        img.classList.toggle('lost', idx >= gameState.lives);
      });
    }
  }

  function setupHiDPICanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let guideRendered = false;
  function ensureGuideRendered() {
    if (guideRendered) return;
    guideRendered = true;
    const guideGrid = document.getElementById('guide-roles-grid');
    guideGrid.innerHTML = CFG.roles
      .map(
        (r) => `
        <div class="guide-card">
          <div class="guide-card-top">
            <img src="${r.characterImage}" alt="${r.name}" class="guide-sd" loading="lazy" decoding="async" draggable="false" />
            <span class="guide-role-title">${r.name}</span>
          </div>
          <div class="guide-props">
            ${r.items
              .map(
                (it) => `
              <div class="guide-prop">
                <img src="${it.image}" alt="${it.name}" loading="lazy" decoding="async" draggable="false" />
                <span>${it.name}</span>
              </div>`
              )
              .join('')}
          </div>
        </div>`
      )
      .join('');
    setImgIfChanged(document.getElementById('guide-bomb-img'), CFG.bomb.image);
    document.getElementById('guide-bomb-name').textContent = CFG.bomb.name;
    document.getElementById('guide-bomb-desc').textContent = CFG.bomb.guideDesc;
  }

  function setImgIfChanged(imgEl, nextSrc) {
    if (imgEl && nextSrc && imgEl.getAttribute('src') !== nextSrc) {
      imgEl.src = nextSrc;
    }
  }

  function applyBrandConfig() {
    document.title = CFG.brand.title;
    document.getElementById('start-subtitle').innerHTML = CFG.brand.subtitle.replace(/\n/g, '<br />');
    const simpleRulesEl = document.getElementById('start-simple-rules');
    if (simpleRulesEl && CFG.brand.simpleRules) {
      simpleRulesEl.textContent = CFG.brand.simpleRules;
    }
    const guideIntroEl = document.getElementById('guide-intro-text');
    if (guideIntroEl && CFG.brand.guideIntro) {
      guideIntroEl.innerHTML = CFG.brand.guideIntro.replace(/\n/g, '<br />');
    }
    setImgIfChanged(document.getElementById('start-hero-img'), CFG.player.image);

    // 로고 영역 (추후 로고 이미지 등록 시 점선 박스 대신 로고 이미지 노출)
    const logoSlot = document.getElementById('logo-slot');
    const logoLabel = document.getElementById('logo-placeholder-label');
    const logoImg = document.getElementById('brand-logo-img');
    if (CFG.brand.logoImage) {
      logoSlot.classList.add('has-logo');
      logoLabel.hidden = true;
      setImgIfChanged(logoImg, CFG.brand.logoImage);
      logoImg.hidden = false;
    } else {
      logoSlot.classList.remove('has-logo');
      logoLabel.hidden = false;
      logoImg.hidden = true;
    }

    // 시작하기 버튼 이미지 적용
    const startBtn = document.getElementById('btn-start-game');
    const startBtnLabel = document.getElementById('start-btn-label');
    const startBtnImg = document.getElementById('start-btn-img');
    if (CFG.brand.playButtonImage) {
      startBtn.classList.add('has-play-img');
      startBtnLabel.hidden = true;
      setImgIfChanged(startBtnImg, CFG.brand.playButtonImage);
      startBtnImg.hidden = false;
    } else {
      startBtn.classList.remove('has-play-img');
      startBtnLabel.hidden = false;
      startBtnImg.hidden = true;
    }

    elHudLifeIcons.forEach((img) => {
      setImgIfChanged(img, CFG.lives.icon);
    });

    syncSoundButtonUI();
  }

  function syncSoundButtonUI() {
    btnSound.setAttribute('aria-pressed', sound.enabled ? 'true' : 'false');
    elSoundLabel.textContent = '♪';
  }

  // =========================================================================
  // 6. 인증 & 랭킹 API 연동
  // =========================================================================
  async function apiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (authState.token) {
      headers.Authorization = `Bearer ${authState.token}`;
    }
    const res = await fetch(path, { ...options, headers });
    const data = await res.json();
    return { status: res.status, data };
  }

  function getLocalStore() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_RANK_KEY) || '[]');
    } catch {
      return [];
    }
  }
  function saveLocalStore(list) {
    localStorage.setItem(LOCAL_RANK_KEY, JSON.stringify(list));
  }

  function updateAccountUI() {
    const loggedBox = document.getElementById('auth-logged-box');
    const loggedSummary = document.getElementById('auth-logged-summary');
    if (authState.user) {
      const bestTxt =
        authState.user.bestScore > 0 ? ` · ${authState.user.bestScore.toLocaleString()}점` : '';
      elAccountText.textContent = `${authState.user.nickname}${bestTxt}`;
      loggedBox.hidden = false;
      loggedSummary.textContent = `현재 닉네임: ${authState.user.nickname}`;
    } else {
      elAccountText.textContent = '닉네임 등록';
      loggedBox.hidden = true;
    }
  }

  async function restoreSession() {
    if (!authState.token) {
      updateAccountUI();
      return;
    }
    try {
      const { status, data } = await apiFetch('/api/me');
      if (status === 200 && data.ok) {
        authState.user = data.user;
      } else if (status === 401) {
        authState.token = '';
        localStorage.removeItem('pkh_auth_token');
      }
    } catch {
      const savedLocalNick = localStorage.getItem('pkh_local_nick');
      if (savedLocalNick) {
        const entry = getLocalStore().find(
          (u) => u.nickname.toLowerCase() === savedLocalNick.toLowerCase()
        );
        if (entry) authState.user = entry;
      }
    }
    updateAccountUI();
  }

  async function handleAuthSubmit(nickname, pin) {
    if (!nickname) {
      return { ok: false, error: '닉네임을 입력해 주세요.' };
    }
    if (nickname.length > 10) {
      return { ok: false, error: '닉네임은 최대 10자까지 입력해 주세요.' };
    }
    try {
      const { data } = await apiFetch('/api/auth', {
        method: 'POST',
        body: JSON.stringify({ nickname, pin }),
      });
      if (!data.ok) {
        return { ok: false, error: data.error || '등록에 실패했습니다.' };
      }
      authState.token = data.token;
      authState.user = data.user;
      localStorage.setItem('pkh_auth_token', data.token);
      updateAccountUI();

      if (authState.pendingResult) {
        const pending = authState.pendingResult;
        authState.pendingResult = null;
        await submitScoreToServer(pending);
      }
      return { ok: true };
    } catch {
      const list = getLocalStore();
      const idx = list.findIndex((u) => u.nickname.toLowerCase() === nickname.toLowerCase());
      let userObj;
      if (idx === -1) {
        userObj = {
          nickname,
          pin,
          bestScore: 0,
          bestCharacter: 'basic',
          bestSurvivalSec: 0,
          playCount: 0,
          updatedAt: Date.now(),
        };
        list.push(userObj);
        saveLocalStore(list);
      } else {
        if (list[idx].pin !== pin) {
          return { ok: false, error: '이미 등록된 닉네임입니다. PIN 번호를 확인해 주세요.' };
        }
        userObj = list[idx];
      }
      authState.token = 'local-mode';
      authState.user = userObj;
      localStorage.setItem('pkh_auth_token', 'local-mode');
      localStorage.setItem('pkh_local_nick', userObj.nickname);
      updateAccountUI();

      if (authState.pendingResult) {
        const pending = authState.pendingResult;
        authState.pendingResult = null;
        await submitScoreToServer(pending);
      }
      return { ok: true };
    }
  }

  async function submitScoreToServer(payload) {
    const rankMsgEl = document.getElementById('result-rank-msg');
    const regBtnEl = document.getElementById('btn-result-register');
    const newRecEl = document.getElementById('result-new-record');

    if (!authState.user) {
      authState.pendingResult = payload;
      rankMsgEl.textContent =
        payload.score > 0
          ? '닉네임을 등록하면 랭킹에 점수를 남길 수 있어요.'
          : '닉네임을 등록해 두면 다음 도전 점수가 바로 기록됩니다.';
      regBtnEl.textContent =
        payload.score > 0 ? '닉네임 입력하고 이 점수 기록하기' : '닉네임 등록해 두기';
      regBtnEl.hidden = false;
      return;
    }

    regBtnEl.hidden = true;
    rankMsgEl.textContent = '기록 저장 중...';

    try {
      const { data } = await apiFetch('/api/score', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (data.ok) {
        authState.user = data.user;
        updateAccountUI();
        if (data.isNewRecord && payload.score > 0) {
          newRecEl.hidden = false;
        }
        const rankStr = data.myRank ? `현재 ${data.myRank}위` : '기록 저장 완료';
        rankMsgEl.textContent = `${authState.user.nickname} · ${rankStr} (최고 ${authState.user.bestScore.toLocaleString()}점)`;
        return;
      }
      rankMsgEl.textContent = data.error || '점수를 저장하지 못했습니다.';
    } catch {
      const list = getLocalStore();
      const idx = list.findIndex(
        (u) => u.nickname.toLowerCase() === authState.user.nickname.toLowerCase()
      );
      if (idx !== -1) {
        if (payload.score > (list[idx].bestScore || 0)) {
          list[idx].bestScore = payload.score;
          list[idx].bestCharacter = payload.characterId;
          list[idx].bestSurvivalSec = payload.survivalSec;
          list[idx].updatedAt = Date.now();
          newRecEl.hidden = false;
        }
        list[idx].playCount = (list[idx].playCount || 0) + 1;
        saveLocalStore(list);
        authState.user = list[idx];
        updateAccountUI();
      }
      const sorted = getLocalRankingsSorted();
      const meRow = sorted.find((r) => r.isMe);
      const myRank = meRow ? meRow.rank : null;
      rankMsgEl.textContent = `${authState.user.nickname} · ${myRank ? `${myRank}위` : '-'} (최고 ${authState.user.bestScore.toLocaleString()}점)`;
    }
  }

  function getLocalRankingsSorted() {
    const list = getLocalStore()
      .filter((u) => u.bestScore > 0)
      .sort((a, b) => b.bestScore - a.bestScore || a.updatedAt - b.updatedAt);
    let prevScore = null;
    let currentRank = 0;
    return list.map((u, i) => {
      if (u.bestScore !== prevScore) {
        currentRank = i + 1;
        prevScore = u.bestScore;
      }
      return {
        rank: currentRank,
        nickname: u.nickname,
        bestScore: u.bestScore,
        bestCharacter: u.bestCharacter || 'basic',
        bestSurvivalSec: u.bestSurvivalSec || 0,
        isMe: authState.user
          ? u.nickname.toLowerCase() === authState.user.nickname.toLowerCase()
          : false,
      };
    });
  }

  async function fetchAndRenderRankingBoard() {
    const listEl = document.getElementById('ranking-list');
    listEl.innerHTML = '<li class="rank-empty">불러오는 중...</li>';

    try {
      const { data } = await apiFetch('/api/rankings');
      if (data.ok) {
        renderRankingListDOM(data.rankings, data.totalPlayers, data.myRank);
        return;
      }
    } catch {
      const localRanks = getLocalRankingsSorted();
      const meRow = localRanks.find((r) => r.isMe);
      renderRankingListDOM(localRanks, localRanks.length, meRow ? meRow.rank : null);
    }
  }

  function formatDuration(sec) {
    const s = Math.max(0, Math.floor(sec));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return map[ch];
    });
  }

  function renderRankingListDOM(rankings, totalPlayers, myRank) {
    const listEl = document.getElementById('ranking-list');
    const metaEl = document.getElementById('ranking-meta-text');
    const myBarText = document.getElementById('my-rank-bar-text');
    const myLoginBtn = document.getElementById('btn-rank-login');

    metaEl.textContent = totalPlayers > 0 ? `참여 ${totalPlayers.toLocaleString()}명` : '';

    if (!rankings || rankings.length === 0) {
      listEl.innerHTML = '<li class="rank-empty">아직 등록된 기록이 없습니다.</li>';
    } else {
      listEl.innerHTML = rankings
        .map((r) => {
          const rankClass = r.rank === 1 ? 'rank-1' : '';
          const meClass = r.isMe ? 'is-me' : '';
          const roleObj = ROLE_MAP[r.bestCharacter] || hiddenRole;
          return `
          <li class="rank-row ${rankClass} ${meClass}">
            <span class="rank-no">${r.rank}</span>
            <div class="rank-info">
              <div class="rank-name-line">
                <span class="rank-nick">${escapeHtml(r.nickname)}</span>
                ${r.isMe ? '<span class="my-tag">나</span>' : ''}
              </div>
            </div>
            <div class="rank-char-badge" style="--role-tint:${roleObj.bgTint || '#ebe2d5'}" title="${escapeHtml(roleObj.name)}">
              <img src="${roleObj.characterImage}" alt="${escapeHtml(roleObj.name)}" class="rank-char-icon" loading="lazy" decoding="async" draggable="false" />
            </div>
            <span class="rank-pt">${Number(r.bestScore).toLocaleString()}점</span>
          </li>`;
        })
        .join('');
    }

    if (authState.user) {
      myLoginBtn.hidden = true;
      if (authState.user.bestScore > 0) {
        myBarText.textContent = `내 최고 기록: ${authState.user.bestScore.toLocaleString()}점 (${
          myRank ? `${myRank}위` : '-'
        })`;
      } else {
        myBarText.textContent = `${authState.user.nickname} 님, 아직 등록된 점수가 없습니다.`;
      }
    } else {
      myLoginBtn.hidden = false;
      myBarText.textContent = '닉네임을 등록하면 내 순위가 표시됩니다.';
    }
  }

  // =========================================================================
  // 7. 인게임 진행 & 결과 캐릭터 판정
  // =========================================================================
  function startNewGame() {
    director.reset();

    gameState.phase = 'playing';
    gameState.score = 0;
    gameState.survivalSec = 0;
    gameState.secondAccumulator = 0;
    gameState.combo = 0;
    gameState.lives = CFG.lives.max;
    gameState.caughtTotal = 0;
    gameState.roleCounts = { simon: 0, goldmund: 0, philos: 0, remy: 0 };
    gameState.lastRoleOrder = [];
    gameState.items = [];
    gameState.particles = [];
    gameState.floatingTexts = [];
    gameState.climaxActive = false;
    gameState.climaxBlend = 0;
    gameState.screenShake = 0;
    gameState.hurtFlash = 0;

    const p = gameState.player;
    p.x = W / 2;
    p.targetX = null;
    p.vx = 0;
    p.scaleX = 1;
    p.scaleY = 1;
    p.walkPhase = 0;
    p.invincibleTimer = 0;

    elScreenStart.hidden = true;
    elScreenPause.hidden = true;
    elScreenResult.hidden = true;
    btnPause.hidden = false;
    syncTopHudDOM();

    sound.startBgm(false);
  }

  function spawnStageObject({ x, isBomb, speed }) {
    if (isBomb) {
      gameState.items.push({
        isBomb: true,
        x,
        y: 52,
        vy: speed,
        size: CFG.bomb.size,
        rot: (Math.random() - 0.5) * 0.25,
        rotSpeed: (Math.random() - 0.5) * 1.4,
        imageKey: 'bomb_silver',
        roleId: null,
        themeColor: '#9e2a3b',
      });
    } else {
      const chosen = ALL_ROLE_ITEMS[Math.floor(Math.random() * ALL_ROLE_ITEMS.length)];
      gameState.items.push({
        isBomb: false,
        x,
        y: 52,
        vy: speed,
        size: CFG.scoring.itemSize,
        rot: (Math.random() - 0.5) * 0.22,
        rotSpeed: (Math.random() - 0.5) * 1.0,
        imageKey: chosen.imageKey,
        roleId: chosen.roleId,
        themeColor: chosen.themeColor,
      });
    }
  }

  function emitParticles(x, y, color, count = 7) {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const spd = 60 + Math.random() * 110;
      gameState.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 35,
        size: 3 + Math.random() * 3.5,
        color,
        life: 0.4 + Math.random() * 0.2,
        maxLife: 0.6,
      });
    }
  }

  function addFloatingText(x, y, text, color = '#261b18', comboLabel = '') {
    gameState.floatingTexts.push({
      x,
      y,
      text,
      comboLabel,
      color,
      life: 0.68,
      maxLife: 0.68,
    });
  }

  function determineResultCharacter() {
    let maxCount = 0;
    CFG.roles.forEach((r) => {
      const c = gameState.roleCounts[r.id] || 0;
      if (c > maxCount) maxCount = c;
    });

    // 6) 0점(징표 0개 획득 후 종료) -> 기니피그 엔딩 ('인간이 되고 싶었어...')
    if (maxCount === 0 || gameState.score <= 0) {
      return zeroRole;
    }

    const tiedIds = CFG.roles
      .map((r) => r.id)
      .filter((id) => (gameState.roleCounts[id] || 0) === maxCount);

    // 1)~4) 단독 1위 배역 엔딩
    if (tiedIds.length === 1) {
      return ROLE_MAP[tiedIds[0]];
    }

    // 5) 1위 배역이 2개 이상 동률일 때 -> 히든 엔딩 P.K.H☆ (기본.png)
    return hiddenRole;
  }

  function triggerGameOver() {
    gameState.phase = 'gameover';
    btnPause.hidden = true;
    syncTopHudDOM();
    sound.stopBgm();

    const winnerRole = determineResultCharacter();
    const finalScore = Math.floor(gameState.score);
    const finalSec = Math.floor(gameState.survivalSec);

    setTimeout(() => {
      sound.playResultReveal();

      const portraitBg = document.getElementById('result-portrait-bg');
      const charImgEl = document.getElementById('result-char-img');

      portraitBg.style.setProperty('--role-tint', winnerRole.bgTint || '#f3ede2');

      charImgEl.src = winnerRole.characterImage;
      charImgEl.alt = winnerRole.name;

      document.getElementById('result-new-record').hidden = true;
      document.getElementById('result-title').textContent = winnerRole.resultTitle;
      document.getElementById('result-comment').textContent = winnerRole.resultComment;
      document.getElementById('result-score').textContent = finalScore.toLocaleString();
      document.getElementById('result-time').textContent = formatDuration(finalSec);

      const summaryEl = document.getElementById('result-collected-list');
      summaryEl.innerHTML = CFG.roles
        .map((r) => {
          const cnt = gameState.roleCounts[r.id] || 0;
          const isWin = winnerRole.id === r.id && cnt > 0;
          return `
            <div class="tally-item ${isWin ? 'top-role' : ''}">
              <span>${r.name}</span>
              <strong>${cnt}</strong>
            </div>`;
        })
        .join('');

      elScreenResult.hidden = false;

      submitScoreToServer({
        score: finalScore,
        survivalSec: finalSec,
        characterId: winnerRole.id,
        caughtCount: gameState.caughtTotal,
        roleCounts: { ...gameState.roleCounts },
      });
    }, 420);
  }

  function updateVisualDecay(dt) {
    if (gameState.screenShake > 0) {
      gameState.screenShake = Math.max(0, gameState.screenShake - dt * 38);
    }
    if (gameState.hurtFlash > 0) {
      gameState.hurtFlash = Math.max(0, gameState.hurtFlash - dt * 2.8);
    }
    if (gameState.phase === 'title') {
      gameState.climaxBlend = 0;
    }
  }

  function updateGame(dt) {
    if (gameState.phase !== 'playing') return;

    gameState.survivalSec += dt;
    gameState.secondAccumulator += dt;
    if (gameState.secondAccumulator >= 1) {
      const whole = Math.floor(gameState.secondAccumulator);
      gameState.secondAccumulator -= whole;
      gameState.score += whole * CFG.scoring.survivalTickScore;
    }

    const targetBlend = gameState.climaxActive ? 1 : 0;
    gameState.climaxBlend += (targetBlend - gameState.climaxBlend) * Math.min(1, dt * 2.2);

    const p = gameState.player;
    const prevX = p.x;
    if (keys.left || keys.right) {
      p.targetX = null;
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      p.x += dir * CFG.player.keyboardSpeed * dt;
    } else if (p.targetX !== null) {
      const diff = p.targetX - p.x;
      p.x += diff * Math.min(1, dt * 22);
    }
    p.x = Math.max(CFG.player.minX, Math.min(CFG.player.maxX, p.x));
    p.vx = (p.x - prevX) / Math.max(0.001, dt);

    if (Math.abs(p.vx) > 20) {
      p.walkPhase += dt * 16;
    } else {
      p.walkPhase += dt * 3;
    }

    p.scaleX += (1 - p.scaleX) * Math.min(1, dt * 14);
    p.scaleY += (1 - p.scaleY) * Math.min(1, dt * 14);
    if (p.invincibleTimer > 0) p.invincibleTimer = Math.max(0, p.invincibleTimer - dt);

    director.update(dt, gameState.survivalSec, spawnStageObject, (isClimax) => {
      gameState.climaxActive = isClimax;
      sound.setFastMode(isClimax);
    });

    const playerHitRadius = CFG.player.size * 0.34;
    const playerCenterY = CFG.player.y - 6;

    for (let i = gameState.items.length - 1; i >= 0; i--) {
      const it = gameState.items[i];
      it.y += it.vy * dt;
      it.rot += it.rotSpeed * dt;

      const dx = it.x - p.x;
      const dy = it.y - playerCenterY;
      const dist = Math.hypot(dx, dy);

      const itemRadius = it.isBomb
        ? (it.size * CFG.bomb.hitboxScale) / 2
        : (it.size * CFG.scoring.itemHitboxScale) / 2;

      if (dist < playerHitRadius + itemRadius) {
        if (it.isBomb) {
          if (p.invincibleTimer <= 0) {
            gameState.items.splice(i, 1);
            gameState.lives = Math.max(0, gameState.lives - 1);
            p.invincibleTimer = CFG.player.invincibleMs / 1000;
            p.scaleX = 0.85;
            p.scaleY = 1.15;
            gameState.screenShake = 8;
            gameState.hurtFlash = 0.45;

            sound.playHit();
            emitParticles(it.x, it.y, '#b8424c', 8);

            // 직후 바로 겹친 실버만 정리하여 억울한 연속 피격 방지
            gameState.items = gameState.items.filter(
              (other) => !other.isBomb || Math.hypot(other.x - p.x, other.y - playerCenterY) > 120
            );

            if (gameState.lives <= 0) {
              triggerGameOver();
              return;
            }
          }
          continue;
        } else {
          gameState.items.splice(i, 1);
          gameState.caughtTotal++;
          gameState.combo++;

          gameState.roleCounts[it.roleId] = (gameState.roleCounts[it.roleId] || 0) + 1;
          gameState.lastRoleOrder.push(it.roleId);
          if (gameState.lastRoleOrder.length > 30) gameState.lastRoleOrder.shift();

          const comboCount = Math.max(0, gameState.combo - 1);
          const comboBonus =
            comboCount >= 1
              ? Math.min(CFG.scoring.maxComboBonus, comboCount * CFG.scoring.comboStepScore)
              : 0;
          const isBlackout = gameState.climaxActive || gameState.climaxBlend > 0.45;
          const multiplier = isBlackout ? CFG.scoring.blackoutMultiplier || 2 : 1;
          const gained = Math.round((CFG.scoring.baseItemScore + comboBonus) * multiplier);
          gameState.score += gained;

          p.scaleX = 1.12;
          p.scaleY = 0.89;

          sound.playCatch(gameState.combo);
          emitParticles(it.x, it.y, isBlackout ? '#dfbe6f' : it.themeColor, 7);

          const floatColor = isBlackout ? '#dfbe6f' : comboCount >= 1 ? '#9c4538' : '#261b18';
          const comboLabel = comboCount >= 1 ? `${comboCount} COMBO` : '';
          addFloatingText(p.x, CFG.player.y - 64, `+${gained}`, floatColor, comboLabel);
          continue;
        }
      }

      // 바닥 기준(y > 728): 징표를 하나라도 바닥에 흘리면 콤보 초기화
      if (it.y > 728) {
        if (!it.isBomb) {
          gameState.combo = 0;
        }
        gameState.items.splice(i, 1);
      }
    }

    for (let i = gameState.particles.length - 1; i >= 0; i--) {
      const pt = gameState.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 300 * dt;
      pt.life -= dt;
      if (pt.life <= 0) gameState.particles.splice(i, 1);
    }

    for (let i = gameState.floatingTexts.length - 1; i >= 0; i--) {
      const ft = gameState.floatingTexts[i];
      ft.y -= 42 * dt;
      ft.life -= dt;
      if (ft.life <= 0) gameState.floatingTexts.splice(i, 1);
    }
  }

  // =========================================================================
  // 8. Canvas 렌더링 (손그림 일러스트와 어우러지는 담백한 무대 화면)
  // =========================================================================
  function lerpColor(hexA, hexB, t) {
    const a = parseInt(hexA.slice(1), 16);
    const b = parseInt(hexB.slice(1), 16);
    const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t);
    const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
    const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t);
    return `rgb(${r},${g},${bl})`;
  }

  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawStageBackground(nowSec) {
    const b = gameState.climaxBlend;
    const bgImg = IMAGES.bg_stage;

    if (bgImg) {
      ctx.fillStyle = '#f3d8da';
      ctx.fillRect(0, 0, W, 58);
      ctx.drawImage(bgImg, 0, 56, W, H - 56);

      if (b > 0.01) {
        // 암전 연출: 공연장 조명이 꺼지며 어두워짐
        ctx.fillStyle = `rgba(14, 10, 20, ${0.74 * b})`;
        ctx.fillRect(0, 56, W, H - 56);
      }
    } else if (CFG.brand.stageBackground) {
      // 배경 이미지 디코딩 전에는 CSS 배경(.game-box)이 즉시 보이도록 투명 유지
      ctx.clearRect(0, 0, W, H);
      return;
    } else {
      // 평상시 밝은 크림 무대 -> 중반 고난도 구간 진입 시 밤 공연장 조명 무드로 자연스럽게 전환
      const topWall = lerpColor('#faf5eb', '#252136', b);
      const botWall = lerpColor('#f3eadb', '#38273c', b);
      const bgGrad = ctx.createLinearGradient(0, 0, 0, 726);
      bgGrad.addColorStop(0, topWall);
      bgGrad.addColorStop(1, botWall);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // 은은한 벽지 패턴 (평상시)
      if (b < 0.95) {
        ctx.fillStyle = `rgba(56, 44, 40, ${0.022 * (1 - b)})`;
        for (let x = 20; x < W; x += 40) {
          ctx.fillRect(x, 0, 14, 726);
        }
      }
    }

    // 공연 조명 빔 (고난도 구간에서 서서히 켜짐)
    if (b > 0.02) {
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const anchorX = 95 + i * 130;
        const sway = Math.sin(nowSec * 1.6 + i * 2.1) * 26;
        const beamGrad = ctx.createLinearGradient(anchorX, 52, anchorX + sway, 726);
        beamGrad.addColorStop(0, `rgba(255, 228, 162, ${0.22 * b})`);
        beamGrad.addColorStop(1, 'rgba(255, 228, 162, 0)');
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.moveTo(anchorX - 16, 52);
        ctx.lineTo(anchorX + 16, 52);
        ctx.lineTo(anchorX + sway + 88, 726);
        ctx.lineTo(anchorX + sway - 88, 726);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    if (!bgImg) {
      // 하단 나무 무대 바닥
      const floorY = 724;
      ctx.fillStyle = lerpColor('#d5b58f', '#694a44', b);
      ctx.fillRect(0, floorY, W, H - floorY);

      ctx.fillStyle = lerpColor('#c4a077', '#523735', b);
      ctx.fillRect(0, floorY + 12, W, H - floorY - 12);

      ctx.strokeStyle = '#382c28';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, floorY);
      ctx.lineTo(W, floorY);
      ctx.stroke();
    }
  }

  function drawBottomRoleTally() {
    if (gameState.phase === 'title') return;

    // 하단 무대 바닥: 실시간 배역별 획득 개수 카운터 바 (픽셀 명패 프레임)
    ctx.save();
    const barY = 738;
    const chipW = 98;
    const chipH = 42;
    const gap = 8;
    const startX = Math.round((W - (chipW * 4 + gap * 3)) / 2);

    CFG.roles.forEach((role, idx) => {
      const cx = startX + idx * (chipW + gap);
      const cnt = gameState.roleCounts[role.id] || 0;

      // 좌하단 도트 그림자
      ctx.fillStyle = 'rgba(28, 12, 16, 0.46)';
      ctx.fillRect(cx - 3, barY + 3, chipW, chipH);

      // 로즈 핑크 배경 & 직각 도트 외곽 테두리
      ctx.fillStyle = cnt > 0 ? 'rgba(254, 243, 245, 0.97)' : 'rgba(244, 224, 228, 0.9)';
      ctx.fillRect(cx, barY, chipW, chipH);
      ctx.strokeStyle = '#2b1a1d';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx, barY, chipW, chipH);

      // 안쪽 앤틱 로즈 이중 실선
      ctx.strokeStyle = cnt > 0 ? '#d89fa8' : 'rgba(206, 158, 165, 0.78)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 3, barY + 3, chipW - 6, chipH - 6);

      const iconImg = IMAGES[`item_${role.items[0].id}`];
      if (iconImg) {
        ctx.drawImage(iconImg, cx + 6, barY + 7, 28, 28);
      }
      ctx.fillStyle = '#6e484f';
      ctx.font = '400 11px "DOSMyungjo", serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(role.name, cx + 38, barY + 15);

      ctx.fillStyle = '#2b1a1d';
      ctx.font = '700 13px "Galmuri11Bold", "DOSMyungjo", monospace';
      ctx.fillText(`${cnt}`, cx + 38, barY + 30);
    });
    ctx.restore();
  }

  function drawItemsAndPlayer() {
    // 떨어지는 아이템 (붉은 표시나 인위적인 후광 없이 일러스트 원본 그대로 깔끔하게 출력)
    gameState.items.forEach((it) => {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(it.rot);
      const img = IMAGES[it.imageKey];
      if (img) {
        ctx.drawImage(img, -it.size / 2, -it.size / 2, it.size, it.size);
      }
      ctx.restore();
    });

    // 플레이어 기본 캐릭터 (피격 무적 시간 동안 잃은 목숨 수에 따라 찡그린 표정 1·2 표시)
    const p = gameState.player;
    const lostLives = CFG.lives.max - gameState.lives;
    let charImg = IMAGES.player_basic;
    if (p.invincibleTimer > 0) {
      if (lostLives === 1 && IMAGES.player_hurt1) {
        charImg = IMAGES.player_hurt1;
      } else if (lostLives >= 2 && IMAGES.player_hurt2) {
        charImg = IMAGES.player_hurt2;
      }
    }
    const size = CFG.player.size;

    // 발밑 그림자
    ctx.save();
    ctx.fillStyle = 'rgba(56, 44, 40, 0.16)';
    ctx.beginPath();
    ctx.ellipse(p.x, 725, size * 0.32 * p.scaleX, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (p.invincibleTimer > 0 && Math.floor(p.invincibleTimer * 16) % 2 === 0) {
      ctx.globalAlpha = 0.45;
    }

    const walkBob = Math.abs(Math.sin(p.walkPhase)) * (Math.abs(p.vx) > 20 ? 5 : 1.5);
    const tilt = Math.max(-0.1, Math.min(0.1, p.vx * 0.00022));

    ctx.translate(p.x, CFG.player.y - walkBob);
    ctx.rotate(tilt);
    ctx.scale(p.scaleX, p.scaleY);

    if (charImg) {
      ctx.drawImage(charImg, -size / 2, -size / 2, size, size);
    }
    ctx.restore();

    // 픽셀 사각 파티클
    gameState.particles.forEach((pt) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      const pxSize = Math.max(3, Math.round(pt.size * 1.5));
      const rx = Math.round(pt.x - pxSize / 2);
      const ry = Math.round(pt.y - pxSize / 2);
      ctx.fillStyle = '#261b18';
      ctx.fillRect(rx - 1, ry - 1, pxSize + 2, pxSize + 2);
      ctx.fillStyle = pt.color;
      ctx.fillRect(rx, ry, pxSize, pxSize);
      ctx.restore();
    });

    // 획득 점수 플로팅 (픽셀 폰트, 콤보 시 '1 COMBO' 등 함께 표시)
    gameState.floatingTexts.forEach((ft) => {
      ctx.save();
      const progress = 1 - ft.life / ft.maxLife;
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      const popScale = progress < 0.18 ? 1 + (0.18 - progress) * 0.9 : 1;
      const rx = Math.round(ft.x);
      const ry = Math.round(ft.y);
      ctx.translate(rx, ry);
      ctx.scale(popScale, popScale);
      ctx.textAlign = 'center';

      const darkOutline = ft.color === '#dfbe6f' || gameState.climaxBlend > 0.45;
      const outlineColor = darkOutline ? '#261b18' : '#f5ede1';

      if (ft.comboLabel) {
        ctx.font = '700 10.5px "Galmuri11Bold", "DOSMyungjo", monospace';
        ctx.lineWidth = 3;
        ctx.strokeStyle = outlineColor;
        ctx.strokeText(ft.comboLabel, 0, -14);
        ctx.fillStyle = darkOutline ? '#f7e4a8' : '#6e342b';
        ctx.fillText(ft.comboLabel, 0, -14);
      }

      ctx.font = '700 13.5px "Galmuri11Bold", "DOSMyungjo", monospace';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = outlineColor;
      ctx.strokeText(ft.text, 0, 0);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, 0, 0);
      ctx.restore();
    });

    if (gameState.hurtFlash > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(184, 66, 76, ${gameState.hurtFlash * 0.22})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  function renderFrame(nowMs) {
    const nowSec = nowMs * 0.001;
    ctx.save();
    if (gameState.screenShake > 0.2) {
      const sx = (Math.random() - 0.5) * gameState.screenShake;
      const sy = (Math.random() - 0.5) * gameState.screenShake;
      ctx.translate(sx, sy);
    }

    drawStageBackground(nowSec);
    if (gameState.phase !== 'title') {
      drawItemsAndPlayer();
    }
    drawBottomRoleTally();

    ctx.restore();
  }

  // =========================================================================
  // 9. 입력 및 UI 이벤트 바인딩
  // =========================================================================
  function pointerToStageX(clientX) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return W / 2;
    return ((clientX - rect.left) / rect.width) * W;
  }

  let pointerDown = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (gameState.phase !== 'playing') return;
    pointerDown = true;
    gameState.player.targetX = pointerToStageX(e.clientX);
    canvas.setPointerCapture?.(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (gameState.phase !== 'playing') return;
    if (e.pointerType === 'mouse' || pointerDown) {
      gameState.player.targetX = pointerToStageX(e.clientX);
    }
  });

  window.addEventListener('pointerup', () => {
    pointerDown = false;
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
    if (e.key === 'Escape' && gameState.phase === 'playing') togglePause(true);
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
  });

  function togglePause(forcePause) {
    if (forcePause && gameState.phase === 'playing') {
      gameState.phase = 'paused';
      elScreenPause.hidden = false;
      sound.stopBgm();
    } else if (!forcePause && gameState.phase === 'paused') {
      gameState.phase = 'playing';
      elScreenPause.hidden = true;
      sound.startBgm(gameState.climaxActive);
    }
  }

  function openModal(el) {
    el.hidden = false;
  }
  function closeModal(el) {
    el.hidden = true;
  }

  function bindUIEvents() {
    btnSound.addEventListener('click', () => {
      sound.setEnabled(!sound.enabled);
      syncSoundButtonUI();
    });

    btnPause.addEventListener('click', () => {
      if (gameState.phase === 'playing') togglePause(true);
      else if (gameState.phase === 'paused') togglePause(false);
    });

    document.getElementById('btn-start-game').addEventListener('click', () => startNewGame());
    document.getElementById('btn-retry').addEventListener('click', () => startNewGame());
    document.getElementById('btn-resume').addEventListener('click', () => togglePause(false));
    document.getElementById('btn-restart-pause').addEventListener('click', () => startNewGame());

    const goHome = () => {
      sound.stopBgm();
      gameState.phase = 'title';
      btnPause.hidden = true;
      elScreenPause.hidden = true;
      elScreenResult.hidden = true;
      elScreenStart.hidden = false;
      syncTopHudDOM();
    };
    document.getElementById('btn-quit-home').addEventListener('click', goHome);
    document.getElementById('btn-result-home').addEventListener('click', goHome);

    const openAuthModal = () => {
      document.getElementById('auth-error-msg').hidden = true;
      if (authState.user) {
        document.getElementById('input-nickname').value = authState.user.nickname;
      }
      openModal(modalAuth);
      setTimeout(() => document.getElementById('input-nickname').focus(), 60);
    };

    document.getElementById('btn-open-auth').addEventListener('click', openAuthModal);
    document.getElementById('btn-result-register').addEventListener('click', openAuthModal);
    document.getElementById('btn-rank-login').addEventListener('click', () => {
      closeModal(modalRanking);
      openAuthModal();
    });

    const openRankingModal = () => {
      openModal(modalRanking);
      fetchAndRenderRankingBoard();
    };
    document.getElementById('btn-open-ranking').addEventListener('click', openRankingModal);
    document.getElementById('btn-result-ranking').addEventListener('click', openRankingModal);
    document.getElementById('btn-refresh-ranking').addEventListener('click', fetchAndRenderRankingBoard);

    document.getElementById('btn-open-guide').addEventListener('click', () => {
      ensureGuideRendered();
      openModal(modalGuide);
    });

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.getAttribute('data-close-modal'));
        if (target) closeModal(target);
      });
    });

    [modalAuth, modalRanking, modalGuide].forEach((m) => {
      m.addEventListener('click', (e) => {
        if (e.target === m) closeModal(m);
      });
    });

    document.getElementById('form-auth').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nick = document.getElementById('input-nickname').value.trim();
      const pin = document.getElementById('input-pin').value.trim();
      const errEl = document.getElementById('auth-error-msg');
      const submitBtn = document.getElementById('btn-auth-submit');
      const labelEl = document.getElementById('auth-submit-label');

      errEl.hidden = true;
      submitBtn.disabled = true;
      labelEl.textContent = '확인 중...';

      const res = await handleAuthSubmit(nick, pin);
      submitBtn.disabled = false;
      labelEl.textContent = '확인';

      if (!res.ok) {
        errEl.textContent = res.error;
        errEl.hidden = false;
        return;
      }

      document.getElementById('input-pin').value = '';
      closeModal(modalAuth);
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
      authState.token = '';
      authState.user = null;
      localStorage.removeItem('pkh_auth_token');
      localStorage.removeItem('pkh_local_nick');
      updateAccountUI();
      document.getElementById('input-nickname').value = '';
      document.getElementById('input-pin').value = '';
    });

    window.addEventListener('resize', setupHiDPICanvas);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && gameState.phase === 'playing') {
        togglePause(true);
      }
    });
  }

  let lastFrameMs = performance.now();
  function mainLoop(nowMs) {
    const dt = Math.min(0.05, Math.max(0, (nowMs - lastFrameMs) / 1000));
    lastFrameMs = nowMs;

    updateVisualDecay(dt);
    updateGame(dt);
    if (gameState.phase === 'playing') {
      syncTopHudDOM();
    }
    renderFrame(nowMs);
    requestAnimationFrame(mainLoop);
  }

  function init() {
    setupHiDPICanvas();
    applyBrandConfig();
    bindUIEvents();
    syncTopHudDOM();
    lastFrameMs = performance.now();
    requestAnimationFrame(mainLoop);
    preloadAssetsStaged();
    restoreSession();
  }

  init();
})();
