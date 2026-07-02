// WmCounter 서버: REST API + 실시간(SSE) + 정적 파일(카운터 대시보드)
// 의존성 없이 Node 내장 모듈만 사용.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { db, nowISO, seedIfEmpty } from './db.js';
import { elapsedMinutes, calcCharge, chargeFromMemberMinutes } from './billing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
const PORT = process.env.PORT || 8080;

seedIfEmpty();

// ---------- 실시간(SSE) ----------
const clients = new Set();
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
    if (!s) return { ...seat, status: 'empty' };
    const mins = elapsedMinutes(s.started_at);
    const plan = planById[s.rate_plan_id];
    let remainMinutes = null;
    let runningCharge = null;
    if (s.kind === 'member' && s.member_id) {
      const m = db.prepare('SELECT * FROM members WHERE id=?').get(s.member_id);
      remainMinutes = m ? Math.max(0, m.balance_minutes - mins) : null;
    } else {
      runningCharge = calcCharge(plan, mins);
    }
    const game = db
      .prepare("SELECT * FROM game_usage WHERE seat_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1")
      .get(seat.id);
    return {
      ...seat,
      status: 'in_use',
      session: {
        id: s.id,
        kind: s.kind,
        member_id: s.member_id,
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
  return { amount, minutes: mins };
}

function createMember({ login_id, name, phone }) {
  if (!login_id) throw new Error('아이디 필요');
  db.prepare('INSERT INTO members (login_id, name, phone, created_at) VALUES (?,?,?,?)')
    .run(login_id, name ?? '', phone ?? '', nowISO());
  return db.prepare('SELECT * FROM members WHERE login_id=?').get(login_id);
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

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type });
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
  console.log(`WmCounter 서버 실행: http://localhost:${PORT}`);
});
