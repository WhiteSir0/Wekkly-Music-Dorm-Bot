import { createCanvas } from '@napi-rs/canvas';
import { MAX_SONGS } from '../shared/constants.js';

const font = '"Noto Sans CJK KR", "Malgun Gothic", sans-serif';
const colors = { ink: '#292536', paper: '#fbfeff', grid: '#cceff1', cyan: '#85dce0', pink: '#f2a7c0', lilac: '#c8c1ee' };

function base(width, height, title, subtitle) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = colors.paper;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = colors.grid;
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += 48) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
  for (let y = 0; y <= height; y += 48) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
  context.fillStyle = colors.ink;
  context.fillRect(0, 0, width, 70);
  context.fillStyle = '#fff';
  context.font = `600 24px ${font}`;
  context.fillText('기숙사 봇 / 음악 신청', 42, 45);
  context.fillStyle = colors.pink;
  context.fillRect(54, 112, 72, 7);
  context.fillStyle = colors.ink;
  context.font = `700 45px ${font}`;
  context.fillText(title, 54, 174);
  context.fillStyle = '#686170';
  context.font = `500 21px ${font}`;
  context.fillText(subtitle, 56, 211);
  return { canvas, context };
}

function fitText(context, value, width) {
  if (context.measureText(value).width <= width) return value;
  const characters = [...value];
  while (characters.length && context.measureText(`${characters.join('')}…`).width > width) characters.pop();
  return `${characters.join('')}…`;
}

function requester(song) {
  return song.user_name || `사용자 ${String(song.user_id).slice(-6)}`;
}

export function renderDayPlaylistCanvas(day, songs, label = '이번 주') {
  const { canvas, context } = base(1400, 900, `${label} ${day}요일 플리`, `${songs.length} / ${MAX_SONGS[day]}곡`);
  context.fillStyle = '#fff';
  context.fillRect(54, 250, 1292, 590);
  context.strokeStyle = colors.ink;
  context.lineWidth = 3;
  context.strokeRect(54, 250, 1292, 590);
  context.font = `600 22px ${font}`;
  context.fillStyle = colors.ink;
  if (!songs.length) context.fillText('아직 신청된 곡이 없어요.', 88, 316);
  const split = Math.min(8, Math.ceil(songs.length / 2));
  songs.forEach((song, index) => {
    const column = index >= split ? 1 : 0;
    const row = index % split;
    const x = 88 + column * 630;
    const y = 310 + row * 66;
    context.fillStyle = row % 2 ? '#f1efff' : '#e1f8f8';
    context.fillRect(x, y - 29, 590, 56);
    context.fillStyle = colors.ink;
    context.fillText(`${index + 1}. ${fitText(context, song.title, 520)}`, x + 12, y - 3);
    context.fillStyle = '#686170';
    context.font = `500 17px ${font}`;
    context.fillText(fitText(context, `${song.artist || '가수 정보 없음'} · 신청자 ${requester(song)}`, 530), x + 42, y + 20);
    context.font = `600 22px ${font}`;
  });
  return canvas.toBuffer('image/png');
}
