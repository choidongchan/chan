// PLAYON 자동 배포 감시기
// 파일이 바뀌면 자동으로 git add/commit/push → (Render 연결 시) 자동 배포.
// 실행: node watch.mjs  (또는 dev.bat 더블클릭)
import { watch } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(exec);
const root = dirname(fileURLToPath(import.meta.url));
const IGNORE = /(^|[\\/])(\.git|node_modules)([\\/]|$)|\.db($|-)|\.log$|\.png$|[\\/]scripts[\\/]/;
const DEBOUNCE_MS = 8000; // 저장 후 8초 동안 추가 변경 없으면 올림(연속 저장 묶기)

let timer = null;
let busy = false;

async function deploy() {
  if (busy) { schedule(); return; }
  busy = true;
  try {
    const { stdout: status } = await run('git status --porcelain', { cwd: root });
    if (!status.trim()) { busy = false; return; }
    const stamp = new Date().toLocaleString('ko-KR');
    console.log(`\n📦 변경 감지 → 올리는 중... (${stamp})`);
    await run('git add -A', { cwd: root });
    await run(`git commit -m "auto: ${stamp}"`, { cwd: root });
    try {
      await run('git pull --rebase', { cwd: root });
    } catch (e) {
      console.log('⚠️  pull 중 알림:', (e.stderr || e.message || '').trim());
    }
    await run('git push', { cwd: root });
    console.log('✅ 올리기 완료! Render가 자동으로 홈페이지에 반영합니다.');
  } catch (e) {
    console.error('❌ 오류:', (e.stderr || e.message || '').trim());
  } finally {
    busy = false;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(deploy, DEBOUNCE_MS);
}

console.log('👀 PLAYON 자동 배포 감시 시작.');
console.log('   파일을 수정하고 저장하면 자동으로 올라갑니다. (종료: 이 창 닫기)\n');
watch(root, { recursive: true }, (_evt, file) => {
  if (!file || IGNORE.test(file)) return;
  schedule();
});
