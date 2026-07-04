// DB 초기화 및 접근 계층 (내장 SQLite 사용 — 별도 설치 불필요)
// 추후 MySQL/MariaDB로 이관 시 이 파일만 교체하면 되도록 접근 함수를 모아둡니다.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hashPassword } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.WM_DB || join(__dirname, '..', 'playon.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// 스키마 적용
const schema = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
db.exec(schema);

export function nowISO() {
  // 저장은 UTC ISO, 표시는 클라이언트에서 로컬 변환
  return new Date().toISOString();
}

// ---- 최초 실행 시 예시 데이터 생성 ----
export function seedIfEmpty() {
  const seatCount = db.prepare('SELECT COUNT(*) c FROM seats').get().c;
  if (seatCount === 0) {
    const ins = db.prepare('INSERT INTO seats (seat_no, zone, pos_x, pos_y) VALUES (?,?,?,?)');
    for (let i = 1; i <= 24; i++) {
      const zone = i <= 6 ? '프리미엄' : '일반';
      ins.run(i, zone, (i - 1) % 6, Math.floor((i - 1) / 6));
    }
  }

  const planCount = db.prepare('SELECT COUNT(*) c FROM rate_plans').get().c;
  if (planCount === 0) {
    db.prepare('INSERT INTO rate_plans (name, kind, won_per_hour, is_default) VALUES (?,?,?,?)')
      .run('일반 시간요금', 'time', 1200, 1);
    db.prepare('INSERT INTO rate_plans (name, kind, won_per_hour, is_default) VALUES (?,?,?,?)')
      .run('프리미엄 시간요금', 'time', 1500, 0);
  }

  const gameCount = db.prepare('SELECT COUNT(*) c FROM game_defs').get().c;
  if (gameCount === 0) {
    // 유료(프리미엄) 게임 감지 규칙 예시 — 실제 정산은 게임사 제휴 필요(4단계)
    const g = db.prepare(
      'INSERT INTO game_defs (game_code, game_name, provider, proc_names, is_premium) VALUES (?,?,?,?,?)'
    );
    g.run('lol', '리그 오브 레전드', 'RIOT', 'LeagueClient.exe,LeagueClientUx.exe', 1);
    g.run('maple', '메이플스토리', '넥슨', 'MapleStory.exe', 1);
    g.run('sudden', '서든어택', '넥슨', 'SUDDENATTACK.EXE', 1);
    g.run('dnf', '던전앤파이터', '넥슨', 'dnf.exe', 1);
    g.run('lostark', '로스트아크', '스마일게이트', 'LOSTARK.exe', 1);
    g.run('valorant', '발로란트', 'RIOT', 'VALORANT-Win64-Shipping.exe', 0);
    g.run('pubg', '배틀그라운드', '크래프톤', 'TslGame.exe', 0);
  }

  const staffCount = db.prepare('SELECT COUNT(*) c FROM staff').get().c;
  if (staffCount === 0) {
    // 기본 관리자 계정 — 최초 로그인 후 반드시 비밀번호를 변경하세요.
    db.prepare('INSERT INTO staff (login, name, password_hash, role, created_at) VALUES (?,?,?,?,?)')
      .run('admin', '관리자', hashPassword('admin1234'), 'admin', nowISO());
  }

  const hasShopName = db.prepare("SELECT COUNT(*) c FROM settings WHERE key='shop_name'").get().c;
  if (!hasShopName) {
    const set = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)');
    set.run('shop_name', '우리 PC방');
    set.run('business_no', '');
    set.run('phone', '');
  }

  const memberCount = db.prepare('SELECT COUNT(*) c FROM members').get().c;
  if (memberCount === 0) {
    db.prepare('INSERT INTO members (login_id, name, phone, balance_minutes, balance_cash, created_at) VALUES (?,?,?,?,?,?)')
      .run('test01', '홍길동', '010-0000-0000', 300, 0, nowISO());
  }
}

// CLI: `node --experimental-sqlite src/db.js --seed`
if (process.argv[1] && process.argv[1].endsWith('db.js') && process.argv.includes('--seed')) {
  seedIfEmpty();
  console.log('seed 완료. DB 경로:', DB_PATH);
}
