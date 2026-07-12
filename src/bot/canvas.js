import { createCanvas, loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

const lockImagePath = fileURLToPath(new URL('../../assets/miku-lock-transparent.png', import.meta.url));
const guideImagePath = fileURLToPath(new URL('../../assets/miku-guide-transparent.png', import.meta.url));
const fontFamily = '"Noto Sans CJK KR", "Malgun Gothic", sans-serif';

const palette = {
  ink: '#292536',
  paper: '#fbfeff',
  grid: '#cceff1',
  cyan: '#85dce0',
  cyanPale: '#e1f8f8',
  pink: '#f2a7c0',
  pinkPale: '#fff0f6',
  lilac: '#c8c1ee',
  lilacPale: '#f1efff',
  white: '#ffffff',
};

export const LOCK_COPY = {
  title: (day) => `${day}요일 독점 플리`,
  generalTitle: (day) => `${day}요일 신청이 잠겼어요`,
  applicant: (name) => `${name} 님만 신청 가능`,
  deleted: (count) => `기존 신청곡 ${count}곡 정리 완료`,
};

export function createLockCard({ day, displayName, avatarUrl, deletedCount }) {
  return {
    title: displayName ? LOCK_COPY.title(day) : LOCK_COPY.generalTitle(day),
    applicant: displayName ? LOCK_COPY.applicant(displayName) : null,
    avatarUrl: displayName ? avatarUrl ?? null : null,
    deleted: LOCK_COPY.deleted(deletedCount),
  };
}

export const GUIDE_COPY = {
  title: '주간 음악 신청 안내',
  rules: [
    '하루 총 12곡 · 금요일 15곡',
    '한 사람당 주 2곡까지',
    '같은 곡은 중복 신청 불가',
    '일요일 오전 9시 초기화',
  ],
  cleanup: [
    '불편함을 주거나 너무 시끄러운 곡',
    '너무 길거나 짧은 곡 · 가사가 없는 곡',
  ],
  approval: '자치회 최소 3명이 함께 듣고 동의한 뒤에만 정리',
};

function fill(context, color, x, y, width, height) {
  context.fillStyle = color;
  context.fillRect(x, y, width, height);
}

function strokeBox(context, x, y, width, height, color = palette.ink, lineWidth = 3) {
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.strokeRect(x, y, width, height);
}

function drawGridPaper(context, width, height, step = 60) {
  fill(context, palette.paper, 0, 0, width, height);
  context.beginPath();
  for (let x = 0; x <= width; x += step) {
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, height);
  }
  for (let y = 0; y <= height; y += step) {
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
  }
  context.strokeStyle = palette.grid;
  context.lineWidth = 2;
  context.stroke();
}

function drawWindow(context, { x, y, width, height, title, accent = palette.cyan }) {
  fill(context, palette.white, x, y, width, height);
  strokeBox(context, x, y, width, height, palette.ink, 4);
  fill(context, accent, x + 4, y + 4, width - 8, 48);
  context.beginPath();
  context.moveTo(x + 4, y + 54);
  context.lineTo(x + width - 4, y + 54);
  context.strokeStyle = palette.ink;
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = palette.ink;
  context.font = `700 21px ${fontFamily}`;
  context.fillText(title, x + 18, y + 36);
  for (let index = 0; index < 3; index += 1) {
    const buttonX = x + width - 112 + index * 32;
    fill(context, palette.white, buttonX, y + 15, 20, 20);
    strokeBox(context, buttonX, y + 15, 20, 20, palette.ink, 2);
  }
}

function drawSticker(context, image, x, y, size, accent = palette.pink) {
  context.save();
  context.translate(x + size / 2, y + size / 2);
  context.rotate(-0.025);
  fill(context, palette.white, -size / 2 - 9, -size / 2 - 9, size + 18, size + 18);
  strokeBox(context, -size / 2 - 9, -size / 2 - 9, size + 18, size + 18, palette.ink, 3);
  context.drawImage(image, -size / 2, -size / 2, size, size);
  fill(context, accent, -34, -size / 2 - 17, 68, 22);
  context.globalAlpha = 0.55;
  fill(context, palette.white, -29, -size / 2 - 13, 58, 4);
  context.restore();
}

function drawRuleRow(context, index, text, y) {
  const colors = [palette.cyanPale, palette.pinkPale, palette.lilacPale, palette.cyanPale];
  fill(context, colors[index], 76, y, 666, 58);
  strokeBox(context, 76, y, 666, 58, palette.ink, 2);
  fill(context, index % 2 === 0 ? palette.cyan : palette.pink, 76, y, 58, 58);
  context.fillStyle = palette.ink;
  context.font = `700 20px ${fontFamily}`;
  context.fillText(String(index + 1).padStart(2, '0'), 91, y + 37);
  context.font = `600 24px ${fontFamily}`;
  context.fillText(text, 158, y + 38);
}

export async function renderLockCanvas(card, { avatarLoader = loadImage } = {}) {
  const canvas = createCanvas(1200, 675);
  const context = canvas.getContext('2d');
  const image = await loadImage(lockImagePath);
  const avatar = card.avatarUrl ? await avatarLoader(card.avatarUrl).catch(() => null) : null;

  drawGridPaper(context, canvas.width, canvas.height, 60);
  fill(context, palette.ink, 0, 0, canvas.width, 72);
  context.fillStyle = palette.white;
  context.font = `500 25px ${fontFamily}`;
  context.fillText('기숙사 봇  /  음악 신청', 54, 47);

  drawWindow(context, { x: 58, y: 112, width: 1084, height: 492, title: '이번 주 알림.txt' });
  fill(context, palette.pink, 95, 194, 82, 8);
  context.fillStyle = palette.ink;
  context.font = `700 52px ${fontFamily}`;
  context.fillText(card.title, 94, 274);
  if (card.applicant) {
    if (avatar) {
      context.save();
      context.beginPath();
      context.arc(126, 326, 32, 0, Math.PI * 2);
      context.clip();
      context.drawImage(avatar, 94, 294, 64, 64);
      context.restore();
      context.beginPath();
      context.arc(126, 326, 33, 0, Math.PI * 2);
      context.strokeStyle = palette.ink;
      context.lineWidth = 3;
      context.stroke();
    }
    context.font = `500 30px ${fontFamily}`;
    context.fillText(card.applicant, avatar ? 178 : 96, 334, avatar ? 508 : 590);
  }

  fill(context, palette.lilacPale, 94, 382, 610, 96);
  strokeBox(context, 94, 382, 610, 96, palette.ink, 3);
  fill(context, palette.lilac, 94, 382, 18, 96);
  context.fillStyle = palette.ink;
  context.font = `700 29px ${fontFamily}`;
  context.fillText(card.deleted, 138, 442);

  context.fillStyle = '#615b70';
  context.font = `500 21px ${fontFamily}`;
  context.fillText('신청 채널 공지', 96, 535);
  drawSticker(context, image, 800, 245, 245, palette.pink);
  return canvas.toBuffer('image/png');
}

export async function renderGuideCanvas() {
  const canvas = createCanvas(1200, 900);
  const context = canvas.getContext('2d');
  const image = await loadImage(guideImagePath);

  drawGridPaper(context, canvas.width, canvas.height, 60);
  fill(context, palette.ink, 0, 0, canvas.width, 76);
  context.fillStyle = palette.white;
  context.font = `500 25px ${fontFamily}`;
  context.fillText('기숙사 봇  /  신청 안내', 54, 49);

  fill(context, palette.pink, 62, 116, 78, 8);
  context.fillStyle = palette.ink;
  context.font = `700 49px ${fontFamily}`;
  context.fillText(GUIDE_COPY.title, 62, 187);
  context.fillStyle = '#686170';
  context.font = `500 24px ${fontFamily}`;
  context.fillText('신청 전에 아래 내용을 확인해주세요.', 64, 230);

  drawWindow(context, { x: 58, y: 270, width: 720, height: 390, title: '신청 규칙.txt' });
  GUIDE_COPY.rules.forEach((rule, index) => drawRuleRow(context, index, rule, 348 + index * 70));
  drawSticker(context, image, 875, 298, 205, palette.cyan);
  context.fillStyle = palette.ink;
  context.font = `600 21px ${fontFamily}`;
  context.fillText('미쿠 / 신청 도우미', 890, 548);

  drawWindow(context, { x: 58, y: 690, width: 1084, height: 166, title: '곡 정리 기준.txt', accent: palette.pink });
  context.fillStyle = palette.ink;
  context.font = `500 22px ${fontFamily}`;
  context.fillText(`· ${GUIDE_COPY.cleanup[0]}`, 86, 772);
  context.fillText(`· ${GUIDE_COPY.cleanup[1]}`, 86, 810);
  fill(context, palette.cyanPale, 600, 755, 504, 68);
  strokeBox(context, 600, 755, 504, 68, palette.ink, 2);
  context.fillStyle = palette.ink;
  context.font = `700 20px ${fontFamily}`;
  context.fillText(GUIDE_COPY.approval, 622, 797, 460);
  return canvas.toBuffer('image/png');
}
