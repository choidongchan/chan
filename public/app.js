// 카운터 대시보드 프론트엔드 (탭형)
let STATE = { seats: [], plans: [], members: [], summary: {} };

const won = (n) => (n ?? 0).toLocaleString('ko-KR') + '원';
const fmtMin = (m) => `${Math.floor(m / 60)}시간 ${m % 60}분`;
const $ = (id) => document.getElementById(id);

let TOKEN = localStorage.getItem('wm_token') || '';

async function api(path, method = 'GET', body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error(data.error || '로그인이 필요합니다'); }
  if (!res.ok) throw new Error(data.error || '오류');
  return data;
}

function showLogin() { $('login').classList.remove('hidden'); }
function hideLogin() { $('login').classList.add('hidden'); }

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/login', 'POST', { login: $('loginId').value, password: $('loginPw').value });
    TOKEN = r.token; localStorage.setItem('wm_token', TOKEN);
    $('whoami').innerHTML = `${r.name} <a href="#" onclick="logout();return false">로그아웃</a>`;
    hideLogin();
  } catch (e2) { alert(e2.message); }
});
window.logout = async function () {
  try { await api('/api/logout', 'POST'); } catch {}
  TOKEN = ''; localStorage.removeItem('wm_token'); location.reload();
};

// ---- 탭 전환 ----
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $('view-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'sales') loadSales();
    if (btn.dataset.tab === 'games') loadGames();
    if (btn.dataset.tab === 'members') loadMembers();
    if (btn.dataset.tab === 'settings') loadSettings();
  });
});

// ---- 실시간 스트림 ----
function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const s = JSON.parse(e.data);
    STATE.seats = s.seats; STATE.plans = s.plans; STATE.summary = s.summary;
    renderSummary(); renderSeats();
  };
  es.onerror = () => setTimeout(() => { es.close(); connect(); }, 2000);
}

function renderSummary() {
  const s = STATE.summary;
  $('summary').innerHTML = `
    <div>전체 <b>${s.total ?? 0}</b></div>
    <div>사용중 <b style="color:var(--use)">${s.in_use ?? 0}</b></div>
    <div>빈자리 <b>${s.empty ?? 0}</b></div>
    <div class="sales">오늘매출 <b>${won(s.sales_today)}</b></div>`;
}

function renderSeats() {
  $('seats').innerHTML = STATE.seats.map((seat) => {
    const dot = `<span class="dot ${seat.online ? 'on' : 'off'}" title="${seat.online ? 'PC 접속' : 'PC 꺼짐'}"></span>`;
    if (seat.status === 'in_use') {
      const ss = seat.session;
      const line = ss.kind === 'member'
        ? `회원 · 남은 ${ss.remain_minutes != null ? fmtMin(ss.remain_minutes) : '-'}`
        : `게스트 · ${won(ss.running_charge)}`;
      const game = seat.game
        ? `<div class="game ${seat.game.is_premium ? 'prem' : ''}">🎮 ${seat.game.name}${seat.game.is_premium ? ' (유료)' : ''}</div>`
        : '';
      return `<div class="seat in_use" onclick="openSeat(${seat.id})">
        <div class="no">${seat.seat_no}번 ${dot}</div><div class="zone">${seat.zone}</div>
        <div class="info">${line}<br>이용 ${fmtMin(ss.minutes)}</div>${game}</div>`;
    }
    return `<div class="seat" onclick="openSeat(${seat.id})">
      <div class="no">${seat.seat_no}번 ${dot}</div><div class="zone">${seat.zone}</div>
      <div class="empty-label">빈자리</div></div>`;
  }).join('');
}

// ---- 매출 ----
async function loadSales() {
  const date = $('salesDate').value || undefined;
  const r = await api('/api/report/daily' + (date ? `?date=${date}` : ''));
  const label = { seat: '좌석요금', charge: '선불충전', goods: '상품판매' };
  const rows = r.by_type.map((t) => `<tr><td>${label[t.type] || t.type}</td><td>${t.cnt}건</td><td class="r">${won(t.amount)}</td></tr>`).join('');
  $('salesReport').innerHTML = `
    <div class="bignum">${r.date} 총매출 <b>${won(r.total)}</b></div>
    <table class="tbl"><thead><tr><th>구분</th><th>건수</th><th class="r">금액</th></tr></thead>
    <tbody>${rows || '<tr><td colspan=3 class="muted">매출 없음</td></tr>'}</tbody></table>
    <div class="muted" style="margin-top:10px">종료 세션 ${r.sessions.cnt}건 · 좌석요금 합계 ${won(r.sessions.amount)}</div>`;
}

// ---- 유료게임 ----
async function loadGames() {
  const date = $('gamesDate').value || undefined;
  const r = await api('/api/report/games' + (date ? `?date=${date}` : ''));
  const rows = r.games.map((g) => `<tr>
      <td>${g.game_name}${g.is_premium ? ' <span class="badge">유료</span>' : ''}</td>
      <td>${g.provider || '-'}</td><td>${g.sessions}회</td><td class="r">${fmtMin(g.minutes)}</td></tr>`).join('');
  $('gamesReport').innerHTML = `<table class="tbl">
    <thead><tr><th>게임</th><th>게임사</th><th>실행</th><th class="r">사용시간</th></tr></thead>
    <tbody>${rows || '<tr><td colspan=4 class="muted">기록 없음</td></tr>'}</tbody></table>`;
}

// ---- 회원 ----
async function loadMembers() {
  STATE.members = await api('/api/members');
  const rows = STATE.members.map((m) => `<tr>
      <td>${m.login_id}</td><td>${m.name || ''}</td><td>${m.phone || ''}</td>
      <td>${m.balance_minutes}분</td><td>${won(m.balance_cash)}</td>
      <td><button onclick="chargeMember(${m.id})">시간충전</button></td></tr>`).join('');
  $('membersTable').innerHTML = `<table class="tbl">
    <thead><tr><th>아이디</th><th>이름</th><th>연락처</th><th>잔여시간</th><th>선불금</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan=6 class="muted">회원 없음</td></tr>'}</tbody></table>`;
}

// ---- 좌석 팝업 ----
window.openSeat = function (seatId) {
  const seat = STATE.seats.find((s) => s.id === seatId);
  $('modalTitle').textContent = `${seat.seat_no}번 좌석 (${seat.zone})`;
  const body = $('modalBody');
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
  $('modal').classList.remove('hidden');
};
window.closeModal = () => $('modal').classList.add('hidden');

window.startSeat = async function (seatId) {
  try {
    await api(`/api/seats/${seatId}/start`, 'POST', {
      rate_plan_id: +$('planSel').value, member_login: $('memLogin').value.trim() || undefined,
    });
    closeModal();
  } catch (e) { alert(e.message); }
};
window.endSeat = async function (seatId) {
  try {
    const r = await api(`/api/seats/${seatId}/end`, 'POST');
    closeModal();
    if (confirm(`정산 완료\n이용 ${fmtMin(r.minutes)} / 요금 ${won(r.amount)}\n\n영수증을 출력할까요?`)) {
      printReceipt(r.session_id);
    }
  } catch (e) { alert(e.message); }
};

async function printReceipt(sessionId) {
  const d = await api('/api/receipt/' + sessionId);
  const w = window.open('', '_blank', 'width=320,height=480');
  w.document.write(`<pre style="font-family:monospace;font-size:13px;padding:10px">
      ${d.shop.shop_name || 'PC방'}
${d.shop.business_no ? '사업자 ' + d.shop.business_no : ''}
${d.shop.phone || ''}
--------------------------------
좌석      ${d.seat_no}번
구분      ${d.kind === 'member' ? '회원' : '게스트'}${d.member ? ' (' + d.member + ')' : ''}
요금제    ${d.plan || '-'}
이용시간  ${Math.floor(d.minutes / 60)}시간 ${d.minutes % 60}분
시작      ${new Date(d.started_at).toLocaleString('ko-KR')}
종료      ${d.ended_at ? new Date(d.ended_at).toLocaleString('ko-KR') : '-'}
--------------------------------
합계      ${(d.amount || 0).toLocaleString('ko-KR')}원
--------------------------------
     이용해 주셔서 감사합니다
</pre><script>print()</script>`);
  w.document.close();
}
window.chargeMember = async function (id) {
  const min = prompt('충전할 시간(분)', '60');
  if (min == null) return;
  try { await api(`/api/members/${id}/charge`, 'POST', { minutes: +min }); loadMembers(); }
  catch (e) { alert(e.message); }
};
window.openGoods = function () {
  $('modalTitle').textContent = '상품 판매';
  $('modalBody').innerHTML = `
    <div class="field"><label>상품명</label><input id="goodsName" placeholder="예: 콜라" /></div>
    <div class="field"><label>금액(원)</label><input id="goodsAmt" type="number" placeholder="2000" /></div>
    <div class="field"><label>결제수단</label>
      <select id="goodsMethod"><option value="cash">현금</option><option value="card">카드</option></select></div>
    <button style="width:100%" onclick="sellGoods()">판매 등록</button>`;
  $('modal').classList.remove('hidden');
};
window.sellGoods = async function () {
  try {
    await api('/api/goods', 'POST', {
      name: $('goodsName').value, amount: +$('goodsAmt').value, method: $('goodsMethod').value,
    });
    closeModal(); alert('상품 판매 등록됨');
  } catch (e) { alert(e.message); }
};

$('memberForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/api/members', 'POST', { login_id: f.get('login_id'), name: f.get('name'), phone: f.get('phone') });
    e.target.reset(); loadMembers();
  } catch (err) { alert(err.message); }
});
$('salesDate').addEventListener('change', loadSales);
$('gamesDate').addEventListener('change', loadGames);

// ---- 설정: 매장/요금제/쿠폰 ----
async function loadSettings() { loadShop(); loadPlans(); loadCoupons(); }

async function loadShop() {
  const s = await api('/api/settings');
  const f = $('shopForm');
  f.shop_name.value = s.shop_name || ''; f.business_no.value = s.business_no || ''; f.phone.value = s.phone || '';
}
$('shopForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try { await api('/api/settings', 'PUT', Object.fromEntries(f)); alert('저장됨'); }
  catch (err) { alert(err.message); }
});

async function loadPlans() {
  const plans = await api('/api/plans');
  $('plansTable').innerHTML = `<table class="tbl"><thead><tr><th>이름</th><th>종류</th><th class="r">요금</th><th>기본</th><th></th></tr></thead><tbody>${
    plans.map((p) => `<tr><td>${p.name}</td><td>${p.kind}</td><td class="r">${won(p.won_per_hour)}/시간</td>
      <td>${p.is_default ? '★' : `<button onclick="setDefaultPlan(${p.id})">지정</button>`}</td>
      <td><button class="danger" onclick="delPlan(${p.id})">삭제</button></td></tr>`).join('')
  }</tbody></table>`;
}
$('planForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try { await api('/api/plans', 'POST', { name: f.get('name'), won_per_hour: +f.get('won_per_hour') }); e.target.reset(); loadPlans(); }
  catch (err) { alert(err.message); }
});
window.setDefaultPlan = async (id) => { try { await api('/api/plans/' + id, 'PUT', { is_default: true }); loadPlans(); } catch (e) { alert(e.message); } };
window.delPlan = async (id) => { if (!confirm('삭제할까요?')) return; try { await api('/api/plans/' + id, 'DELETE'); loadPlans(); } catch (e) { alert(e.message); } };

async function loadCoupons() {
  const cs = await api('/api/coupons');
  $('couponsTable').innerHTML = `<table class="tbl"><thead><tr><th>코드</th><th>종류</th><th class="r">값</th><th>상태</th></tr></thead><tbody>${
    cs.map((c) => `<tr><td>${c.code}</td><td>${c.kind === 'minutes' ? '시간' : '선불금'}</td>
      <td class="r">${c.value}${c.kind === 'minutes' ? '분' : '원'}</td>
      <td>${c.used ? '<span class="muted">사용됨</span>' : '미사용'}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">쿠폰 없음</td></tr>'
  }</tbody></table>`;
}
$('couponForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const r = await api('/api/coupons', 'POST', { kind: f.get('kind'), value: +f.get('value'), count: +f.get('count') });
    alert('발급된 쿠폰:\n' + r.codes.join('\n')); loadCoupons();
  } catch (err) { alert(err.message); }
});

// ---- 초기 인증 상태 ----
if (TOKEN) { hideLogin(); } else { showLogin(); }
connect();
