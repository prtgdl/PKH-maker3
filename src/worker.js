/**
 * PKH-maker3 — Cloudflare Worker API + D1 (SQLite) Backend
 *
 * 엔드포인트:
 *   POST /api/auth      — 닉네임 + PIN 번호 원스텝 신규등록 또는 로그인
 *   GET  /api/me        — 세션 토큰으로 내 프로필 & 현재 등수 조회
 *   POST /api/score     — 게임 종료 후 점수 & 결과 연뮤캐 기록 저장
 *   GET  /api/rankings  — TOP 50 전체 랭킹 + 총 참여자 수 + 내 순위 조회
 */

const VALID_CHARACTERS = new Set(['basic', 'simon', 'goldmund', 'philos', 'remy']);
let schemaInitialized = false;

async function ensureSchema(db) {
  if (schemaInitialized) return;
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pin_salt TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        best_score INTEGER NOT NULL DEFAULT 0,
        best_character TEXT NOT NULL DEFAULT 'basic',
        best_survival_sec INTEGER NOT NULL DEFAULT 0,
        play_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_users_ranking
        ON users (best_score DESC, updated_at ASC)
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS score_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        score INTEGER NOT NULL,
        character_id TEXT NOT NULL,
        survival_sec INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `),
  ]);
  schemaInitialized = true;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteLen = 16) {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

async function hashPin(pin, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(`pkh-maker3:${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function signSessionToken(userId, nickname, pinHashSlice, secretSeed) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30일 유지
  const payloadObj = { uid: userId, nick: nickname, exp };
  const payloadB64 = btoa(encodeURIComponent(JSON.stringify(payloadObj)));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(`${secretSeed}:${pinHashSlice}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  return `${payloadB64}.${bytesToHex(new Uint8Array(sig))}`;
}

async function verifySessionToken(authHeader, db, secretSeed) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;

  const payloadB64 = token.slice(0, dotIdx);
  const sigHex = token.slice(dotIdx + 1);

  let payload;
  try {
    payload = JSON.parse(decodeURIComponent(atob(payloadB64)));
  } catch {
    return null;
  }
  if (!payload || !payload.uid || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  const user = await db
    .prepare(
      `SELECT id, nickname, pin_hash, best_score, best_character, best_survival_sec, play_count, updated_at
       FROM users WHERE id = ?`
    )
    .bind(payload.uid)
    .first();

  if (!user) return null;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(`${secretSeed}:${user.pin_hash.slice(0, 24)}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const expectedSig = bytesToHex(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64)))
  );

  if (!timingSafeEqualStr(sigHex, expectedSig)) return null;
  return user;
}

function validateNickname(raw) {
  if (typeof raw !== 'string') return { ok: false, error: '닉네임을 입력해 주세요.' };
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 2 || trimmed.length > 10) {
    return { ok: false, error: '닉네임은 2~10자 사이로 입력해 주세요.' };
  }
  if (!/^[가-힣a-zA-Z0-9_.\-★☆♡♥ ]+$/.test(trimmed)) {
    return { ok: false, error: '닉네임에 사용할 수 없는 특수문자가 포함되어 있어요.' };
  }
  return { ok: true, value: trimmed };
}

function validatePin(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return { ok: false, error: 'PIN 번호를 입력해 주세요.' };
  }
  const str = String(raw).trim();
  if (!/^\d{4,6}$/.test(str)) {
    return { ok: false, error: 'PIN 번호는 숫자 4~6자리로 입력해 주세요.' };
  }
  return { ok: true, value: str };
}

async function getUserRank(db, user) {
  if (!user || user.best_score <= 0) return null;
  const row = await db
    .prepare(
      `SELECT COUNT(*) + 1 AS rank
       FROM users
       WHERE best_score > ?
          OR (best_score = ? AND updated_at < ?)`
    )
    .bind(user.best_score, user.best_score, user.updated_at)
    .first();
  return row ? Number(row.rank) : null;
}

async function getRankingsPayload(db, currentUser = null, limit = 50) {
  const { results } = await db
    .prepare(
      `SELECT id, nickname, best_score, best_character, best_survival_sec, updated_at
       FROM users
       WHERE best_score > 0
       ORDER BY best_score DESC, updated_at ASC
       LIMIT ?`
    )
    .bind(limit)
    .all();

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM users WHERE best_score > 0`)
    .first();

  const rankings = (results || []).map((r, idx) => ({
    rank: idx + 1,
    nickname: r.nickname,
    bestScore: Number(r.best_score),
    bestCharacter: r.best_character || 'basic',
    bestSurvivalSec: Number(r.best_survival_sec || 0),
    isMe: currentUser ? r.id === currentUser.id : false,
  }));

  let myRank = null;
  if (currentUser && currentUser.best_score > 0) {
    myRank = await getUserRank(db, currentUser);
  }

  return {
    rankings,
    totalPlayers: countRow ? Number(countRow.cnt) : 0,
    myRank,
  };
}

function formatUserProfile(user, myRank = null) {
  return {
    nickname: user.nickname,
    bestScore: Number(user.best_score || 0),
    bestCharacter: user.best_character || 'basic',
    bestSurvivalSec: Number(user.best_survival_sec || 0),
    playCount: Number(user.play_count || 0),
    myRank,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 정적 파일 요청은 ASSETS 바인딩으로 위임
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return new Response('Not Found', { status: 404 });
    }

    if (!env.DB) {
      return jsonResponse(
        { ok: false, error: 'D1 데이터베이스 바인딩(DB)이 설정되지 않았습니다.' },
        503
      );
    }

    try {
      await ensureSchema(env.DB);
      const secretSeed = env.AUTH_SECRET || 'pkh-maker3-stage-archive-v1';

      // 1) POST /api/auth — 닉네임 + PIN 원스텝 등록/로그인
      if (url.pathname === '/api/auth' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const nickCheck = validateNickname(body.nickname);
        if (!nickCheck.ok) return jsonResponse({ ok: false, error: nickCheck.error }, 400);

        const pinCheck = validatePin(body.pin);
        if (!pinCheck.ok) return jsonResponse({ ok: false, error: pinCheck.error }, 400);

        const nickname = nickCheck.value;
        const pin = pinCheck.value;

        const existing = await env.DB.prepare(
          `SELECT id, nickname, pin_salt, pin_hash, best_score, best_character, best_survival_sec, play_count, updated_at
           FROM users WHERE nickname = ? COLLATE NOCASE`
        )
          .bind(nickname)
          .first();

        let user;
        let isNewUser = false;

        if (!existing) {
          const salt = randomHex(16);
          const pinHash = await hashPin(pin, salt);
          const inserted = await env.DB.prepare(
            `INSERT INTO users (nickname, pin_salt, pin_hash)
             VALUES (?, ?, ?)
             RETURNING id, nickname, pin_hash, best_score, best_character, best_survival_sec, play_count, updated_at`
          )
            .bind(nickname, salt, pinHash)
            .first();
          user = inserted;
          isNewUser = true;
        } else {
          const computed = await hashPin(pin, existing.pin_salt);
          if (!timingSafeEqualStr(computed, existing.pin_hash)) {
            return jsonResponse(
              {
                ok: false,
                code: 'PIN_MISMATCH',
                error: '이미 등록된 닉네임입니다. PIN 번호가 일치하지 않아요!',
              },
              401
            );
          }
          user = existing;
        }

        const token = await signSessionToken(
          user.id,
          user.nickname,
          user.pin_hash.slice(0, 24),
          secretSeed
        );
        const myRank = await getUserRank(env.DB, user);

        return jsonResponse({
          ok: true,
          isNewUser,
          token,
          user: formatUserProfile(user, myRank),
        });
      }

      // 2) GET /api/me — 내 세션 확인
      if (url.pathname === '/api/me' && request.method === 'GET') {
        const user = await verifySessionToken(
          request.headers.get('Authorization'),
          env.DB,
          secretSeed
        );
        if (!user) {
          return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401);
        }
        const myRank = await getUserRank(env.DB, user);
        return jsonResponse({ ok: true, user: formatUserProfile(user, myRank) });
      }

      // 3) GET /api/rankings — 랭킹 보드 조회
      if (url.pathname === '/api/rankings' && request.method === 'GET') {
        const user = await verifySessionToken(
          request.headers.get('Authorization'),
          env.DB,
          secretSeed
        );
        const limitParam = Math.min(100, Math.max(5, Number(url.searchParams.get('limit')) || 50));
        const board = await getRankingsPayload(env.DB, user, limitParam);
        return jsonResponse({
          ok: true,
          ...board,
          me: user ? formatUserProfile(user, board.myRank) : null,
        });
      }

      // 4) POST /api/score — 게임 결과 점수 등록
      if (url.pathname === '/api/score' && request.method === 'POST') {
        const user = await verifySessionToken(
          request.headers.get('Authorization'),
          env.DB,
          secretSeed
        );
        if (!user) {
          return jsonResponse({ ok: false, error: '점수를 기록하려면 로그인이 필요합니다.' }, 401);
        }

        const body = await request.json().catch(() => ({}));
        const rawScore = Math.floor(Number(body.score) || 0);
        const survivalSec = Math.max(0, Math.min(7200, Math.floor(Number(body.survivalSec) || 0)));
        const caughtCount = Math.max(0, Math.floor(Number(body.caughtCount) || 0));
        const characterId = VALID_CHARACTERS.has(body.characterId) ? body.characterId : 'basic';

        // 비정상 수치 방지(생존 시간 및 획득 개수 대비 물리적 상한 체크)
        const maxReasonableScore = Math.max(1500, (survivalSec + 10) * 1800, (caughtCount + 5) * 450);
        if (rawScore < 0 || rawScore > maxReasonableScore || rawScore > 9999999) {
          return jsonResponse({ ok: false, error: '유효하지 않은 점수 데이터입니다.' }, 400);
        }

        const isNewRecord = rawScore > Number(user.best_score || 0);

        await env.DB.prepare(
          `INSERT INTO score_logs (user_id, score, character_id, survival_sec)
           VALUES (?, ?, ?, ?)`
        )
          .bind(user.id, rawScore, characterId, survivalSec)
          .run();

        let updatedUser;
        if (isNewRecord) {
          updatedUser = await env.DB.prepare(
            `UPDATE users
             SET best_score = ?,
                 best_character = ?,
                 best_survival_sec = ?,
                 play_count = play_count + 1,
                 updated_at = datetime('now')
             WHERE id = ?
             RETURNING id, nickname, pin_hash, best_score, best_character, best_survival_sec, play_count, updated_at`
          )
            .bind(rawScore, characterId, survivalSec, user.id)
            .first();
        } else {
          updatedUser = await env.DB.prepare(
            `UPDATE users
             SET play_count = play_count + 1
             WHERE id = ?
             RETURNING id, nickname, pin_hash, best_score, best_character, best_survival_sec, play_count, updated_at`
          )
            .bind(user.id)
            .first();
        }

        const board = await getRankingsPayload(env.DB, updatedUser, 50);

        return jsonResponse({
          ok: true,
          isNewRecord,
          submittedScore: rawScore,
          user: formatUserProfile(updatedUser, board.myRank),
          ...board,
        });
      }

      return jsonResponse({ ok: false, error: '알 수 없는 API 경로입니다.' }, 404);
    } catch (err) {
      console.error('Worker API Error:', err);
      return jsonResponse(
        { ok: false, error: '서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
        500
      );
    }
  },
};
