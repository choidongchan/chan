-- PLAYON DB 스키마 (1단계)
-- SQLite 기준. 추후 MySQL/MariaDB로 이관 가능하도록 표준 SQL 위주로 작성.

-- 좌석
CREATE TABLE IF NOT EXISTS seats (
  id         INTEGER PRIMARY KEY,
  seat_no    INTEGER NOT NULL UNIQUE,   -- 좌석 번호
  zone       TEXT    DEFAULT '일반',      -- 구역(일반/프리미엄 등)
  pc_ip      TEXT,                        -- 좌석 PC IP
  pos_x      INTEGER DEFAULT 0,           -- 배치도 좌표
  pos_y      INTEGER DEFAULT 0
);

-- 회원
CREATE TABLE IF NOT EXISTS members (
  id             INTEGER PRIMARY KEY,
  login_id       TEXT    NOT NULL UNIQUE, -- 회원 아이디
  name           TEXT,
  phone          TEXT,
  balance_minutes INTEGER NOT NULL DEFAULT 0, -- 잔여 시간(분)
  balance_cash    INTEGER NOT NULL DEFAULT 0, -- 잔여 선불금(원)
  created_at     TEXT    NOT NULL
);

-- 요금제
CREATE TABLE IF NOT EXISTS rate_plans (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'time', -- time(시간당) / fixed(정액) / prepaid(선불차감)
  won_per_hour INTEGER NOT NULL DEFAULT 1000,  -- 시간당 요금(원)
  is_default  INTEGER NOT NULL DEFAULT 0
);

-- 이용 세션(착석~종료)
CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY,
  seat_id      INTEGER NOT NULL,
  member_id    INTEGER,                    -- NULL이면 게스트(비회원)
  rate_plan_id INTEGER NOT NULL,
  kind         TEXT    NOT NULL,           -- guest / member
  started_at   TEXT    NOT NULL,
  ended_at     TEXT,                        -- NULL이면 사용중
  amount       INTEGER NOT NULL DEFAULT 0, -- 종료 시 확정 요금(원)
  status       TEXT    NOT NULL DEFAULT 'active', -- active / closed
  FOREIGN KEY (seat_id)      REFERENCES seats(id),
  FOREIGN KEY (member_id)    REFERENCES members(id),
  FOREIGN KEY (rate_plan_id) REFERENCES rate_plans(id)
);

-- 매출 내역
CREATE TABLE IF NOT EXISTS sales (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER,
  member_id  INTEGER,
  type       TEXT    NOT NULL,             -- seat(좌석요금) / charge(선불충전) / goods(상품) 등
  amount     INTEGER NOT NULL,
  method     TEXT    NOT NULL DEFAULT 'cash', -- cash / card / prepaid
  created_at TEXT    NOT NULL
);

-- 게임 사용 로그 (유료게임 연동 1단계: "감지/측정"용)
-- 실제 게임사 정산(4단계)은 별도 제휴/인증이 필요.
CREATE TABLE IF NOT EXISTS game_usage (
  id          INTEGER PRIMARY KEY,
  seat_id     INTEGER NOT NULL,
  session_id  INTEGER,
  game_code   TEXT    NOT NULL,            -- 게임 식별 코드
  game_name   TEXT,
  provider    TEXT,                         -- 게임사(넥슨/블리자드/RIOT 등)
  is_premium  INTEGER NOT NULL DEFAULT 0,   -- 유료(프리미엄) 여부
  started_at  TEXT    NOT NULL,
  ended_at    TEXT,
  minutes     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (seat_id)    REFERENCES seats(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- 유료게임 정의 (감지 규칙). wmtgn.ini 개념의 오픈 버전.
CREATE TABLE IF NOT EXISTS game_defs (
  id         INTEGER PRIMARY KEY,
  game_code  TEXT    NOT NULL UNIQUE,
  game_name  TEXT    NOT NULL,
  provider   TEXT,
  proc_names TEXT,                          -- 감지할 실행파일명(쉼표구분)
  is_premium INTEGER NOT NULL DEFAULT 0     -- 유료 과금 대상 여부
);

-- 직원(카운터 로그인)
CREATE TABLE IF NOT EXISTS staff (
  id            INTEGER PRIMARY KEY,
  login         TEXT NOT NULL UNIQUE,
  name          TEXT,
  password_hash TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'staff', -- admin / staff
  created_at    TEXT
);

-- 쿠폰(시간/선불금 충전용 코드)
CREATE TABLE IF NOT EXISTS coupons (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL DEFAULT 'minutes', -- minutes / cash
  value      INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  member_id  INTEGER,
  created_at TEXT NOT NULL,
  used_at    TEXT
);

-- 매장 설정(영수증 등에 사용)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 현금 시재 점검
CREATE TABLE IF NOT EXISTS cash_counts (
  id       INTEGER PRIMARY KEY,
  ts       TEXT NOT NULL,
  actor    TEXT,
  counted  INTEGER NOT NULL,
  expected INTEGER NOT NULL,
  memo     TEXT
);

-- 시스템 로그(운영 기록)
CREATE TABLE IF NOT EXISTS logs (
  id     INTEGER PRIMARY KEY,
  ts     TEXT NOT NULL,
  actor  TEXT,
  action TEXT NOT NULL,
  detail TEXT
);

-- 판매 상품(음료/과자/이용권 등)
CREATE TABLE IF NOT EXISTS products (
  id        INTEGER PRIMARY KEY,
  category  TEXT NOT NULL DEFAULT '기타',
  name      TEXT NOT NULL,
  price     INTEGER NOT NULL DEFAULT 0,
  on_sale   INTEGER NOT NULL DEFAULT 1,   -- 판매 여부
  exposed   INTEGER NOT NULL DEFAULT 1,   -- 판매 노출
  sold_out  INTEGER NOT NULL DEFAULT 0    -- 매진
);
