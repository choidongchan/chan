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
// 회원 몇 명
await api('/api/members', 'POST', { login_id: 'gamer01', name: '김철수', phone: '010-1111-2222' }, token);
await api(`/api/members/1/charge`, 'POST', { minutes: 600 }, token); // test01 시간충전
// 좌석 착석
await api('/api/seats/1/start', 'POST', { rate_plan_id: 1 }, token);           // 게스트
await api('/api/seats/2/start', 'POST', { rate_plan_id: 1, member_login: 'test01' }, token); // 회원
await api('/api/seats/5/start', 'POST', { rate_plan_id: 2 }, token);           // 게스트 프리미엄
await api('/api/seats/9/start', 'POST', { rate_plan_id: 1 }, token);
await api('/api/seats/14/start', 'POST', { rate_plan_id: 1, member_login: 'gamer01' }, token);
// 게임 감지(에이전트 흉내)
await api('/api/agent/game', 'POST', { seat_no: 1, proc_name: 'LeagueClient.exe' });
await api('/api/agent/game', 'POST', { seat_no: 2, proc_name: 'MapleStory.exe' });
await api('/api/agent/game', 'POST', { seat_no: 5, proc_name: 'TslGame.exe' });
await api('/api/agent/game', 'POST', { seat_no: 9, proc_name: 'dnf.exe' });
// 좌석 온라인 표시
for (const n of [1, 2, 5, 9, 14, 3, 4]) await api('/api/seat/status?seat_no=' + n);
// 상품 판매
await api('/api/goods', 'POST', { name: '콜라', amount: 2000 }, token);
await api('/api/goods', 'POST', { name: '컵라면', amount: 1500 }, token);

// --- 스크린샷 ---
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await ctx.newPage();

// 카운터 로그인 → 좌석현황
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.fill('#loginId', 'admin');
await page.fill('#loginPw', 'admin1234');
await page.click('#loginForm button');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'scripts/1-seats.png' });

// 매출 탭
await page.click('.tab[data-tab="sales"]');
await page.waitForTimeout(700);
await page.screenshot({ path: 'scripts/2-sales.png' });

// 유료게임 탭
await page.click('.tab[data-tab="games"]');
await page.waitForTimeout(700);
await page.screenshot({ path: 'scripts/3-games.png' });

// 좌석 PC 키오스크 화면(회원 사용중)
await page.goto(base + '/seat.html?seat=2', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.screenshot({ path: 'scripts/4-seat.png' });

await browser.close();
console.log('스크린샷 완료');
