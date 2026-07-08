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

// ---- 메뉴: 좌석현황(다크 뷰) / 나머지(밝은 팝업) ----
const POP_TITLES = { members: '회원 관리', products: '상품 관리', history: '이용내역', orders: '주문 내역', sales: '매출', games: '유료게임', logs: '시스템 로그', kiosk: '키오스크 관제', settings: '설정' };
async function loadLogs() {
  const rows = (await api('/api/logs')).map((l) => `<tr>
      <td>${fmtDT(l.ts)}</td><td><span class="pill blue">${l.actor}</span></td>
      <td><b>${l.action}</b></td><td>${l.detail || ''}</td></tr>`).join('');
  $('logsTable').innerHTML = `<table class="tbl"><thead><tr><th>시각</th><th>담당</th><th>동작</th><th>상세</th></tr></thead>
    <tbody>${rows || '<tr><td colspan=4 class="muted">로그 없음</td></tr>'}</tbody></table>`;
}
window.kioskAction = (name) => alert(`[${name}] 요청을 키오스크로 전송했습니다.\n(실제 키오스크 연동 시 원격 실행됩니다)`);
document.querySelectorAll('.menu .m').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.menu .m').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.tab === 'seats') { closeWcPop(); return; }
    openWcPop(btn.dataset.pop);
  });
});
function openWcPop(pop) {
  $('wcTitle').textContent = POP_TITLES[pop] || '';
  document.querySelectorAll('.psec').forEach((s) => s.classList.remove('active'));
  $('p-' + pop).classList.add('active');
  $('wcpop').classList.remove('hidden');
  ({ members: loadMembers, products: loadProducts, history: loadHistory, orders: loadOrders, sales: loadSales, games: loadGames, logs: loadLogs, settings: loadSettings }[pop])?.();
}
function closeWcPop() {
  $('wcpop').classList.add('hidden');
  document.querySelectorAll('.menu .m').forEach((b) => b.classList.remove('active'));
  document.querySelector('.menu .m[data-tab="seats"]').classList.add('active');
}
window.closeWcPop = closeWcPop;

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
  const pct = s.total ? Math.round((s.in_use / s.total) * 1000) / 10 : 0;
  $('uUse').textContent = s.in_use ?? 0;
  $('uTotal').textContent = s.total ?? 0;
  $('uPct').textContent = pct + '%';
  $('salesToday').textContent = '오늘매출 ' + won(s.sales_today);
}

// 실시간 시계
function tickClock() {
  const d = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const p = (n) => String(n).padStart(2, '0');
  $('clock').innerHTML = `<small>${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})</small>${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
setInterval(tickClock, 1000); tickClock();

// 좌석 배치도 렌더링 (pos_x/pos_y 좌표로 절대 배치)
const TILE_W = 116, TILE_H = 62, GAP_X = 10, GAP_Y = 10;
const sn3 = (n) => String(n).padStart(3, '0');

function renderSeats() {
  const map = $('seatmap');
  let maxX = 0, maxY = 0;
  const html = STATE.seats.map((seat) => {
    maxX = Math.max(maxX, seat.pos_x); maxY = Math.max(maxY, seat.pos_y);
    const left = seat.pos_x * (TILE_W + GAP_X);
    const top = seat.pos_y * (TILE_H + GAP_Y);
    const pos = `data-id="${seat.id}" style="left:${left}px;top:${top}px"`;
    if (seat.status === 'in_use') {
      const ss = seat.session;
      const isMember = ss.kind === 'member';
      const low = isMember && ss.remain_minutes != null && ss.remain_minutes <= 5;
      const cls = 'seat ' + (low ? 'warn' : isMember ? 'member' : 'guest');
      // 이름/번호
      const who = isMember
        ? `${ss.member_name || ss.member_login} <small>(${ss.member_id})</small>`
        : `비회원 <small>(0000)</small>`;
      // 타이머: 회원=남은시간 카운트다운, 게스트=이용시간 카운트업
      const timeAttr = isMember
        ? `data-zero="${Date.now() + (ss.remain_minutes ?? 0) * 60000}"`
        : `data-start="${Date.parse(ss.started_at)}"`;
      const icons = `<div class="icons"><i style="background:${isMember ? '#8f97ff' : '#7a5800'}"></i>${seat.game ? `<i style="background:${seat.game.is_premium ? '#ff5a5f' : '#33c481'}"></i>` : ''}</div>`;
      const game = seat.game ? `<div class="g">${seat.game.name}${seat.game.is_premium ? ' ⭐' : ''}</div>` : '';
      return `<div class="${cls}" ${pos} onclick="openSeat(${seat.id})">
        <div class="sn">${sn3(seat.seat_no)}</div>${icons}
        <div class="u">${who}</div>
        <div class="t" ${timeAttr}>00:00</div>${game}</div>`;
    }
    return `<div class="seat" ${pos} onclick="openSeat(${seat.id})">
      <div class="sn">${sn3(seat.seat_no)}</div>
      <div class="x">✕</div></div>`;
  }).join('');
  map.innerHTML = html;
  map.style.width = (maxX + 1) * (TILE_W + GAP_X) + 'px';
  map.style.height = (maxY + 1) * (TILE_H + GAP_Y) + 'px';
  tickSeats();
}

// 좌석 타이머 1초 갱신
function clockStr(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
function tickSeats() {
  const now = Date.now();
  document.querySelectorAll('#seatmap .t').forEach((el) => {
    if (el.dataset.zero) el.textContent = clockStr((+el.dataset.zero - now) / 1000);
    else if (el.dataset.start) el.textContent = clockStr((now - +el.dataset.start) / 1000);
  });
}
setInterval(tickSeats, 1000);

// ---- 좌석 배치도 편집 (드래그) ----
let editMode = false;
window.toggleEdit = function () {
  editMode = !editMode;
  $('editBtn').textContent = editMode ? '✔ 편집 완료' : '🔧 배치 편집';
  $('editBtn').classList.toggle('on', editMode);
  $('seatmap').classList.toggle('editing', editMode);
};
let drag = null;
$('seatmap').addEventListener('mousedown', (e) => {
  if (!editMode) return;
  const el = e.target.closest('.seat');
  if (!el) return;
  const r = el.getBoundingClientRect();
  drag = { el, dx: e.clientX - r.left, dy: e.clientY - r.top };
  el.style.zIndex = 30; el.style.opacity = '.85';
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const m = $('seatmap').getBoundingClientRect();
  drag.el.style.left = Math.max(0, e.clientX - m.left - drag.dx) + 'px';
  drag.el.style.top = Math.max(0, e.clientY - m.top - drag.dy) + 'px';
});
document.addEventListener('mouseup', async () => {
  if (!drag) return;
  const el = drag.el; drag = null;
  const px = Math.max(0, Math.round(parseFloat(el.style.left) / (TILE_W + GAP_X)));
  const py = Math.max(0, Math.round(parseFloat(el.style.top) / (TILE_H + GAP_Y)));
  el.style.left = px * (TILE_W + GAP_X) + 'px';
  el.style.top = py * (TILE_H + GAP_Y) + 'px';
  el.style.zIndex = ''; el.style.opacity = '';
  try { await api('/api/seats/' + el.dataset.id, 'PATCH', { pos_x: px, pos_y: py }); } catch (e) { }
});

// ---- 매출 대시보드 (일/월/연) ----
let salesPeriod = 'day';
const PERIOD_LABEL = { day: '일', month: '월', year: '연' };
async function loadSales() {
  const r = await api('/api/report/sales?period=' + salesPeriod);
  const diffSign = r.diff > 0 ? '▲' : r.diff < 0 ? '▼' : '-';
  const diffColor = r.diff >= 0 ? '#16a34a' : '#ef4444';
  const cards = `
    <div class="cards">
      <div class="card big"><div class="ci">💰</div><div class="cl">${PERIOD_LABEL[r.period]} 매출 총합계</div><div class="cv">${won(r.total)}</div></div>
      <div class="card"><div class="cl">상품 판매</div><div class="cv">${won(r.goods_total)}</div></div>
      <div class="card"><div class="cl">PC 이용</div><div class="cv">${won(r.seat_total)}</div></div>
      <div class="card"><div class="cl">이용자 현황</div><div class="cv">${r.user_count}명</div></div>
      <div class="card"><div class="cl">전${PERIOD_LABEL[r.period]} 대비</div><div class="cv" style="color:${diffColor}">${diffSign} ${won(Math.abs(r.diff))}</div></div>
    </div>`;
  const top = `
    <div class="panel"><div class="ph">상품판매 TOP 5</div>
      <table class="tbl"><thead><tr><th>No</th><th>상품명</th><th class="r">금액</th><th class="r">판매수</th></tr></thead>
      <tbody>${r.top_products.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td class="r">${won(p.amount)}</td><td class="r">${p.cnt}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">판매 내역 없음</td></tr>'}</tbody></table></div>`;
  const cats = `
    <div class="panel"><div class="ph">분류별 매출</div>
      <table class="tbl"><thead><tr><th>No</th><th>분류</th><th class="r">매출</th></tr></thead>
      <tbody>${r.by_category.map((c, i) => `<tr><td>${i + 1}</td><td>${c.category}</td><td class="r">${won(c.amount)}</td></tr>`).join('') || '<tr><td colspan=3 class="muted">매출 없음</td></tr>'}</tbody></table></div>`;
  const pays = `
    <div class="panel"><div class="ph">건별 결제 내역</div>
      <table class="tbl"><thead><tr><th>PC번호</th><th>사용자(뒷자리)</th><th>성인여부</th><th>결제 상품명</th><th class="r">결제금액</th><th>유형</th><th>결제시간</th></tr></thead>
      <tbody>${r.payments.map((p) => `<tr>
        <td>${p.seat_no ?? '-'}</td>
        <td>${p.user ? `${p.user}${p.phone4 ? ` <small style="color:#9aa6bd">(${p.phone4})</small>` : ''}` : '<span style="color:#9aa6bd">비회원</span>'}</td>
        <td>${p.is_adult == null ? '-' : (p.is_adult ? '성인' : '미성년')}</td>
        <td>${p.product}</td><td class="r">${won(p.amount)}</td>
        <td><span class="pill blue">${p.type_label}</span></td><td>${fmtDT(p.created_at)}</td>
      </tr>`).join('') || '<tr><td colspan=7 class="muted">결제 내역 없음</td></tr>'}</tbody></table></div>`;
  $('salesReport').innerHTML = cards + `<div class="sales-grid"><div>${pays}</div><div>${top}${cats}</div></div>`;
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

// ---- 날짜 헬퍼 ----
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }) : '-';
const fmtDT = (iso) => iso ? new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
const secStr = (m) => m == null ? '-' : `${Math.floor(m / 60)}시간 ${m % 60}분`;

// ---- 회원 관리 (상세) ----
async function loadMembers() {
  const all = await api('/api/members');
  const q = ($('memberSearch')?.value || '').trim();
  const list = q ? all.filter((m) => (m.name || '').includes(q) || (m.nickname || '').includes(q) || (m.login_id || '').includes(q)) : all;
  const rows = list.map((m) => `<tr>
      <td>${m.name || '-'}</td>
      <td>${m.nickname || '-'}</td>
      <td>${m.phone ? m.phone.slice(-4) : '-'}</td>
      <td>${m.is_adult ? '성인' : '<span class="pill amber">미성년</span>'}</td>
      <td>${secStr(m.balance_minutes)}</td>
      <td class="r">${won(m.balance_cash)}</td>
      <td>${fmtDate(m.created_at)}</td>
      <td>${fmtDate(m.last_visit_at)}</td>
      <td>${m.blacklist ? '<span class="pill red">차단</span>' : '<span class="pill off">-</span>'}</td>
      <td>${m.login_block ? '<span class="pill red">금지</span>' : '<span class="pill off">-</span>'}</td>
      <td><button class="mini" onclick="memberDetail(${m.id})">상세</button>
          <button class="mini" onclick="chargeMember(${m.id})">충전</button>
          <button class="mini gray" onclick="toggleBlack(${m.id},${m.blacklist ? 0 : 1})">${m.blacklist ? '해제' : '블랙'}</button></td>
    </tr>`).join('');
  $('membersTable').innerHTML = `<table class="tbl">
    <thead><tr><th>이름</th><th>닉네임</th><th>휴대폰뒷자리</th><th>성인여부</th><th>남은시간</th><th class="r">선불금</th><th>가입일</th><th>최근방문</th><th>블랙리스트</th><th>로그인금지</th><th>관리</th></tr></thead>
    <tbody>${rows || '<tr><td colspan=11 class="muted">회원 없음</td></tr>'}</tbody></table>`;
}
window.toggleBlack = async (id, v) => { try { await api('/api/members/' + id, 'PATCH', { blacklist: v }); loadMembers(); } catch (e) { alert(e.message); } };
window.memberDetail = async function (id) {
  const d = await api('/api/members/' + id + '/detail');
  const m = d.member;
  const typeL = { seat: 'PC이용', goods: '상품', charge: '충전' };
  const sess = d.sessions.map((s) => `<tr><td>${s.seat_no}</td><td>${fmtDT(s.started_at)}</td><td>${s.ended_at ? fmtDT(s.ended_at) : '이용중'}</td><td>${s.minutes == null ? '-' : secStr(s.minutes)}</td><td class="r">${won(s.amount)}</td></tr>`).join('') || '<tr><td colspan=5 class="muted">없음</td></tr>';
  const sale = d.sales.map((s) => `<tr><td>${typeL[s.type] || s.type}</td><td>${s.name || '-'}</td><td class="r">${won(s.amount)}</td><td>${fmtDT(s.created_at)}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">없음</td></tr>';
  $('modalTitle').textContent = `${m.name || m.login_id} · ${m.nickname || ''}`;
  $('modalBody').innerHTML = `
    <div class="seat-detail">
      <div class="sd-row"><span>아이디</span><b>${m.login_id}</b></div>
      <div class="sd-row"><span>연락처</span><b>${m.phone || '-'}</b></div>
      <div class="sd-row"><span>남은시간 / 선불금</span><b>${secStr(m.balance_minutes)} / ${won(m.balance_cash)}</b></div>
      <div class="sd-row"><span>가입일 / 최근방문</span><b>${fmtDate(m.created_at)} / ${fmtDate(m.last_visit_at)}</b></div>
    </div>
    <div style="font-weight:700;margin:6px 0 6px;color:var(--muted)">이용 내역</div>
    <div style="max-height:150px;overflow:auto"><table class="tbl"><thead><tr><th>PC</th><th>시작</th><th>종료</th><th>이용</th><th class="r">요금</th></tr></thead><tbody>${sess}</tbody></table></div>
    <div style="font-weight:700;margin:12px 0 6px;color:var(--muted)">결제/충전 내역</div>
    <div style="max-height:150px;overflow:auto"><table class="tbl"><thead><tr><th>구분</th><th>내용</th><th class="r">금액</th><th>시각</th></tr></thead><tbody>${sale}</tbody></table></div>`;
  $('modal').classList.remove('hidden');
};
window.focusMemberForm = () => $('#memberForm [name=login_id]')?.focus();

// ---- 이용 내역 ----
async function loadHistory() {
  const rows = (await api('/api/history')).map((h) => `<tr>
      <td>${h.seat_no}</td>
      <td>${h.user ? `${h.user} <small style="color:#9aa6bd">(${h.user_no})</small>` : '<span style="color:#9aa6bd">비회원</span>'}</td>
      <td>${h.is_adult == null ? '-' : (h.is_adult ? '성인' : '미성년')}</td>
      <td class="r">${won(h.amount)}</td>
      <td>${fmtDT(h.started_at)}</td>
      <td>${h.ended_at ? fmtDT(h.ended_at) : '<span class="pill blue">이용중</span>'}</td>
      <td>${h.minutes == null ? '-' : secStr(h.minutes)}</td>
    </tr>`).join('');
  $('historyTable').innerHTML = `<table class="tbl">
    <thead><tr><th>PC 번호</th><th>사용자</th><th>성인여부</th><th class="r">결제금액</th><th>사용시작</th><th>사용종료</th><th>이용시간</th></tr></thead>
    <tbody>${rows || '<tr><td colspan=7 class="muted">내역 없음</td></tr>'}</tbody></table>`;
}

// ---- 상품 관리 ----
async function loadProducts() {
  const rows = (await api('/api/products')).map((p) => `<tr>
      <td>${p.category}</td><td>${p.name}</td><td class="r">${won(p.price)}</td>
      <td>${p.on_sale ? '<span class="pill on">판매</span>' : '<span class="pill off">중지</span>'}</td>
      <td>${p.exposed ? '노출' : '숨김'}</td>
      <td>${p.sold_out ? '<span class="pill red">매진</span>' : '<span class="pill off">항시판매</span>'}</td>
      <td><button class="mini gray" onclick="delProduct(${p.id})">삭제</button></td>
    </tr>`).join('');
  $('productsTable').innerHTML = `<table class="tbl">
    <thead><tr><th>분류</th><th>상품 이름</th><th class="r">판매 금액</th><th>판매 여부</th><th>판매 노출</th><th>매진 설정</th><th>관리</th></tr></thead>
    <tbody>${rows || '<tr><td colspan=7 class="muted">상품 없음</td></tr>'}</tbody></table>`;
}
window.delProduct = async (id) => { if (!confirm('삭제할까요?')) return; try { await api('/api/products/' + id, 'DELETE'); loadProducts(); } catch (e) { alert(e.message); } };
window.openProductForm = () => {
  $('modalTitle').textContent = '새 상품 등록';
  $('modalBody').innerHTML = `
    <div class="field"><label>분류</label><input id="pCat" placeholder="음료/먹거리/이용권" /></div>
    <div class="field"><label>상품 이름</label><input id="pName" /></div>
    <div class="field"><label>판매 금액(원)</label><input id="pPrice" type="number" /></div>
    <button style="width:100%" onclick="addProduct()">등록</button>`;
  $('modal').classList.remove('hidden');
};
window.addProduct = async () => {
  try {
    await api('/api/products', 'POST', { category: $('pCat').value, name: $('pName').value, price: +$('pPrice').value });
    closeModal(); loadProducts();
  } catch (e) { alert(e.message); }
};

// ---- 주문 내역 ----
async function loadOrders() {
  const methodLabel = { cash: '현금', card: '카드', prepaid: '선불' };
  const rows = (await api('/api/orders')).map((o) => `<tr>
      <td>#${o.id}</td><td>${o.name}</td>
      <td>${o.customer || '<span style="color:#9aa6bd">비회원</span>'}</td>
      <td><span class="pill blue">${methodLabel[o.method] || o.method}</span></td>
      <td class="r">${won(o.amount)}</td><td>${fmtDT(o.created_at)}</td>
      <td><span class="pill on">판매완료</span></td>
    </tr>`).join('');
  $('ordersTable').innerHTML = `<table class="tbl">
    <thead><tr><th>주문번호</th><th>상품</th><th>고객</th><th>결제수단</th><th class="r">결제금액</th><th>주문시각</th><th>상태</th></tr></thead>
    <tbody>${rows || '<tr><td colspan=7 class="muted">주문 없음</td></tr>'}</tbody></table>`;
}

// ---- 좌석 클릭 상세 팝업 (충전/이동/정산/착석) ----
window.openSeat = function (seatId) {
  if (editMode) return; // 편집 중엔 클릭 대신 드래그
  const seat = STATE.seats.find((s) => s.id === seatId);
  $('modalTitle').textContent = `${seat.seat_no}번 좌석 · ${seat.zone}`;
  const body = $('modalBody');
  if (seat.status === 'in_use') {
    const ss = seat.session;
    const isMember = ss.kind === 'member';
    body.innerHTML = `
      <div class="seat-detail">
        <div class="sd-row"><span>상태</span><b>${isMember ? `회원 · ${ss.member_name || ss.member_login}` : '비회원(게스트)'}</b></div>
        <div class="sd-row"><span>이용시간</span><b>${fmtMin(ss.minutes)}</b></div>
        <div class="sd-row"><span>요금제</span><b>${ss.plan_name || '-'}</b></div>
        ${isMember ? `<div class="sd-row"><span>남은시간</span><b>${ss.remain_minutes != null ? fmtMin(ss.remain_minutes) : '-'}</b></div>`
          : `<div class="sd-row"><span>현재요금</span><b>${won(ss.running_charge)}</b></div>`}
        ${seat.game ? `<div class="sd-row"><span>실행게임</span><b>${seat.game.name}${seat.game.is_premium ? ' (유료)' : ''}</b></div>` : ''}
      </div>
      <div class="btn-grid">
        ${isMember ? `<button onclick="addTimeSeat(${seatId})">⏱ 시간충전</button>` : `<button onclick="chargeGuest(${seatId})">💳 결제</button>`}
        <button class="gray2" onclick="moveSeatUI(${seatId})">↔ 자리이동</button>
        <button class="gray2" onclick="openGoodsFor(${seat.seat_no})">🛒 상품판매</button>
        <button class="danger" onclick="endSeat(${seatId})">■ 종료/정산</button>
      </div>`;
  } else {
    const opts = STATE.plans.map((p) => `<option value="${p.id}">${p.name} (${p.won_per_hour}원/시간)</option>`).join('');
    body.innerHTML = `
      <div class="field"><label>요금제</label><select id="planSel">${opts}</select></div>
      <div class="field"><label>회원 아이디 (비우면 게스트)</label><input id="memLogin" placeholder="예: test01" /></div>
      <button style="width:100%" onclick="startSeat(${seatId})">착석 시작</button>`;
  }
  $('modal').classList.remove('hidden');
};
window.addTimeSeat = async function (seatId) {
  const min = prompt('충전할 시간(분)을 입력하세요', '60');
  if (min == null) return;
  try { await api(`/api/seats/${seatId}/addtime`, 'POST', { minutes: +min }); closeModal(); }
  catch (e) { alert(e.message); }
};
window.chargeGuest = async function (seatId) {
  const amt = prompt('결제 금액(원)을 입력하세요', '5000');
  if (amt == null) return;
  try { await api('/api/goods', 'POST', { name: 'PC 선불결제', amount: +amt }); closeModal(); alert('결제 등록됨'); }
  catch (e) { alert(e.message); }
};
window.moveSeatUI = async function (seatId) {
  const to = prompt('이동할 빈 좌석 번호를 입력하세요');
  if (to == null) return;
  try { await api(`/api/seats/${seatId}/move`, 'POST', { to_seat_no: +to }); closeModal(); }
  catch (e) { alert(e.message); }
};
window.openGoodsFor = function (seatNo) { closeModal(); openGoods(); };
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
window.openCash = async function () {
  const c = await api('/api/cash');
  const hist = c.history.map((h) => `<tr><td>${fmtDT(h.ts)}</td><td>${h.actor}</td><td class="r">${won(h.counted)}</td><td class="r">${won(h.expected)}</td><td class="r" style="color:${h.counted - h.expected < 0 ? 'var(--warn)' : 'var(--ok)'}">${won(h.counted - h.expected)}</td></tr>`).join('') || '<tr><td colspan=5 class="muted">기록 없음</td></tr>';
  $('modalTitle').textContent = '현금 시재 관리';
  $('modalBody').innerHTML = `
    <div class="seat-detail">
      <div class="sd-row"><span>오늘 현금 매출(예상 시재)</span><b>${won(c.expected)}</b></div>
    </div>
    <div class="field"><label>실제 보유 현금(원)</label><input id="cashCounted" type="number" placeholder="${c.expected}" /></div>
    <div class="field"><label>메모</label><input id="cashMemo" placeholder="교대/마감 등" /></div>
    <button style="width:100%" onclick="saveCash()">시재 기록</button>
    <div style="font-weight:700;margin:14px 0 6px;color:var(--muted)">점검 이력</div>
    <div style="max-height:160px;overflow:auto"><table class="tbl"><thead><tr><th>시각</th><th>담당</th><th class="r">실제</th><th class="r">예상</th><th class="r">차액</th></tr></thead><tbody>${hist}</tbody></table></div>`;
  $('modal').classList.remove('hidden');
};
window.saveCash = async function () {
  try { await api('/api/cash', 'POST', { counted: +$('cashCounted').value, memo: $('cashMemo').value }); closeModal(); alert('시재 기록됨'); }
  catch (e) { alert(e.message); }
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
    await api('/api/members', 'POST', { login_id: f.get('login_id'), name: f.get('name'), nickname: f.get('nickname'), phone: f.get('phone') });
    e.target.reset(); loadMembers();
  } catch (err) { alert(err.message); }
});
document.querySelectorAll('#salesTabs .st').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#salesTabs .st').forEach((x) => x.classList.remove('active'));
  b.classList.add('active'); salesPeriod = b.dataset.period; loadSales();
}));
$('gamesDate').addEventListener('change', loadGames);

// ---- 설정: 매장/요금제/쿠폰/근무자 ----
async function loadSettings() { loadShop(); loadPlans(); loadCoupons(); loadStaff(); }

async function loadStaff() {
  const rows = (await api('/api/staff')).map((s) => `<tr>
      <td>${s.login}</td><td>${s.name || '-'}</td>
      <td>${s.role === 'admin' ? '<span class="pill red">관리자</span>' : '<span class="pill off">근무자</span>'}</td>
      <td>${fmtDate(s.created_at)}</td>
      <td><button class="mini gray" onclick="delStaff(${s.id})">삭제</button></td>
    </tr>`).join('');
  $('staffTable').innerHTML = `<table class="tbl"><thead><tr><th>아이디</th><th>이름</th><th>권한</th><th>등록일</th><th>관리</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}
window.delStaff = async (id) => { if (!confirm('삭제할까요?')) return; try { await api('/api/staff/' + id, 'DELETE'); loadStaff(); } catch (e) { alert(e.message); } };
document.getElementById('staffForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try { await api('/api/staff', 'POST', Object.fromEntries(f)); e.target.reset(); loadStaff(); }
  catch (err) { alert(err.message); }
});

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
