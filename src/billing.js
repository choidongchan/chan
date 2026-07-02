// 과금 엔진: 세션의 경과 시간과 요금제로 요금(원)을 계산.
// 1단계는 "시간당 요금(time)"과 "선불 차감(prepaid)"만 지원.

export function elapsedMinutes(startedAtISO, endISO = null) {
  const start = new Date(startedAtISO).getTime();
  const end = endISO ? new Date(endISO).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 60000));
}

// 분 단위 과금(초과분은 분당 요금으로 반올림 없이 계산).
// 실매장 정책(10분 단위 등)은 추후 옵션화.
export function calcCharge(plan, minutes) {
  if (!plan) return 0;
  if (plan.kind === 'fixed') return plan.won_per_hour; // 정액(1회)
  const wonPerMinute = plan.won_per_hour / 60;
  return Math.round(minutes * wonPerMinute);
}

// 회원 잔여시간(분)으로 이용 가능한지, 요금을 시간차감으로 처리할지 계산
export function chargeFromMemberMinutes(member, minutes) {
  const use = Math.min(member.balance_minutes, minutes);
  return { deductMinutes: use, remainderMinutes: minutes - use };
}
