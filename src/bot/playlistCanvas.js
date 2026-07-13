import { createCanvas } from '@napi-rs/canvas';
import { DAYS, MAX_SONGS } from '../shared/constants.js';

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

function shorten(value, size) {
  return value.length > size ? `${value.slice(0, size - 1)}…` : value;
}

function requester(song) {
  return song.user_name || `사용자 ${String(song.user_id).slice(-6)}`;
}

export function renderWeeklyPlaylistCanvas(database) {
  const { canvas, context } = base(1400, 788, '이번 주 플레이리스트', '요일을 누르면 곡과 신청자를 자세히 볼 수 있어요.');
  const width = 246;
  DAYS.forEach((day, index) => {
    const songs = database.daySongs(day);
    const x = 54 + index * 266;
    context.fillStyle = index % 2 ? '#fff0f6' : '#e1f8f8';
    context.fillRect(x, 256, width, 446);
    context.strokeStyle = colors.ink;
    context.lineWidth = 3;
    context.strokeRect(x, 256, width, 446);
    context.fillStyle = index % 2 ? colors.pink : colors.cyan;
    context.fillRect(x, 256, width, 62);
    context.fillStyle = colors.ink;
    context.font = `700 25px ${font}`;
    context.fillText(`${day}요일`, x + 18, 296);
    context.font = `600 18px ${font}`;
    context.fillText(`${songs.length} / ${MAX_SONGS[day]}곡`, x + 18, 348);
    context.font = `600 17px ${font}`;
    songs.slice(0, 5).forEach((song, songIndex) => {
      const y = 388 + songIndex * 65;
      context.fillText(`${songIndex + 1}. ${shorten(song.title, 18)}`, x + 18, y);
      context.fillStyle = '#686170';
      context.font = `500 15px ${font}`;
      context.fillText(`${shorten(song.artist || '가수 정보 없음', 15)} · ${shorten(requester(song), 11)}`, x + 18, y + 25);
      context.fillStyle = colors.ink;
      context.font = `600 17px ${font}`;
    });
    if (!songs.length) context.fillText('아직 신청곡 없음', x + 18, 392);
  });
  return canvas.toBuffer('image/png');
}

export function renderDayPlaylistCanvas(day, songs) {
  const { canvas, context } = base(1400, 900, `${day}요일 신청곡`, `${songs.length} / ${MAX_SONGS[day]}곡 · 곡을 선택하면 링크와 신청자를 확인할 수 있어요.`);
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
    context.fillText(`${index + 1}. ${shorten(song.title, 34)}`, x + 12, y - 3);
    context.fillStyle = '#686170';
    context.font = `500 17px ${font}`;
    context.fillText(`${shorten(song.artist || '가수 정보 없음', 28)} · 신청자 ${shorten(requester(song), 18)}`, x + 42, y + 20);
    context.font = `600 22px ${font}`;
  });
  return canvas.toBuffer('image/png');
}
