export const DAYS = ['월', '화', '수', '목', '금'];
export const MAX_SONGS = { 월: 12, 화: 12, 수: 12, 목: 12, 금: 15 };
export const MAX_WEEKLY_SONGS = 2;
export const MAX_DURATION_SECONDS = 270;
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstNow(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

export function kstDate(date = new Date()) {
  return kstNow(date).toISOString().slice(0, 10);
}

export function allowedDays(date = new Date()) {
  const current = kstNow(date);
  const weekday = current.getUTCDay();
  const afterCutoff = current.getUTCHours() > 23 || (current.getUTCHours() === 23 && current.getUTCMinutes() >= 40);
  if (weekday === 0) {
    if (current.getUTCHours() < 9) return [];
    return afterCutoff ? DAYS.slice(1) : [...DAYS];
  }
  if (weekday >= 5) return [];
  const mondayIndex = weekday - 1;
  return DAYS.slice(mondayIndex + 1 + (afterCutoff ? 1 : 0));
}

export function secondsFromText(value) {
  if (!value) return null;
  const parts = String(value).split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}
