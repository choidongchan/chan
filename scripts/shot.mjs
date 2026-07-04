import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 8095;
const base = `http://localhost:${PORT}`;
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function api(path, method = 'GET', body, token) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

// --- 데모 데이터 만들기 ---
const { token } = await api('/api/login', 'POST', { login: 'admin', password: 'admin1234' });
await api('/api/settings', 'PUT', { shop_name: '체리 PC방 강남점', phone: '02-123-4567' }, token);

const names = ['김철수', '이영희', '박민수', '최지훈', '정하늘', '강도현', '윤서연', '임재원'];
for (let i = 0; i < names.length; i++) {
  await api('/api/members', 'POST', { login_id: 'user' + (i + 1), name: names[i] }, token);
}
// 회원 시간 충전 (member id 2~9)
for (let id = 1; id <= 9; id++) await api(`/api/members/${id}/charge`, 'POST', { minutes: 200 + id * 40 }, token);

const games = ['LeagueClient.exe', 'MapleStory.exe', 'SUDDENATTACK.EXE', 'dnf.exe', 'LOSTARK.exe', 'VALORANT-Win64-Shipping.exe', 'TslGame.exe'];
// 좌석 절반 정도 채우기 (짝수=게스트, 3의배수=회원)
const occupy = [1, 2, 3, 5, 6, 8, 9, 11, 13, 14, 15, 17, 20, 22, 24, 25, 33, 34, 35, 41, 43, 45, 48, 52, 57];
for (let i = 0; i < occupy.length; i++) {
  const n = occupy[i];
  const asMember = i % 3 === 0;
  const body = asMember ? { rate_plan_id: 1, member_login: 'user' + ((i % 8) + 1) } : { rate_plan_id: 1 };
  await api(`/api/seats/${n}/start`, 'POST', body, token);
  await api('/api/agent/game', 'POST', { seat_no: n, proc_name: games[i % games.length] });
  await api('/api/seat/status?seat_no=' + n); // 온라인
}
await api('/api/goods', 'POST', { name: '콜라', amount: 2000 }, token);
await api('/api/goods', 'POST', { name: '컵라면', amount: 1500 }, token);

// --- 스크린샷 ---
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 900 } });
const page = await ctx.newPage();

// 카운터 로그인 → 좌석현황
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.fill('#loginId', 'admin');
await page.fill('#loginPw', 'admin1234');
await page.click('#loginForm button');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'scripts/1-seats.png' });

// 매출 탭
await page.click('.m[data-tab="sales"]');
await page.waitForTimeout(700);
await page.screenshot({ path: 'scripts/2-sales.png' });

// 유료게임 탭
await page.click('.m[data-tab="games"]');
await page.waitForTimeout(700);
await page.screenshot({ path: 'scripts/3-games.png' });

// 좌석 PC 키오스크 화면(회원 사용중)
await page.goto(base + '/seat.html?seat=2', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.screenshot({ path: 'scripts/4-seat.png' });

await browser.close();
console.log('스크린샷 완료');
