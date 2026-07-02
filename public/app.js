// 카운터 대시보드 프론트엔드
let STATE = { seats: [], plans: [], members: [], summary: {} };

const won = (n) => (n ?? 0).toLocaleString('ko-KR') + '원';
const fmtMin = (m) => `${Math.floor(m / 60)}시간 ${m % 60}분`;

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '오류');
  return data;
}

// 실시간 스트림 구독
function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const s = JSON.parse(e.data);
    STATE.seats = s.seats; STATE.plans = s.plans; STATE.summary = s.summary;
    render();
  };
  es.onerror = () => setTimeout(() => { es.close(); connect(); }, 2000);
}

function render() {
  const s = STATE.summary;
  document.getElementById('summary').innerHTML = `
    <div>전체 <b>${s.total ?? 0}</b></div>
    <div>사용중 <b style="color:var(--use)">${s.in_use ?? 0}</b></div>
    <div>빈자리 <b>${s.empty ?? 0}</b></div>
    <div class="sales">오늘매출 <b>${won(s.sales_today)}</b></div>`;

  document.getElementById('seats').innerHTML = STATE.seats.map((seat) => {
    if (seat.status === 'in_use') {
      const ss = seat.session;
      const line = ss.kind === 'member'
        ? `회원 · 남은시간 ${ss.remain_minutes != null ? fmtMin(ss.remain_minutes) : '-'}`
        : `게스트 · ${won(ss.running_charge)}`;
      const game = seat.game
        ? `<div class="game ${seat.game.is_premium ? 'prem' : ''}">🎮 ${seat.game.name}${seat.game.is_premium ? ' (유료)' : ''}</div>`
        : '';
      return `<div class="seat in_use" onclick="openSeat(${seat.id})">
        <div class="no">${seat.seat_no}번</div><div class="zone">${seat.zone}</div>
        <div class="info">${line}<br>이용 ${fmtMin(ss.minutes)}</div>${game}</div>`;
    }
    return `<div class="seat" onclick="openSeat(${seat.id})">
      <div class="no">${seat.seat_no}번</div><div class="zone">${seat.zone}</div>
      <div class="empty-label">빈자리</div></div>`;
  }).join('');
}

async function loadMembers() {
  STATE.members = await api('/api/members');
  document.getElementById('members').innerHTML = STATE.members.map((m) => `
    <div class="member-row">
      <span>${m.login_id}<br><small style="color:var(--muted)">${m.name || ''} · 잔여 ${m.balance_minutes}분</small></span>
      <button onclick="chargeMember(${m.id})">충전</button>
    </div>`).join('') || '<div style="color:var(--muted)">회원 없음</div>';
}

// ---- 좌석 팝업 ----
window.openSeat = function (seatId) {
  const seat = STATE.seats.find((s) => s.id === seatId);
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');
  title.textContent = `${seat.seat_no}번 좌석 (${seat.zone})`;

  if (seat.status === 'in_use') {
    const ss = seat.session;
    body.innerHTML = `
      <div class="row">상태: <b>사용중</b> (${ss.kind === 'member' ? '회원' : '게스트'})</div>
      <div class="row">이용시간: <b>${fmtMin(ss.minutes)}</b></div>
      <div class="row">요금제: ${ss.plan_name || '-'}</div>
      ${ss.kind === 'member' ? `<div class="row">남은시간: ${ss.remain_minutes != null ? fmtMin(ss.remain_minutes) : '-'}</div>`
        : `<div class="row">현재요금: <b>${won(ss.running_charge)}</b></div>`}
      ${seat.game ? `<div class="row">실행게임: ${seat.game.name}${seat.game.is_premium ? ' <b style="color:var(--prem)">(유료)</b>' : ''}</div>` : ''}
      <button class="danger" style="width:100%;margin-top:10px" onclick="endSeat(${seatId})">이용 종료 / 정산</button>`;
  } else {
    const opts = STATE.plans.map((p) => `<option value="${p.id}">${p.name} (${p.won_per_hour}원/시간)</option>`).join('');
    body.innerHTML = `
      <div class="field"><label>요금제</label><select id="planSel">${opts}</select></div>
      <div class="field"><label>회원 아이디 (비우면 게스트)</label><input id="memLogin" placeholder="예: test01" /></div>
      <button style="width:100%" onclick="startSeat(${seatId})">착석 시작</button>`;
  }
  document.getElementById('modal').classList.remove('hidden');
};
window.closeModal = () => document.getElementById('modal').classList.add('hidden');

window.startSeat = async function (seatId) {
  const plan = document.getElementById('planSel').value;
  const login = document.getElementById('memLogin').value.trim();
  try {
    await api(`/api/seats/${seatId}/start`, 'POST', { rate_plan_id: +plan, member_login: login || undefined });
    closeModal();
  } catch (e) { alert(e.message); }
};
window.endSeat = async function (seatId) {
  try {
    const r = await api(`/api/seats/${seatId}/end`, 'POST');
    closeModal();
    alert(`정산 완료\n이용 ${fmtMin(r.minutes)} / 요금 ${won(r.amount)}`);
  } catch (e) { alert(e.message); }
};
window.chargeMember = async function (id) {
  const min = prompt('충전할 시간(분)을 입력하세요', '60');
  if (min == null) return;
  try { await api(`/api/members/${id}/charge`, 'POST', { minutes: +min }); loadMembers(); }
  catch (e) { alert(e.message); }
};

document.getElementById('memberForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/api/members', 'POST', { login_id: f.get('login_id'), name: f.get('name') });
    e.target.reset(); loadMembers();
  } catch (err) { alert(err.message); }
});

connect();
loadMembers();
setInterval(loadMembers, 15000);
