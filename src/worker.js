/**
 * PKH-maker3 — Cloudflare Worker API + D1 (SQLite) Backend
 *
 * 공개 엔드포인트:
 *   POST /api/auth             — 닉네임 + PIN 번호 원스텝 신규등록 또는 로그인
 *   GET  /api/me               — 세션 토큰으로 내 프로필 & 현재 등수 조회
 *   POST /api/score            — 게임 종료 후 점수 & 결과 배역 & 세부 수집 개수 저장
 *   GET  /api/rankings         — 전체 랭킹 + 총 참여자 수 + 내 순위 조회
 *
 * 관리자 엔드포인트 (/admin 비밀번호 인증 전용):
 *   POST   /api/admin/login        — 관리자 비밀번호 인증 후 세션 토큰 발급
 *   GET    /api/admin/overview     — 현황 요약 + 전체 유저/랭킹 + 매 판 플레이 로그 조회
 *   DELETE /api/admin/users/:id    — 특정 유저 및 플레이 기록 개별 삭제
 *   POST   /api/admin/reset-scores — 유저 계정은 유지하고 점수·랭킹·로그만 전체 초기화
 *   POST   /api/admin/reset-all    — 유저 계정 포함 DB 전체 완전 초기화
 */

const VALID_CHARACTERS = new Set(['guinea', 'basic', 'simon', 'goldmund', 'philos', 'remy']);
const ROLE_KEYS = ['simon', 'goldmund', 'philos', 'remy'];
const LEGACY_SECRET_SEED = 'pkh-maker3-stage-archive-v1';
const ADMIN_DEFAULT_SALT = 'pkh-admin-v1-9f3a7c2e';
const ADMIN_DEFAULT_HASH = 'a9048b73687d8df519e16edf4f59e95e6304532b7dbff2e730de0c043f362040';

let schemaInitialized = false;
let cachedDbSecret = '';

async function ensureSchema(db) {
  if (schemaInitialized && cachedDbSecret) return;
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pin_salt TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        best_score INTEGER NOT NULL DEFAULT 0,
        best_character TEXT NOT NULL DEFAULT 'guinea',
        best_survival_sec INTEGER NOT NULL DEFAULT 0,
        best_role_counts TEXT NOT NULL DEFAULT '{}',
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
        role_counts TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_score_logs_user
        ON score_logs (user_id, created_at DESC)
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS auth_rate_limits (
        rl_key TEXT PRIMARY KEY,
        fail_count INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      )
    `),
  ]);

  // 기존 운영 DB 무중단 컬럼 마이그레이션 (이미 존재하면 무시)
  try {
    await db
      .prepare(`ALTER TABLE users ADD COLUMN best_role_counts TEXT NOT NULL DEFAULT '{}'`)
      .run();
  } catch {}
  try {
    await db
      .prepare(`ALTER TABLE score_logs ADD COLUMN role_counts TEXT NOT NULL DEFAULT '{}'`)
      .run();
  } catch {}

  // D1 내부 전용 서명 시크릿 자동 생성·조회 (소스코드/Git에 노출되지 않음)
  const generatedSecret = randomHex(32);
  await db
    .prepare(`INSERT OR IGNORE INTO app_meta (key, value) VALUES ('jwt_secret', ?)`)
    .bind(generatedSecret)
    .run();
  const secretRow = await db
    .prepare(`SELECT value FROM app_meta WHERE key = 'jwt_secret'`)
    .first();
  cachedDbSecret = secretRow && secretRow.value ? String(secretRow.value) : generatedSecret;

  schemaInitialized = true;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
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

async function hmacSignHex(secretKeyStr, messageStr) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretKeyStr),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(messageStr));
  return bytesToHex(new Uint8Array(sig));
}

async function signSessionToken(userId, nickname, pinHashSlice, secretSeed) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30일 유지
  const payloadObj = { uid: userId, nick: nickname, exp };
  const payloadB64 = btoa(encodeURIComponent(JSON.stringify(payloadObj)));
  const sigHex = await hmacSignHex(`${secretSeed}:${pinHashSlice}`, payloadB64);
  return `${payloadB64}.${sigHex}`;
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

  const pinSlice = user.pin_hash.slice(0, 24);
  const expectedSig = await hmacSignHex(`${secretSeed}:${pinSlice}`, payloadB64);
  if (timingSafeEqualStr(sigHex, expectedSig)) return user;

  // 기존 발급 세션 토큰 하위 호환 검증
  const legacySig = await hmacSignHex(`${LEGACY_SECRET_SEED}:${pinSlice}`, payloadB64);
  if (timingSafeEqualStr(sigHex, legacySig)) return user;

  return null;
}

async function verifyAdminPassword(inputPw, env) {
  if (env.ADMIN_PASSWORD) {
    return timingSafeEqualStr(inputPw, String(env.ADMIN_PASSWORD));
  }
  const computed = await hashPin(inputPw, ADMIN_DEFAULT_SALT);
  return timingSafeEqualStr(computed, ADMIN_DEFAULT_HASH);
}

async function signAdminToken(secretSeed) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12; // 12시간 유지
  const payloadObj = { role: 'admin', exp };
  const payloadB64 = btoa(encodeURIComponent(JSON.stringify(payloadObj)));
  const sigHex = await hmacSignHex(`${secretSeed}:admin:${ADMIN_DEFAULT_HASH}`, payloadB64);
  return `${payloadB64}.${sigHex}`;
}

async function verifyAdminToken(authHeader, secretSeed) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return false;

  const payloadB64 = token.slice(0, dotIdx);
  const sigHex = token.slice(dotIdx + 1);

  let payload;
  try {
    payload = JSON.parse(decodeURIComponent(atob(payloadB64)));
  } catch {
    return false;
  }
  if (!payload || payload.role !== 'admin' || !payload.exp) return false;
  if (payload.exp < Math.floor(Date.now() / 1000)) return false;

  const expectedSig = await hmacSignHex(`${secretSeed}:admin:${ADMIN_DEFAULT_HASH}`, payloadB64);
  return timingSafeEqualStr(sigHex, expectedSig);
}

function getClientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'local'
  );
}

async function checkRateLimit(db, rlKey) {
  const nowSec = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(`SELECT fail_count, locked_until FROM auth_rate_limits WHERE rl_key = ?`)
    .bind(rlKey)
    .first();
  if (row && Number(row.locked_until) > nowSec) {
    return { allowed: false, retrySec: Number(row.locked_until) - nowSec };
  }
  return { allowed: true };
}

async function recordAuthFailure(db, rlKey, maxFails = 5, lockDurationSec = 180, windowSec = 600) {
  const nowSec = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(`SELECT fail_count, updated_at FROM auth_rate_limits WHERE rl_key = ?`)
    .bind(rlKey)
    .first();
  const prevFails =
    row && nowSec - Number(row.updated_at) < windowSec ? Number(row.fail_count) : 0;
  const nextFails = prevFails + 1;
  const lockedUntil = nextFails >= maxFails ? nowSec + lockDurationSec : 0;

  await db
    .prepare(
      `INSERT INTO auth_rate_limits (rl_key, fail_count, locked_until, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(rl_key) DO UPDATE SET
         fail_count = excluded.fail_count,
         locked_until = excluded.locked_until,
         updated_at = excluded.updated_at`
    )
    .bind(rlKey, nextFails, lockedUntil, nowSec)
    .run();
}

async function clearAuthFailures(db, rlKey) {
  await db.prepare(`DELETE FROM auth_rate_limits WHERE rl_key = ?`).bind(rlKey).run();
}

function validateNickname(raw) {
  if (typeof raw !== 'string') return { ok: false, error: '닉네임을 입력해 주세요.' };
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 1) {
    return { ok: false, error: '닉네임을 입력해 주세요.' };
  }
  if (trimmed.length > 10) {
    return { ok: false, error: '닉네임은 최대 10자까지 입력해 주세요.' };
  }
  if (!/^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9_.\-★☆♡♥ ]+$/.test(trimmed)) {
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

function sanitizeRoleCounts(raw) {
  const out = { simon: 0, goldmund: 0, philos: 0, remy: 0 };
  if (raw && typeof raw === 'object') {
    for (const k of ROLE_KEYS) {
      out[k] = Math.max(0, Math.min(9999, Math.floor(Number(raw[k]) || 0)));
    }
  }
  return out;
}

function parseRoleCounts(jsonStr) {
  if (!jsonStr || typeof jsonStr !== 'string') {
    return { simon: 0, goldmund: 0, philos: 0, remy: 0 };
  }
  try {
    return sanitizeRoleCounts(JSON.parse(jsonStr));
  } catch {
    return { simon: 0, goldmund: 0, philos: 0, remy: 0 };
  }
}

async function getUserRank(db, user) {
  if (!user || user.best_score <= 0) return null;
  const row = await db
    .prepare(
      `SELECT COUNT(*) + 1 AS rank
       FROM users
       WHERE best_score > ?`
    )
    .bind(user.best_score)
    .first();
  return row ? Number(row.rank) : null;
}

async function getRankingsPayload(db, currentUser = null) {
  const { results } = await db
    .prepare(
      `SELECT id, nickname, best_score, best_character, best_survival_sec, updated_at
       FROM users
       WHERE best_score > 0
       ORDER BY best_score DESC, updated_at ASC, id ASC`
    )
    .all();

  let prevScore = null;
  let currentRank = 0;
  const rankings = (results || []).map((r, idx) => {
    const score = Number(r.best_score);
    if (score !== prevScore) {
      currentRank = idx + 1;
      prevScore = score;
    }
    return {
      rank: currentRank,
      nickname: r.nickname,
      bestScore: score,
      bestCharacter: r.best_character || 'basic',
      bestSurvivalSec: Number(r.best_survival_sec || 0),
      isMe: currentUser ? r.id === currentUser.id : false,
    };
  });

  let myRank = null;
  if (currentUser && currentUser.best_score > 0) {
    const meRow = rankings.find((r) => r.isMe);
    myRank = meRow ? meRow.rank : await getUserRank(db, currentUser);
  }

  return {
    rankings,
    totalPlayers: rankings.length,
    myRank,
  };
}

function formatUserProfile(user, myRank = null) {
  return {
    nickname: user.nickname,
    bestScore: Number(user.best_score || 0),
    bestCharacter: user.best_character || 'guinea',
    bestSurvivalSec: Number(user.best_survival_sec || 0),
    playCount: Number(user.play_count || 0),
    myRank,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 정적 파일 및 /admin 경로 처리
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS) {
        if (url.pathname === '/admin' || url.pathname === '/admin/') {
          const adminUrl = new URL(request.url);
          adminUrl.pathname = '/admin.html';
          return env.ASSETS.fetch(new Request(adminUrl.toString(), request));
        }
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
      const secretSeed = env.AUTH_SECRET || cachedDbSecret;
      const clientIp = getClientIp(request);

      // =======================================================================
      // 관리자 전용 API (/api/admin/*)
      // =======================================================================
      if (url.pathname === '/api/admin/login' && request.method === 'POST') {
        const adminRlKey = `admin:${clientIp}`;
        const rl = await checkRateLimit(env.DB, adminRlKey);
        if (!rl.allowed) {
          return jsonResponse(
            {
              ok: false,
              error: `비밀번호 입력 실패 횟수가 초과되었습니다. ${rl.retrySec}초 후 다시 시도해 주세요.`,
            },
            429
          );
        }

        const body = await request.json().catch(() => ({}));
        const inputPw = String(body.password || '').trim();
        const isPwValid = await verifyAdminPassword(inputPw, env);
        if (!isPwValid) {
          await recordAuthFailure(env.DB, adminRlKey, 5, 180, 600);
          return jsonResponse({ ok: false, error: '관리자 비밀번호가 일치하지 않습니다.' }, 401);
        }
        await clearAuthFailures(env.DB, adminRlKey);
        const token = await signAdminToken(secretSeed);
        return jsonResponse({ ok: true, token });
      }

      if (url.pathname.startsWith('/api/admin/')) {
        const isAdmin = await verifyAdminToken(request.headers.get('Authorization'), secretSeed);
        if (!isAdmin) {
          return jsonResponse({ ok: false, error: '관리자 인증이 필요합니다.' }, 401);
        }

        // 1) GET /api/admin/overview — 요약 카드 + 전체 유저/랭킹 + 최근 플레이 로그
        if (url.pathname === '/api/admin/overview' && request.method === 'GET') {
          const { results: userRows } = await env.DB.prepare(
            `SELECT id, nickname, best_score, best_character, best_survival_sec, best_role_counts,
                    play_count, created_at, updated_at
             FROM users
             ORDER BY best_score DESC, updated_at ASC, id ASC`
          ).all();

          const { results: logRows } = await env.DB.prepare(
            `SELECT l.id, l.user_id, u.nickname, l.score, l.character_id, l.survival_sec,
                    l.role_counts, l.created_at
             FROM score_logs l
             LEFT JOIN users u ON u.id = l.user_id
             ORDER BY l.id DESC
             LIMIT 300`
          ).all();

          const playCountRow = await env.DB.prepare(
            `SELECT COUNT(*) AS cnt FROM score_logs`
          ).first();

          const { results: endingGroupRows } = await env.DB.prepare(
            `SELECT character_id, COUNT(*) AS cnt
             FROM score_logs
             GROUP BY character_id`
          ).all();

          let currentRank = 0;
          let prevScore = null;
          let scoredUsers = 0;
          const bestEndingCounts = {
            simon: 0,
            goldmund: 0,
            philos: 0,
            remy: 0,
            basic: 0,
            guinea: 0,
          };

          const users = (userRows || []).map((u) => {
            const bestScore = Number(u.best_score || 0);
            const hasScore = bestScore > 0;
            if (hasScore) {
              scoredUsers += 1;
              if (bestScore !== prevScore) {
                currentRank = scoredUsers;
                prevScore = bestScore;
              }
              const cid = VALID_CHARACTERS.has(u.best_character) ? u.best_character : 'basic';
              bestEndingCounts[cid] = (bestEndingCounts[cid] || 0) + 1;
            }
            return {
              id: Number(u.id),
              rank: hasScore ? currentRank : null,
              nickname: u.nickname,
              bestScore,
              bestCharacter: u.best_character || 'guinea',
              bestSurvivalSec: Number(u.best_survival_sec || 0),
              bestRoleCounts: parseRoleCounts(u.best_role_counts),
              playCount: Number(u.play_count || 0),
              createdAt: u.created_at,
              updatedAt: u.updated_at,
            };
          });

          const playEndingCounts = {
            simon: 0,
            goldmund: 0,
            philos: 0,
            remy: 0,
            basic: 0,
            guinea: 0,
          };
          for (const g of endingGroupRows || []) {
            const cid = VALID_CHARACTERS.has(g.character_id) ? g.character_id : 'basic';
            playEndingCounts[cid] = (playEndingCounts[cid] || 0) + Number(g.cnt || 0);
          }

          const logs = (logRows || []).map((l) => ({
            id: Number(l.id),
            userId: Number(l.user_id),
            nickname: l.nickname || '(삭제된 유저)',
            score: Number(l.score || 0),
            characterId: l.character_id || 'guinea',
            survivalSec: Number(l.survival_sec || 0),
            roleCounts: parseRoleCounts(l.role_counts),
            createdAt: l.created_at,
          }));

          return jsonResponse({
            ok: true,
            summary: {
              totalUsers: users.length,
              scoredUsers,
              totalPlays: playCountRow ? Number(playCountRow.cnt || 0) : 0,
              playEndingCounts,
              bestEndingCounts,
            },
            users,
            logs,
          });
        }

        // 2) DELETE /api/admin/users/:id — 특정 유저 개별 삭제
        const userDelMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
        if (userDelMatch && request.method === 'DELETE') {
          const targetId = Number(userDelMatch[1]);
          await env.DB.batch([
            env.DB.prepare(`DELETE FROM score_logs WHERE user_id = ?`).bind(targetId),
            env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(targetId),
          ]);
          return jsonResponse({ ok: true, deletedId: targetId });
        }

        // 3) POST /api/admin/reset-scores — 점수·랭킹·로그만 전체 초기화 (유저 계정 유지)
        if (url.pathname === '/api/admin/reset-scores' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          if (body.confirmText !== '초기화') {
            return jsonResponse({ ok: false, error: '확인 문구(초기화)를 정확히 입력해 주세요.' }, 400);
          }
          await env.DB.batch([
            env.DB.prepare(`DELETE FROM score_logs`),
            env.DB.prepare(
              `UPDATE users
               SET best_score = 0,
                   best_character = 'guinea',
                   best_survival_sec = 0,
                   best_role_counts = '{}',
                   play_count = 0,
                   updated_at = datetime('now')`
            ),
          ]);
          return jsonResponse({ ok: true });
        }

        // 4) POST /api/admin/reset-all — 유저 계정 포함 전체 완전 초기화
        if (url.pathname === '/api/admin/reset-all' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          if (body.confirmText !== '초기화') {
            return jsonResponse({ ok: false, error: '확인 문구(초기화)를 정확히 입력해 주세요.' }, 400);
          }
          await env.DB.batch([
            env.DB.prepare(`DELETE FROM score_logs`),
            env.DB.prepare(`DELETE FROM users`),
          ]);
          try {
            await env.DB.prepare(
              `DELETE FROM sqlite_sequence WHERE name IN ('users', 'score_logs')`
            ).run();
          } catch {}
          return jsonResponse({ ok: true });
        }

        return jsonResponse({ ok: false, error: '알 수 없는 관리자 API 경로입니다.' }, 404);
      }

      // =======================================================================
      // 일반 게임 API (/api/*)
      // =======================================================================

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
          const pinRlKey = `pin:${clientIp}:${nickname.toLowerCase()}`;
          const rl = await checkRateLimit(env.DB, pinRlKey);
          if (!rl.allowed) {
            return jsonResponse(
              {
                ok: false,
                error: `PIN 입력 실패 횟수가 초과되었습니다. ${rl.retrySec}초 후 다시 시도해 주세요.`,
              },
              429
            );
          }

          const computed = await hashPin(pin, existing.pin_salt);
          if (!timingSafeEqualStr(computed, existing.pin_hash)) {
            await recordAuthFailure(env.DB, pinRlKey, 5, 180, 600);
            return jsonResponse(
              {
                ok: false,
                code: 'PIN_MISMATCH',
                error: '이미 등록된 닉네임입니다. PIN 번호가 일치하지 않아요!',
              },
              401
            );
          }
          await clearAuthFailures(env.DB, pinRlKey);
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

      // 3) GET /api/rankings — 전체 랭킹 보드 조회
      if (url.pathname === '/api/rankings' && request.method === 'GET') {
        const user = await verifySessionToken(
          request.headers.get('Authorization'),
          env.DB,
          secretSeed
        );
        const board = await getRankingsPayload(env.DB, user);
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
        const roleCountsObj = sanitizeRoleCounts(body.roleCounts);
        const roleCountsJson = JSON.stringify(roleCountsObj);
        const roleSum =
          roleCountsObj.simon +
          roleCountsObj.goldmund +
          roleCountsObj.philos +
          roleCountsObj.remy;

        // 점수·획득 수·생존 시간 정합성 검증 (10점 단위, 배역별 합계 일치, 개당 100~400점 범위, 시간당 최대 스폰 상한)
        const maxPossibleCaught = Math.ceil((survivalSec + 8) * 5);
        const isZeroScoreValid = caughtCount === 0 && roleSum === 0 && rawScore === 0;
        const isPositiveScoreValid =
          caughtCount > 0 &&
          caughtCount === roleSum &&
          caughtCount <= maxPossibleCaught &&
          rawScore % 10 === 0 &&
          rawScore >= caughtCount * 100 &&
          rawScore <= caughtCount * 400 &&
          rawScore <= 9999999;

        if (!isZeroScoreValid && !isPositiveScoreValid) {
          return jsonResponse({ ok: false, error: '유효하지 않은 점수 데이터입니다.' }, 400);
        }

        // 서버 기준 엔딩 배역 판정 (클라이언트 변조 방지)
        let maxRoleCnt = 0;
        for (const k of ROLE_KEYS) {
          if (roleCountsObj[k] > maxRoleCnt) maxRoleCnt = roleCountsObj[k];
        }
        let characterId = 'guinea';
        if (maxRoleCnt > 0 && rawScore > 0) {
          const tiedRoles = ROLE_KEYS.filter((k) => roleCountsObj[k] === maxRoleCnt);
          characterId = tiedRoles.length === 1 ? tiedRoles[0] : 'basic';
        }

        const isNewRecord = rawScore > Number(user.best_score || 0);

        await env.DB.prepare(
          `INSERT INTO score_logs (user_id, score, character_id, survival_sec, role_counts)
           VALUES (?, ?, ?, ?, ?)`
        )
          .bind(user.id, rawScore, characterId, survivalSec, roleCountsJson)
          .run();

        let updatedUser;
        if (isNewRecord) {
          updatedUser = await env.DB.prepare(
            `UPDATE users
             SET best_score = ?,
                 best_character = ?,
                 best_survival_sec = ?,
                 best_role_counts = ?,
                 play_count = play_count + 1,
                 updated_at = datetime('now')
             WHERE id = ?
             RETURNING id, nickname, pin_hash, best_score, best_character, best_survival_sec, play_count, updated_at`
          )
            .bind(rawScore, characterId, survivalSec, roleCountsJson, user.id)
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

        const board = await getRankingsPayload(env.DB, updatedUser);

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
