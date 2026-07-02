// 직원 로그인 인증: 비밀번호 해시(scrypt) + 메모리 토큰 세션
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const dk = scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${dk}`;
}

export function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, dk] = stored.split(':');
  const test = scryptSync(pw, salt, 32);
  const orig = Buffer.from(dk, 'hex');
  return orig.length === test.length && timingSafeEqual(orig, test);
}

// 토큰 세션 (서버 재시작 시 초기화)
const sessions = new Map(); // token -> { staffId, login, name, role }
export function createToken(staff) {
  const token = randomBytes(24).toString('hex');
  sessions.set(token, { staffId: staff.id, login: staff.login, name: staff.name, role: staff.role });
  return token;
}
export function getSession(token) {
  return token ? sessions.get(token) : null;
}
export function destroyToken(token) {
  sessions.delete(token);
}
