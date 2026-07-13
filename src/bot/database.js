import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DAYS } from '../shared/constants.js';

export class MusicDatabase {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        url TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS playlists_video_id ON playlists(video_id);
      CREATE INDEX IF NOT EXISTS playlists_day ON playlists(day);
      CREATE TABLE IF NOT EXISTS day_settings (
        day TEXT PRIMARY KEY,
        locked INTEGER NOT NULL DEFAULT 0,
        exclusive_user_id TEXT
      );
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        request_channel_id TEXT NOT NULL,
        announcement_channel_id TEXT NOT NULL,
        guide_message_id TEXT,
        weekly_message_id TEXT,
        weekly_message_key TEXT
      );
      CREATE TABLE IF NOT EXISTS playlist_history (
        week_key TEXT NOT NULL,
        day TEXT NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        url TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT,
        position INTEGER NOT NULL,
        PRIMARY KEY (week_key, video_id)
      );
      CREATE INDEX IF NOT EXISTS playlist_history_week_day ON playlist_history(week_key, day, position);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const guildColumns = this.db.prepare('PRAGMA table_info(guild_settings)').all();
    const playlistColumns = this.db.prepare('PRAGMA table_info(playlists)').all();
    if (!playlistColumns.some(({ name }) => name === 'user_name')) {
      this.db.exec('ALTER TABLE playlists ADD COLUMN user_name TEXT');
    }
    if (!guildColumns.some(({ name }) => name === 'guide_message_id')) {
      this.db.exec('ALTER TABLE guild_settings ADD COLUMN guide_message_id TEXT');
    }
    if (!guildColumns.some(({ name }) => name === 'weekly_message_id')) {
      this.db.exec('ALTER TABLE guild_settings ADD COLUMN weekly_message_id TEXT');
    }
    if (!guildColumns.some(({ name }) => name === 'weekly_message_key')) {
      this.db.exec('ALTER TABLE guild_settings ADD COLUMN weekly_message_key TEXT');
    }
    if (!guildColumns.some(({ name }) => name === 'day_message_ids')) {
      this.db.exec("ALTER TABLE guild_settings ADD COLUMN day_message_ids TEXT NOT NULL DEFAULT '{}'");
    }
    const insertDay = this.db.prepare('INSERT OR IGNORE INTO day_settings(day) VALUES (?)');
    for (const day of DAYS) insertDay.run(day);
  }

  daySongs(day) {
    return this.db.prepare('SELECT * FROM playlists WHERE day=? ORDER BY id').all(day);
  }

  songsWithoutUserName() {
    return this.db.prepare('SELECT id, user_id FROM playlists WHERE user_name IS NULL').all();
  }

  setSongUserName(id, userName) {
    this.db.prepare('UPDATE playlists SET user_name=? WHERE id=?').run(userName, id);
  }

  historyDaySongs(key, day) {
    return this.db.prepare('SELECT * FROM playlist_history WHERE week_key=? AND day=? ORDER BY position').all(key, day);
  }

  historySong(key, videoId) {
    return this.db.prepare('SELECT * FROM playlist_history WHERE week_key=? AND video_id=?').get(key, videoId) ?? null;
  }

  historyWeeks() {
    return this.db.prepare('SELECT DISTINCT week_key FROM playlist_history ORDER BY week_key DESC').all()
      .map(({ week_key: key }) => key);
  }

  archiveWeek(key) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO playlist_history(
        week_key, day, video_id, title, artist, url, user_id, user_name, position
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec('BEGIN');
    try {
      for (const day of DAYS) {
        this.daySongs(day).forEach((song, index) => {
          insert.run(key, day, song.video_id, song.title, song.artist, song.url, song.user_id, song.user_name, index + 1);
        });
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  song(id) {
    return this.db.prepare('SELECT * FROM playlists WHERE id=?').get(id) ?? null;
  }

  dayCount(day) {
    return Number(this.db.prepare('SELECT COUNT(*) count FROM playlists WHERE day=?').get(day).count);
  }

  userCount(userId) {
    return Number(this.db.prepare('SELECT COUNT(*) count FROM playlists WHERE user_id=?').get(userId).count);
  }

  setting(day) {
    return this.db.prepare('SELECT day, locked, exclusive_user_id FROM day_settings WHERE day=?').get(day);
  }

  addSong(song) {
    return this.db.prepare('INSERT INTO playlists(day,video_id,title,artist,url,user_id,user_name) VALUES (?,?,?,?,?,?,?)')
      .run(song.day, song.videoId, song.title, song.artist, song.url, song.userId, song.userName ?? null);
  }

  hasVideo(videoId) {
    return Boolean(this.db.prepare('SELECT 1 FROM playlists WHERE video_id=?').get(videoId));
  }

  deleteSong(day, position) {
    const song = this.daySongs(day)[position - 1];
    if (!song) return null;
    this.db.prepare('DELETE FROM playlists WHERE id=?').run(song.id);
    return song;
  }

  setLock(day, locked, userId = null) {
    this.db.prepare('UPDATE day_settings SET locked=?, exclusive_user_id=? WHERE day=?').run(locked ? 1 : 0, userId, day);
    if (!locked) return 0;
    return Number(this.db.prepare('DELETE FROM playlists WHERE day=?').run(day).changes);
  }

  guildChannels(guildId) {
    return this.db.prepare(`
      SELECT guild_id, request_channel_id, announcement_channel_id, guide_message_id,
             weekly_message_id, weekly_message_key, day_message_ids
      FROM guild_settings WHERE guild_id=?
    `).get(guildId) ?? null;
  }

  setGuildChannels(guildId, requestChannelId, announcementChannelId) {
    this.db.prepare(`
      INSERT INTO guild_settings(guild_id, request_channel_id, announcement_channel_id)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        request_channel_id=excluded.request_channel_id,
        announcement_channel_id=excluded.announcement_channel_id
    `).run(guildId, requestChannelId, announcementChannelId);
  }

  setGuildGuideMessage(guildId, messageId) {
    this.db.prepare('UPDATE guild_settings SET guide_message_id=? WHERE guild_id=?').run(messageId, guildId);
  }

  setGuildWeeklyMessage(guildId, messageId, key) {
    this.db.prepare('UPDATE guild_settings SET weekly_message_id=?, weekly_message_key=? WHERE guild_id=?')
      .run(messageId, key, guildId);
  }

  setGuildDayMessages(guildId, messageIds, key) {
    this.db.prepare('UPDATE guild_settings SET day_message_ids=?, weekly_message_key=?, weekly_message_id=NULL WHERE guild_id=?')
      .run(JSON.stringify(messageIds), key, guildId);
  }

  resetWeekly() {
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM playlists; UPDATE day_settings SET locked=0, exclusive_user_id=NULL;');
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  clearAll() {
    this.resetWeekly();
    this.db.exec('DELETE FROM meta; DELETE FROM playlist_history');
  }

  meta(key) {
    return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value ?? null;
  }

  setMeta(key, value) {
    this.db.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }

  close() {
    this.db.close();
  }
}
