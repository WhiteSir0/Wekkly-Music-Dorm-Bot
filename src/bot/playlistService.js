import { allowedDays, DAYS, MAX_DURATION_SECONDS, MAX_SONGS, MAX_WEEKLY_SONGS } from '../shared/constants.js';

export class PlaylistService {
  constructor(database, now = () => new Date()) {
    this.database = database;
    this.now = now;
  }

  validate(guildId, userId, day) {
    if (!DAYS.includes(day)) return { ok: false, message: '유효하지 않은 요일입니다.' };
    if (!allowedDays(this.now()).includes(day)) return { ok: false, message: '이미 지난 요일이거나 신청 시간이 마감됐습니다.' };
    const setting = this.database.setting(guildId, day);
    const exclusive = setting.locked && setting.exclusive_user_id === userId;
    if (setting.locked && !exclusive) return { ok: false, message: setting.exclusive_user_id ? '상점 사용 플리입니다.' : '이 요일 플레이리스트는 현재 잠겨 있습니다.' };
    if (this.database.dayCount(guildId, day) >= MAX_SONGS[day]) return { ok: false, message: '해당 요일 플레이리스트가 가득 찼습니다.' };
    if (!exclusive && this.database.userCount(guildId, userId) >= MAX_WEEKLY_SONGS) return { ok: false, message: '주간 신청 가능 횟수(2곡)를 모두 사용했습니다.' };
    return { ok: true };
  }

  register(guildId, userId, day, song, userName = null) {
    const validation = this.validate(guildId, userId, day);
    if (!validation.ok) return validation;
    if (song.durationSeconds && song.durationSeconds > MAX_DURATION_SECONDS) return { ok: false, message: '곡이 너무 길어요. 4분 30초 이내의 곡만 신청 가능합니다.' };
    if (this.database.hasVideo(guildId, song.videoId)) return { ok: false, message: '이번 주에는 같은 곡을 한 번만 신청할 수 있습니다.' };
    this.database.addSong(guildId, { ...song, day, userId, userName });
    return { ok: true, songs: this.database.daySongs(guildId, day) };
  }
}

export function songLabel(song) {
  return song.artist ? `${song.title} - ${song.artist}` : song.title;
}
