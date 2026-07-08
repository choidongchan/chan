// 소개자료(랜딩) 스크린샷 생성 — 데모(70% 좌석) 상태를 캡쳐
// 사용: 서버를 8080에서 띄운 뒤  node scripts/intro-shots.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PORT || 8080;
const base = `http://localhost:${PORT}`;
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'public/intro';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 940 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();

// 데모 자동 로그인 + 70% 좌석 채우기
await page.goto(base + '/?demo=1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  saved', name);
}

// 1) 좌석 배치도 (메인)
await shot('seats');

// 2) 좌석 상세 팝업 (회원석 클릭)
try {
  await page.click('#seatmap .seat.member');
  await page.waitForTimeout(500);
  await shot('seat-detail');
  await page.click('#modal .close');
  await page.waitForTimeout(300);
} catch (e) { console.log('  seat-detail skip', e.message); }

// 팝업 메뉴 순회
async function pop(popName, file) {
  try {
    await page.click(`.m[data-pop="${popName}"]`);
    await page.waitForTimeout(800);
    await shot(file);
    // 팝업 닫기
    const close = await page.$('#wcpop .wc-x');
    if (close) { await close.click(); await page.waitForTimeout(300); }
  } catch (e) { console.log('  pop', popName, 'skip', e.message); }
}

await pop('sales', 'sales');
await pop('members', 'members');
await pop('products', 'products');
await pop('history', 'history');
await pop('orders', 'orders');
await pop('games', 'games');
await pop('logs', 'logs');

await browser.close();
console.log('소개자료 스크린샷 완료 →', OUT);
