// 유튜브 자막(.srt) → 읽기 좋은 텍스트(.txt) 변환기
//
// 사용법:
//   node scripts/srt2txt.mjs                 (docs/recipes/자막 폴더 전체 변환)
//   node scripts/srt2txt.mjs 파일.srt        (파일 1개만 변환)
//   node scripts/srt2txt.mjs 폴더경로         (지정한 폴더 변환)
//
// 유튜브 자동자막은 같은 문장이 계속 겹쳐서 나오기 때문에(롤링 자막),
// 그대로 두면 3~4배 길어집니다. 여기서 중복을 걷어내고 한 덩어리 글로 만듭니다.

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DIR = path.join('docs', 'recipes', '자막');

/** .srt 원문 → 자막 대사 줄 배열 */
function parseSrt(raw) {
  const lines = raw.replace(/\r/g, '').split('\n');
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^\d+$/.test(t)) continue;                       // 큐 번호
    if (/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(t)) continue; // 타임코드
    if (/^WEBVTT/i.test(t)) continue;
    const clean = t
      .replace(/<[^>]*>/g, '')        // <c>, <00:00:01.000> 같은 태그
      .replace(/\{[^}]*\}/g, '')      // {\an8} 같은 스타일
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) continue;
    if (/^\[(음악|박수|웃음|Music|Applause|Laughter)\]$/i.test(clean)) continue;
    out.push(clean);
  }
  return out;
}

/** 롤링 자막 중복 제거 */
function dedupe(lines) {
  const kept = [];
  for (const line of lines) {
    const recent = kept.slice(-4);
    if (recent.includes(line)) continue;                 // 그대로 반복된 줄
    const prev = kept[kept.length - 1];
    if (prev) {
      if (prev.endsWith(line)) continue;                 // 앞 줄에 이미 포함
      if (line.startsWith(prev)) { kept.pop(); }         // 앞 줄이 이 줄의 앞부분이면 교체
    }
    kept.push(line);
  }
  return kept;
}

/** 읽기 좋게 100자 단위로 줄바꿈 */
function wrap(text, width = 100) {
  const words = text.split(' ');
  const out = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) { out.push(cur.trim()); cur = w; }
    else { cur = (cur + ' ' + w).trim(); }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.join('\n');
}

/** 파일명에서 언어코드(.ko, .en, .ko-orig 등) 제거 */
function baseName(file) {
  return path.basename(file, '.srt').replace(/\.[a-z]{2}(-[A-Za-z-]+)?$/, '');
}

function convertFile(srtPath, outDir) {
  const raw = fs.readFileSync(srtPath, 'utf8');
  const body = wrap(dedupe(parseSrt(raw)).join(' '));
  if (!body.trim()) return null;

  const name = baseName(srtPath);
  const outPath = path.join(outDir, name + '.txt');
  const header = [
    `# ${name}`,
    `원본 자막 파일: ${path.basename(srtPath)}`,
    `글자 수: ${body.length}`,
    '',
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(outPath, header + body + '\n', 'utf8');
  return outPath;
}

function main() {
  const arg = process.argv[2];
  let targets = [];
  let outDir;

  if (arg && arg.toLowerCase().endsWith('.srt')) {
    targets = [arg];
    outDir = path.dirname(arg);
  } else {
    const dir = arg || DEFAULT_DIR;
    if (!fs.existsSync(dir)) {
      console.log(`폴더가 없습니다: ${dir}`);
      console.log('먼저 recipe.bat 을 실행해서 자막을 받아주세요.');
      process.exit(0);
    }
    outDir = dir;
    targets = fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.srt'))
      .map((f) => path.join(dir, f));
  }

  if (targets.length === 0) {
    console.log('변환할 .srt 자막 파일이 없습니다.');
    return;
  }

  // 같은 영상에 여러 언어 자막이 있으면 한국어를 우선한다
  const byBase = new Map();
  for (const t of targets) {
    const key = baseName(t);
    const isKo = /\.ko(-[A-Za-z-]+)?\.srt$/i.test(t);
    const cur = byBase.get(key);
    if (!cur || (isKo && !/\.ko(-[A-Za-z-]+)?\.srt$/i.test(cur))) byBase.set(key, t);
  }

  let n = 0;
  for (const srt of byBase.values()) {
    const out = convertFile(srt, outDir);
    if (out) { console.log('  변환 완료 →', path.basename(out)); n++; }
    else console.log('  내용 없음(건너뜀) →', path.basename(srt));
  }
  console.log(`\n총 ${n}개 자막을 텍스트로 정리했습니다. 폴더: ${outDir}`);
}

main();
