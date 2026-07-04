// 버전 무관 실행 런처
// node:sqlite가 플래그 없이 동작하면 그대로 실행하고(신형 Node),
// 플래그가 필요하면 --experimental-sqlite 를 붙여 재실행합니다(구형 Node 20~23).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('./src/server.js', import.meta.url));

let needsFlag = false;
try {
  await import('node:sqlite');
} catch {
  needsFlag = true;
}

if (!needsFlag) {
  await import('./src/server.js');
} else {
  const child = spawn(process.execPath, ['--experimental-sqlite', server, ...process.argv.slice(2)], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}
