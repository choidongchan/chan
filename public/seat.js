// 좌석 PC 키오스크 화면. 사용법: /seat.html?seat=3
const SEAT = +(new URLSearchParams(location.search).get('seat') || 1);
const $ = (id) => document.getElementById(id);
$('seatLabel').textContent = `${SEAT}번 좌석`;
$('lockSeat').textContent = `${SEAT}번 좌석`;

const fmt = (m) => {
  if (m == null) return '--:--';
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}` : `${mm}분`;
};

async function poll() {
  try {
    const r = await fetch(`/api/seat/status?seat_no=${SEAT}`).then((x) => x.json());
    showNotice(r.notice);
    if (r.in_use) {
      lock(false);
      $('inUse').style.display = 'block';
      if (r.kind === 'member') {
        const low = r.remain_minutes != null && r.remain_minutes <= 5;
        $('clock').textContent = fmt(r.remain_minutes);
        $('clock').className = 'clock' + (low ? ' low' : '');
        $('sub').textContent = `${r.member} 님 · 남은시간`;
        if (r.remain_minutes === 0) { // 시간 소진 → 자동 종료/잠금
          await fetch('/api/seat/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seat_no: SEAT }) });
        }
      } else {
        $('clock').textContent = fmt(r.minutes);
        $('clock').className = 'clock';
        $('sub').textContent = `게스트 · 현재요금 ${(r.running_charge || 0).toLocaleString('ko-KR')}원`;
      }
      $('game').textContent = '';
    } else {
      $('inUse').style.display = 'none';
      lock(true);
    }
  } catch { /* 서버 단절 시 유지 */ }
}

function lock(on) { $('lock').classList.toggle('hidden', !on); }
function showNotice(msg) {
  let el = document.getElementById('notice');
  if (!el) { el = document.createElement('div'); el.id = 'notice'; document.body.appendChild(el); }
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

window.login = async function () {
  const id = $('memberId').value.trim();
  if (!id) return;
  $('err').textContent = '';
  try {
    const res = await fetch('/api/seat/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seat_no: SEAT, member_login: id }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || '로그인 실패');
    $('memberId').value = '';
    poll();
  } catch (e) { $('err').textContent = e.message; }
};

window.logout = async function () {
  if (!confirm('이용을 종료할까요?')) return;
  await fetch('/api/seat/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seat_no: SEAT }) });
  poll();
};

$('memberId').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
poll();
setInterval(poll, 3000);
