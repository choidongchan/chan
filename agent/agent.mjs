// 좌석 PC 클라이언트 에이전트 (프로토타입, Node.js)
// - 서버에 heartbeat(온라인 상태) 전송
// - 실행 중인 프로세스에서 게임을 감지해 서버로 보고
// 실제 제품은 자동잠금 등 Windows 기능을 위해 C#/.NET(WPF)로 만드는 것을 권장.
//
// 실행: node agent/agent.mjs --seat 3 --server http://220.72.168.240:8080
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const SEAT_NO = +(args.seat || process.env.WM_SEAT || 1);
const SERVER = (args.server || process.env.WM_SERVER || 'http://localhost:8080').replace(/\/$/, '');
const INTERVAL = +(args.interval || 5) * 1000;

let defs = [];
async function loadDefs() {
  try {
    const res = await fetch(`${SERVER}/api/game-defs`);
    defs = await res.json();
    console.log(`게임 정의 ${defs.length}개 로드`);
  } catch (e) { console.error('게임 정의 로드 실패:', e.message); }
}

// 실행 중인 프로세스 이름 목록
async function runningProcs() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist /fo csv /nh');
      return stdout.split(/\r?\n/).map((l) => (l.split('","')[0] || '').replace(/^"/, '').toLowerCase()).filter(Boolean);
    }
    const { stdout } = await run('ps -eo comm');
    return stdout.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean);
  } catch { return []; }
}

// 실행 중 게임 하나 찾기 (유료 게임 우선)
function detectGame(procs) {
  const set = new Set(procs);
  const matches = defs.filter((d) =>
    (d.proc_names || '').split(',').some((p) => set.has(p.trim().toLowerCase()))
  );
  if (!matches.length) return null;
  matches.sort((a, b) => b.is_premium - a.is_premium);
  return matches[0];
}

async function post(path, body) {
  try {
    await fetch(`${SERVER}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch (e) { /* 서버 일시 단절 무시 */ }
}

let lastGame = null;
async function tick() {
  const hb = await fetch(`${SERVER}/api/agent/heartbeat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seat_no: SEAT_NO }),
  }).then((r) => r.json()).catch(() => null);
  if (hb && hb.in_use && hb.remain_minutes != null && hb.remain_minutes <= 5) {
    console.log(`⚠️ 남은시간 ${hb.remain_minutes}분 — (실제 제품에선 여기서 잠금화면 경고)`);
  }

  const procs = await runningProcs();
  const game = detectGame(procs);
  const code = game?.game_code ?? null;
  if (code !== lastGame) {
    await post('/api/agent/game', { seat_no: SEAT_NO, game_code: code || undefined, proc_name: undefined });
    console.log(game ? `게임 감지: ${game.game_name}${game.is_premium ? ' (유료)' : ''}` : '게임 종료/없음');
    lastGame = code;
  }
}

console.log(`WmCounter 에이전트 시작 — 좌석 ${SEAT_NO}, 서버 ${SERVER}`);
await loadDefs();
setInterval(loadDefs, 5 * 60 * 1000);
tick();
setInterval(tick, INTERVAL);
