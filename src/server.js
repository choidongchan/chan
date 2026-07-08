// PLAYON 서버: REST API + 실시간(SSE) + 정적 파일(카운터 대시보드)
// 의존성 없이 Node 내장 모듈만 사용.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { db, nowISO, seedIfEmpty } from './db.js';
import { elapsedMinutes, calcCharge, chargeFromMemberMinutes } from './billing.js';
import { verifyPassword, hashPassword, createToken, getSession, destroyToken } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
const PORT = process.env.PORT || 8080;

seedIfEmpty();

// ---------- 실시간(SSE) ----------
const clients = new Set();
const online = new Map(); // seat_no -> 마지막 heartbeat(ms). 좌석 PC 접속 상태.
const ONLINE_TTL = 60000;
function isOnline(seatNo) {
  const t = online.get(seatNo);
  return t != null && Date.now() - t < ONLINE_TTL;
}
function broadcast() {
  const payload = `data: ${JSON.stringify(getState())}\n\n`;
  for (const res of clients) res.write(payload);
}

// ---------- 조회 로직 ----------
function getState() {
  const plans = db.prepare('SELECT * FROM rate_plans').all();
  const planById = Object.fromEntries(plans.map((p) => [p.id, p]));
  const seats = db.prepare('SELECT * FROM seats ORDER BY seat_no').all();
  const activeSessions = db
    .prepare("SELECT * FROM sessions WHERE status='active'")
    .all();
  const sessionBySeat = Object.fromEntries(activeSessions.map((s) => [s.seat_id, s]));

  const seatView = seats.map((seat) => {
    const s = sessionBySeat[seat.id];
    if (!s) return { ...seat, online: isOnline(seat.seat_no), status: 'empty' };
    const mins = elapsedMinutes(s.started_at);
    const plan = planById[s.rate_plan_id];
    let remainMinutes = null;
    let runningCharge = null;
    let memberLogin = null, memberName = null;
    if (s.kind === 'member' && s.member_id) {
      const m = db.prepare('SELECT * FROM members WHERE id=?').get(s.member_id);
      remainMinutes = m ? Math.max(0, m.balance_minutes - mins) : null;
      memberLogin = m?.login_id ?? null;
      memberName = m?.name || m?.login_id || null;
    } else {
      runningCharge = calcCharge(plan, mins);
    }
    const game = db
      .prepare("SELECT * FROM game_usage WHERE seat_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1")
      .get(seat.id);
    return {
      ...seat,
      online: isOnline(seat.seat_no),
      status: 'in_use',
      session: {
        id: s.id,
        kind: s.kind,
        member_id: s.member_id,
        member_login: memberLogin,
        member_name: memberName,
        started_at: s.started_at,
        minutes: mins,
        plan_name: plan?.name,
        remain_minutes: remainMinutes,
        running_charge: runningCharge,
      },
      game: game ? { name: game.game_name, provider: game.provider, is_premium: !!game.is_premium } : null,
    };
  });

  const today = nowISO().slice(0, 10);
  const salesToday = db
    .prepare("SELECT COALESCE(SUM(amount),0) t FROM sales WHERE substr(created_at,1,10)=?")
    .get(today).t;
  const inUse = seatView.filter((s) => s.status === 'in_use').length;

  return {
    seats: seatView,
    plans,
    summary: { total: seats.length, in_use: inUse, empty: seats.length - inUse, sales_today: salesToday },
    server_time: nowISO(),
  };
}

// ---------- 동작 ----------
function startSession(seatId, { member_login, rate_plan_id } = {}) {
  const seat = db.prepare('SELECT * FROM seats WHERE id=?').get(seatId);
  if (!seat) throw new Error('좌석 없음');
  const existing = db.prepare("SELECT * FROM sessions WHERE seat_id=? AND status='active'").get(seatId);
  if (existing) throw new Error('이미 사용중인 좌석');

  let member = null;
  if (member_login) {
    member = db.prepare('SELECT * FROM members WHERE login_id=?').get(member_login);
    if (!member) throw new Error('회원을 찾을 수 없음: ' + member_login);
  }
  let planId = rate_plan_id;
  if (!planId) {
    const def = db.prepare('SELECT * FROM rate_plans WHERE is_default=1').get()
      || db.prepare('SELECT * FROM rate_plans LIMIT 1').get();
    planId = def.id;
  }
  const info = db
    .prepare('INSERT INTO sessions (seat_id, member_id, rate_plan_id, kind, started_at, status) VALUES (?,?,?,?,?,?)')
    .run(seatId, member?.id ?? null, planId, member ? 'member' : 'guest', nowISO(), 'active');
  if (member) db.prepare('UPDATE members SET last_visit_at=? WHERE id=?').run(nowISO(), member.id);
  broadcast();
  return { session_id: info.lastInsertRowid };
}

function endSession(seatId) {
  const s = db.prepare("SELECT * FROM sessions WHERE seat_id=? AND status='active'").get(seatId);
  if (!s) throw new Error('사용중인 세션 없음');
  const plan = db.prepare('SELECT * FROM rate_plans WHERE id=?').get(s.rate_plan_id);
  const mins = elapsedMinutes(s.started_at);
  const end = nowISO();

  let amount = 0;
  if (s.kind === 'member' && s.member_id) {
    const m = db.prepare('SELECT * FROM members WHERE id=?').get(s.member_id);
    const { deductMinutes, remainderMinutes } = chargeFromMemberMinutes(m, mins);
    db.prepare('UPDATE members SET balance_minutes = balance_minutes - ? WHERE id=?').run(deductMinutes, m.id);
    // 잔여시간 초과분은 시간요금으로 청구
    amount = calcCharge(plan, remainderMinutes);
  } else {
    amount = calcCharge(plan, mins);
  }

  // 게임 사용 로그 마감
  db.prepare("UPDATE game_usage SET ended_at=?, minutes=? WHERE seat_id=? AND ended_at IS NULL")
    .run(end, mins, seatId);

  db.prepare("UPDATE sessions SET ended_at=?, amount=?, status='closed' WHERE id=?").run(end, amount, s.id);
  if (amount > 0) {
    db.prepare('INSERT INTO sales (session_id, member_id, type, amount, method, created_at) VALUES (?,?,?,?,?,?)')
      .run(s.id, s.member_id ?? null, 'seat', amount, 'cash', end);
  }
  broadcast();
  return { amount, minutes: mins, session_id: s.id };
}

function createMember({ login_id, name, phone, nickname, is_adult }) {
  if (!login_id) throw new Error('아이디 필요');
  db.prepare('INSERT INTO members (login_id, name, phone, nickname, is_adult, created_at) VALUES (?,?,?,?,?,?)')
    .run(login_id, name ?? '', phone ?? '', nickname ?? '', is_adult == null ? 1 : (is_adult ? 1 : 0), nowISO());
  return db.prepare('SELECT * FROM members WHERE login_id=?').get(login_id);
}

// 회원 상태 변경(블랙리스트/로그인금지)
function updateMember(id, patch) {
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(id);
  if (!m) throw new Error('회원 없음');
  const fields = ['name', 'nickname', 'phone', 'is_adult', 'blacklist', 'login_block'];
  for (const f of fields) if (f in patch) db.prepare(`UPDATE members SET ${f}=? WHERE id=?`).run(patch[f], id);
  return db.prepare('SELECT * FROM members WHERE id=?').get(id);
}

function chargeMember(memberId, { minutes = 0, cash = 0, method = 'cash' }) {
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(memberId);
  if (!m) throw new Error('회원 없음');
  db.prepare('UPDATE members SET balance_minutes = balance_minutes + ?, balance_cash = balance_cash + ? WHERE id=?')
    .run(minutes, cash, memberId);
  const amount = cash; // 선불 충전 매출 (시간 충전은 정책에 따라 별도)
  if (amount > 0) {
    db.prepare('INSERT INTO sales (member_id, type, amount, method, created_at) VALUES (?,?,?,?,?)')
      .run(memberId, 'charge', amount, method, nowISO());
  }
  broadcast();
  return db.prepare('SELECT * FROM members WHERE id=?').get(memberId);
}

// 좌석 PC 클라이언트(2단계)가 실행 중인 게임을 보고 → 감지/측정
function reportGame(seatNo, { proc_name, game_code }) {
  const seat = db.prepare('SELECT * FROM seats WHERE seat_no=?').get(seatNo);
  if (!seat) throw new Error('좌석 없음: ' + seatNo);
  let def = null;
  if (game_code) def = db.prepare('SELECT * FROM game_defs WHERE game_code=?').get(game_code);
  if (!def && proc_name) {
    def = db.prepare("SELECT * FROM game_defs WHERE ',' || lower(proc_names) || ',' LIKE '%,' || lower(?) || ',%'").get(proc_name);
  }
  const cur = db.prepare("SELECT * FROM game_usage WHERE seat_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1").get(seat.id);
  const session = db.prepare("SELECT * FROM sessions WHERE seat_id=? AND status='active'").get(seat.id);

  if (!def) {
    // 감지된 게임 없음(게임 종료 등) → 기존 사용 로그 마감
    if (cur) db.prepare('UPDATE game_usage SET ended_at=?, minutes=? WHERE id=?')
      .run(nowISO(), elapsedMinutes(cur.started_at), cur.id);
    broadcast();
    return { detected: null };
  }
  if (cur && cur.game_code === def.game_code) return { detected: def.game_code, unchanged: true };
  if (cur) db.prepare('UPDATE game_usage SET ended_at=?, minutes=? WHERE id=?')
    .run(nowISO(), elapsedMinutes(cur.started_at), cur.id);
  db.prepare('INSERT INTO game_usage (seat_id, session_id, game_code, game_name, provider, is_premium, started_at) VALUES (?,?,?,?,?,?,?)')
    .run(seat.id, session?.id ?? null, def.game_code, def.game_name, def.provider, def.is_premium, nowISO());
  broadcast();
  return { detected: def.game_code };
}

// 상품 판매(음료/과자 등) 매출 기록
function sellGoods({ name, amount, method = 'cash', member_id = null }) {
  const won = +amount;
  if (!won || won <= 0) throw new Error('금액 오류');
  db.prepare('INSERT INTO sales (member_id, type, amount, method, name, created_at) VALUES (?,?,?,?,?,?)')
    .run(member_id, 'goods', won, method, name ?? '상품', nowISO());
  broadcast();
  return { ok: true };
}

// 상품 관리
function createProduct({ category, name, price }) {
  if (!name) throw new Error('상품명 필요');
  const info = db.prepare('INSERT INTO products (category, name, price) VALUES (?,?,?)')
    .run(category || '기타', name, +price || 0);
  return db.prepare('SELECT * FROM products WHERE id=?').get(info.lastInsertRowid);
}
function deleteProduct(id) { db.prepare('DELETE FROM products WHERE id=?').run(id); return { ok: true }; }

// 주문 내역 (상품 판매 내역)
function orderList(limit = 200) {
  return db.prepare(
    `SELECT s.id, s.name, s.amount, s.method, s.created_at, m.nickname, m.name mname, m.login_id
     FROM sales s LEFT JOIN members m ON m.id = s.member_id
     WHERE s.type='goods' ORDER BY s.id DESC LIMIT ?`
  ).all(limit).map((r) => ({
    id: r.id, name: r.name, amount: r.amount, method: r.method, created_at: r.created_at,
    customer: r.nickname || r.mname || r.login_id || null,
  }));
}

// 이용 내역 (최근 세션 목록) — WC "이용내역"
function historyList(limit = 200) {
  const rows = db.prepare(
    `SELECT s.id, s.kind, s.started_at, s.ended_at, s.amount,
            seat.seat_no, m.login_id, m.name, m.nickname, m.is_adult
     FROM sessions s
     JOIN seats seat ON seat.id = s.seat_id
     LEFT JOIN members m ON m.id = s.member_id
     ORDER BY s.id DESC LIMIT ?`
  ).all(limit);
  return rows.map((r) => ({
    seat_no: r.seat_no,
    user: r.kind === 'member' ? (r.nickname || r.name || r.login_id) : null,
    user_no: r.kind === 'member' ? r.login_id : null,
    is_adult: r.is_adult == null ? null : !!r.is_adult,
    amount: r.amount,
    started_at: r.started_at,
    ended_at: r.ended_at,
    minutes: r.ended_at ? elapsedMinutes(r.started_at, r.ended_at) : null,
  }));
}

// 일별 매출 리포트
function dailyReport(date) {
  const d = date || nowISO().slice(0, 10);
  const byType = db.prepare(
    "SELECT type, COALESCE(SUM(amount),0) amount, COUNT(*) cnt FROM sales WHERE substr(created_at,1,10)=? GROUP BY type"
  ).all(d);
  const total = byType.reduce((a, r) => a + r.amount, 0);
  const sessions = db.prepare(
    "SELECT COUNT(*) cnt, COALESCE(SUM(amount),0) amount FROM sessions WHERE status='closed' AND substr(ended_at,1,10)=?"
  ).get(d);
  return { date: d, total, by_type: byType, sessions };
}

// ---- 요금제 관리 ----
function createPlan({ name, kind = 'time', won_per_hour = 1000 }) {
  if (!name) throw new Error('요금제 이름 필요');
  const info = db.prepare('INSERT INTO rate_plans (name, kind, won_per_hour, is_default) VALUES (?,?,?,0)')
    .run(name, kind, +won_per_hour);
  broadcast();
  return db.prepare('SELECT * FROM rate_plans WHERE id=?').get(info.lastInsertRowid);
}
function updatePlan(id, { name, kind, won_per_hour, is_default }) {
  const p = db.prepare('SELECT * FROM rate_plans WHERE id=?').get(id);
  if (!p) throw new Error('요금제 없음');
  db.prepare('UPDATE rate_plans SET name=?, kind=?, won_per_hour=? WHERE id=?')
    .run(name ?? p.name, kind ?? p.kind, won_per_hour ?? p.won_per_hour, id);
  if (is_default) {
    db.prepare('UPDATE rate_plans SET is_default=0').run();
    db.prepare('UPDATE rate_plans SET is_default=1 WHERE id=?').run(id);
  }
  broadcast();
  return db.prepare('SELECT * FROM rate_plans WHERE id=?').get(id);
}
function deletePlan(id) {
  const used = db.prepare('SELECT COUNT(*) c FROM sessions WHERE rate_plan_id=?').get(id).c;
  if (used > 0) throw new Error('이미 사용된 요금제는 삭제할 수 없습니다');
  db.prepare('DELETE FROM rate_plans WHERE id=?').run(id);
  broadcast();
  return { ok: true };
}

// ---- 쿠폰 ----
function createCoupons({ count = 1, kind = 'minutes', value }) {
  if (!value || value <= 0) throw new Error('값 오류');
  const codes = [];
  const ins = db.prepare('INSERT INTO coupons (code, kind, value, created_at) VALUES (?,?,?,?)');
  for (let i = 0; i < Math.min(count, 100); i++) {
    const code = 'C' + Math.floor(Date.now() % 1e6) + '-' + (1000 + i);
    ins.run(code, kind, +value, nowISO());
    codes.push(code);
  }
  return { codes };
}
function redeemCoupon({ code, member_login }) {
  const c = db.prepare('SELECT * FROM coupons WHERE code=?').get(code);
  if (!c) throw new Error('없는 쿠폰');
  if (c.used) throw new Error('이미 사용된 쿠폰');
  const m = db.prepare('SELECT * FROM members WHERE login_id=?').get(member_login);
  if (!m) throw new Error('회원을 찾을 수 없음');
  if (c.kind === 'minutes') db.prepare('UPDATE members SET balance_minutes=balance_minutes+? WHERE id=?').run(c.value, m.id);
  else db.prepare('UPDATE members SET balance_cash=balance_cash+? WHERE id=?').run(c.value, m.id);
  db.prepare('UPDATE coupons SET used=1, member_id=?, used_at=? WHERE id=?').run(m.id, nowISO(), c.id);
  broadcast();
  return { ok: true, kind: c.kind, value: c.value };
}

// ---- 설정 ----
function getSettings() {
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
}
function putSettings(obj) {
  const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const [k, v] of Object.entries(obj)) up.run(k, String(v));
  return getSettings();
}

// ---- 영수증 데이터 ----
function receipt(sessionId) {
  const s = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
  if (!s) throw new Error('세션 없음');
  const seat = db.prepare('SELECT * FROM seats WHERE id=?').get(s.seat_id);
  const plan = db.prepare('SELECT * FROM rate_plans WHERE id=?').get(s.rate_plan_id);
  const member = s.member_id ? db.prepare('SELECT * FROM members WHERE id=?').get(s.member_id) : null;
  return {
    shop: getSettings(),
    seat_no: seat?.seat_no, plan: plan?.name, kind: s.kind,
    member: member?.login_id ?? null,
    started_at: s.started_at, ended_at: s.ended_at,
    minutes: s.ended_at ? elapsedMinutes(s.started_at, s.ended_at) : elapsedMinutes(s.started_at),
    amount: s.amount,
  };
}

// 유료게임 사용 리포트 (게임사 정산의 기초 자료 — 4단계에서 실제 정산에 활용)
function gamesReport(date) {
  const d = date || nowISO().slice(0, 10);
  const rows = db.prepare(
    `SELECT game_name, provider, is_premium,
            COUNT(*) sessions, COALESCE(SUM(minutes),0) minutes
     FROM game_usage
     WHERE substr(started_at,1,10)=?
     GROUP BY game_code ORDER BY minutes DESC`
  ).all(d);
  return { date: d, games: rows };
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type });
  if (Buffer.isBuffer(body)) return res.end(body);          // 정적 파일(HTML/JS/CSS 등)은 그대로 전송
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    // 로그인 / 로그아웃
    if (path === '/api/login' && req.method === 'POST') {
      const b = await readBody(req);
      const staff = db.prepare('SELECT * FROM staff WHERE login=?').get(b.login || '');
      if (!staff || !verifyPassword(b.password || '', staff.password_hash)) {
        return send(res, 401, { error: '아이디 또는 비밀번호가 틀립니다' });
      }
      const token = createToken(staff);
      return send(res, 200, { token, name: staff.name, role: staff.role, login: staff.login });
    }
    if (path === '/api/logout' && req.method === 'POST') {
      destroyToken((req.headers.authorization || '').replace('Bearer ', ''));
      return send(res, 200, { ok: true });
    }

    // 인증 확인: 조회(GET)와 에이전트 엔드포인트를 제외한 변경 작업은 로그인 필요
    const sess = getSession((req.headers.authorization || '').replace('Bearer ', ''));
    const isAgent = path.startsWith('/api/agent/') || path.startsWith('/api/seat/');
    const isMutation = req.method !== 'GET' && path.startsWith('/api/');
    if (isMutation && !isAgent && !sess) {
      return send(res, 401, { error: '로그인이 필요합니다' });
    }

    // ---- 좌석 PC(키오스크)용 엔드포인트 (직원 토큰 불필요) ----
    if (path === '/api/seat/status') {
      const seatNo = +url.searchParams.get('seat_no');
      const seat = db.prepare('SELECT * FROM seats WHERE seat_no=?').get(seatNo);
      if (!seat) return send(res, 404, { error: '좌석 없음' });
      online.set(seatNo, Date.now());
      const s = db.prepare("SELECT * FROM sessions WHERE seat_id=? AND status='active'").get(seat.id);
      if (!s) return send(res, 200, { seat_no: seatNo, in_use: false });
      const plan = db.prepare('SELECT * FROM rate_plans WHERE id=?').get(s.rate_plan_id);
      const mins = elapsedMinutes(s.started_at);
      let remain = null, charge = null, member = null;
      if (s.kind === 'member' && s.member_id) {
        const m = db.prepare('SELECT * FROM members WHERE id=?').get(s.member_id);
        member = m?.login_id ?? null;
        remain = m ? Math.max(0, m.balance_minutes - mins) : null;
      } else charge = calcCharge(plan, mins);
      return send(res, 200, {
        seat_no: seatNo, in_use: true, kind: s.kind, member,
        minutes: mins, remain_minutes: remain, running_charge: charge, plan: plan?.name,
      });
    }
    if (path === '/api/seat/login' && req.method === 'POST') {
      const b = await readBody(req);
      const seat = db.prepare('SELECT * FROM seats WHERE seat_no=?').get(+b.seat_no);
      if (!seat) return send(res, 404, { error: '좌석 없음' });
      return send(res, 200, startSession(seat.id, { member_login: b.member_login }));
    }
    if (path === '/api/seat/logout' && req.method === 'POST') {
      const b = await readBody(req);
      const seat = db.prepare('SELECT * FROM seats WHERE seat_no=?').get(+b.seat_no);
      if (!seat) return send(res, 404, { error: '좌석 없음' });
      return send(res, 200, endSession(seat.id));
    }
    // 실시간 스트림
    if (path === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(getState())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (path === '/api/state') return send(res, 200, getState());
    if (path === '/api/members') {
      if (req.method === 'GET') return send(res, 200, db.prepare('SELECT * FROM members ORDER BY id DESC').all());
      if (req.method === 'POST') return send(res, 200, createMember(await readBody(req)));
    }
    const mMem = path.match(/^\/api\/members\/(\d+)$/);
    if (mMem && req.method === 'PATCH') return send(res, 200, updateMember(+mMem[1], await readBody(req)));
    if (path === '/api/history') return send(res, 200, historyList());

    const mStart = path.match(/^\/api\/seats\/(\d+)\/start$/);
    if (mStart && req.method === 'POST') return send(res, 200, startSession(+mStart[1], await readBody(req)));
    const mEnd = path.match(/^\/api\/seats\/(\d+)\/end$/);
    if (mEnd && req.method === 'POST') return send(res, 200, endSession(+mEnd[1]));
    const mChg = path.match(/^\/api\/members\/(\d+)\/charge$/);
    if (mChg && req.method === 'POST') return send(res, 200, chargeMember(+mChg[1], await readBody(req)));

    if (path === '/api/agent/game' && req.method === 'POST') {
      const b = await readBody(req);
      return send(res, 200, reportGame(+b.seat_no, b));
    }
    if (path === '/api/agent/heartbeat' && req.method === 'POST') {
      const b = await readBody(req);
      online.set(+b.seat_no, Date.now());
      const seat = db.prepare('SELECT * FROM seats WHERE seat_no=?').get(+b.seat_no);
      const sess = seat && db.prepare("SELECT * FROM sessions WHERE seat_id=? AND status='active'").get(seat.id);
      let remain = null;
      if (sess && sess.kind === 'member' && sess.member_id) {
        const m = db.prepare('SELECT * FROM members WHERE id=?').get(sess.member_id);
        remain = m ? Math.max(0, m.balance_minutes - elapsedMinutes(sess.started_at)) : null;
      }
      return send(res, 200, { in_use: !!sess, kind: sess?.kind ?? null, remain_minutes: remain });
    }
    if (path === '/api/game-defs') return send(res, 200, db.prepare('SELECT * FROM game_defs').all());

    const mGoods = path.match(/^\/api\/seats\/(\d+)\/goods$/);
    if (mGoods && req.method === 'POST') return send(res, 200, sellGoods(await readBody(req)));
    if (path === '/api/goods' && req.method === 'POST') return send(res, 200, sellGoods(await readBody(req)));

    if (path === '/api/report/daily') return send(res, 200, dailyReport(url.searchParams.get('date')));
    if (path === '/api/report/games') return send(res, 200, gamesReport(url.searchParams.get('date')));

    // 상품 / 주문
    if (path === '/api/products') {
      if (req.method === 'GET') return send(res, 200, db.prepare('SELECT * FROM products ORDER BY category, id').all());
      if (req.method === 'POST') return send(res, 200, createProduct(await readBody(req)));
    }
    const mProd = path.match(/^\/api\/products\/(\d+)$/);
    if (mProd && req.method === 'DELETE') return send(res, 200, deleteProduct(+mProd[1]));
    if (path === '/api/orders') return send(res, 200, orderList());

    // 요금제
    if (path === '/api/plans') {
      if (req.method === 'GET') return send(res, 200, db.prepare('SELECT * FROM rate_plans').all());
      if (req.method === 'POST') return send(res, 200, createPlan(await readBody(req)));
    }
    const mPlan = path.match(/^\/api\/plans\/(\d+)$/);
    if (mPlan && req.method === 'PUT') return send(res, 200, updatePlan(+mPlan[1], await readBody(req)));
    if (mPlan && req.method === 'DELETE') return send(res, 200, deletePlan(+mPlan[1]));

    // 쿠폰
    if (path === '/api/coupons') {
      if (req.method === 'GET') return send(res, 200, db.prepare('SELECT * FROM coupons ORDER BY id DESC LIMIT 200').all());
      if (req.method === 'POST') return send(res, 200, createCoupons(await readBody(req)));
    }
    if (path === '/api/coupons/redeem' && req.method === 'POST') return send(res, 200, redeemCoupon(await readBody(req)));

    // 설정
    if (path === '/api/settings') {
      if (req.method === 'GET') return send(res, 200, getSettings());
      if (req.method === 'PUT') return send(res, 200, putSettings(await readBody(req)));
    }

    // 영수증
    const mRcp = path.match(/^\/api\/receipt\/(\d+)$/);
    if (mRcp) return send(res, 200, receipt(+mRcp[1]));

    // 정적 파일
    let file = path === '/' ? '/index.html' : path;
    const full = normalize(join(PUBLIC, file));
    if (!full.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
    const data = await readFile(full);
    return send(res, 200, data, MIME[extname(full)] || 'application/octet-stream');
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, { error: 'not found' });
    return send(res, 400, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`PLAYON 서버 실행: http://localhost:${PORT}`);
});
