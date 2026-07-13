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
        guild_id TEXT NOT NULL,
        day TEXT NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        url TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS day_settings (
        guild_id TEXT NOT NULL,
        day TEXT NOT NULL,
        locked INTEGER NOT NULL DEFAULT 0,
        exclusive_user_id TEXT,
        PRIMARY KEY (guild_id, day)
      );
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        request_channel_id TEXT NOT NULL,
        announcement_channel_id TEXT NOT NULL,
        report_channel_id TEXT,
        guide_message_id TEXT,
        weekly_message_id TEXT,
        weekly_message_key TEXT
      );
      CREATE TABLE IF NOT EXISTS playlist_history (
        guild_id TEXT NOT NULL,
        week_key TEXT NOT NULL,
        day TEXT NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        url TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT,
        position INTEGER NOT NULL,
        PRIMARY KEY (guild_id, week_key, video_id)
      );
      CREATE TABLE IF NOT EXISTS meta (
        guild_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (guild_id, key)
      );
    `);
    const guildColumns = this.db.prepare('PRAGMA table_info(guild_settings)').all();
    const playlistColumns = this.db.prepare('PRAGMA table_info(playlists)').all();
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
    if (!guildColumns.some(({ name }) => name === 'report_channel_id')) {
      this.db.exec('ALTER TABLE guild_settings ADD COLUMN report_channel_id TEXT');
    }
    if (!playlistColumns.some(({ name }) => name === 'guild_id')) this.migrateLegacyTables();
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS playlists_guild_video ON playlists(guild_id, video_id);
      CREATE INDEX IF NOT EXISTS playlists_guild_day ON playlists(guild_id, day);
      CREATE INDEX IF NOT EXISTS playlist_history_guild_week_day ON playlist_history(guild_id, week_key, day, position);
    `);
  }

  migrateLegacyTables() {
    const guildId = this.db.prepare('SELECT guild_id FROM guild_settings ORDER BY rowid LIMIT 1').get()?.guild_id ?? '__legacy__';
    this.db.exec(`
      BEGIN;
      ALTER TABLE playlists RENAME TO playlists_legacy;
      ALTER TABLE day_settings RENAME TO day_settings_legacy;
      ALTER TABLE playlist_history RENAME TO playlist_history_legacy;
      ALTER TABLE meta RENAME TO meta_legacy;
      CREATE TABLE playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, day TEXT NOT NULL,
        video_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT, url TEXT NOT NULL,
        user_id TEXT NOT NULL, user_name TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE day_settings (
        guild_id TEXT NOT NULL, day TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0,
        exclusive_user_id TEXT, PRIMARY KEY (guild_id, day)
      );
      CREATE TABLE playlist_history (
        guild_id TEXT NOT NULL, week_key TEXT NOT NULL, day TEXT NOT NULL, video_id TEXT NOT NULL,
        title TEXT NOT NULL, artist TEXT, url TEXT NOT NULL, user_id TEXT NOT NULL,
        user_name TEXT, position INTEGER NOT NULL, PRIMARY KEY (guild_id, week_key, video_id)
      );
      CREATE TABLE meta (
        guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY (guild_id, key)
      );
    `);
    try {
      this.db.prepare(`INSERT INTO playlists
        SELECT id, ?, day, video_id, title, artist, url, user_id, user_name, created_at FROM playlists_legacy`).run(guildId);
      this.db.prepare(`INSERT INTO day_settings
        SELECT ?, day, locked, exclusive_user_id FROM day_settings_legacy`).run(guildId);
      this.db.prepare(`INSERT INTO playlist_history
        SELECT ?, week_key, day, video_id, title, artist, url, user_id, user_name, position FROM playlist_history_legacy`).run(guildId);
      this.db.prepare('INSERT INTO meta SELECT ?, key, value FROM meta_legacy').run(guildId);
      this.db.exec('DROP TABLE playlists_legacy; DROP TABLE day_settings_legacy; DROP TABLE playlist_history_legacy; DROP TABLE meta_legacy; COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  daySongs(guildId, day) {
    return this.db.prepare('SELECT * FROM playlists WHERE guild_id=? AND day=? ORDER BY id').all(guildId, day);
  }

  songsWithoutUserName() {
    return this.db.prepare('SELECT guild_id, id, user_id FROM playlists WHERE user_name IS NULL').all();
  }

  setSongUserName(guildId, id, userName) {
    this.db.prepare('UPDATE playlists SET user_name=? WHERE guild_id=? AND id=?').run(userName, guildId, id);
  }

  historyDaySongs(guildId, key, day) {
    return this.db.prepare('SELECT * FROM playlist_history WHERE guild_id=? AND week_key=? AND day=? ORDER BY position').all(guildId, key, day);
  }

  historySong(guildId, key, videoId) {
    return this.db.prepare('SELECT * FROM playlist_history WHERE guild_id=? AND week_key=? AND video_id=?').get(guildId, key, videoId) ?? null;
  }

  historyWeeks(guildId) {
    return this.db.prepare('SELECT DISTINCT week_key FROM playlist_history WHERE guild_id=? ORDER BY week_key DESC').all(guildId)
      .map(({ week_key: key }) => key);
  }

  archiveWeek(guildId, key) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO playlist_history(
        guild_id, week_key, day, video_id, title, artist, url, user_id, user_name, position
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec('BEGIN');
    try {
      for (const day of DAYS) {
        this.daySongs(guildId, day).forEach((song, index) => {
          insert.run(guildId, key, day, song.video_id, song.title, song.artist, song.url, song.user_id, song.user_name, index + 1);
        });
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  song(guildId, id) {
    return this.db.prepare('SELECT * FROM playlists WHERE guild_id=? AND id=?').get(guildId, id) ?? null;
  }

  dayCount(guildId, day) {
    return Number(this.db.prepare('SELECT COUNT(*) count FROM playlists WHERE guild_id=? AND day=?').get(guildId, day).count);
  }

  userCount(guildId, userId) {
    return Number(this.db.prepare('SELECT COUNT(*) count FROM playlists WHERE guild_id=? AND user_id=?').get(guildId, userId).count);
  }

  setting(guildId, day) {
    this.db.prepare('INSERT OR IGNORE INTO day_settings(guild_id,day) VALUES (?,?)').run(guildId, day);
    return this.db.prepare('SELECT day, locked, exclusive_user_id FROM day_settings WHERE guild_id=? AND day=?').get(guildId, day);
  }

  addSong(guildId, song) {
    return this.db.prepare('INSERT INTO playlists(guild_id,day,video_id,title,artist,url,user_id,user_name) VALUES (?,?,?,?,?,?,?,?)')
      .run(guildId, song.day, song.videoId, song.title, song.artist, song.url, song.userId, song.userName ?? null);
  }

  hasVideo(guildId, videoId) {
    return Boolean(this.db.prepare('SELECT 1 FROM playlists WHERE guild_id=? AND video_id=?').get(guildId, videoId));
  }

  deleteSong(guildId, day, position) {
    const song = this.daySongs(guildId, day)[position - 1];
    if (!song) return null;
    this.db.prepare('DELETE FROM playlists WHERE guild_id=? AND id=?').run(guildId, song.id);
    return song;
  }

  deleteSongById(guildId, id) {
    const song = this.song(guildId, id);
    if (!song) return null;
    this.db.prepare('DELETE FROM playlists WHERE guild_id=? AND id=?').run(guildId, id);
    return song;
  }

  setLock(guildId, day, locked, userId = null) {
    this.setting(guildId, day);
    this.db.prepare('UPDATE day_settings SET locked=?, exclusive_user_id=? WHERE guild_id=? AND day=?').run(locked ? 1 : 0, userId, guildId, day);
    if (!locked) return 0;
    return Number(this.db.prepare('DELETE FROM playlists WHERE guild_id=? AND day=?').run(guildId, day).changes);
  }

  guildChannels(guildId) {
    return this.db.prepare(`
      SELECT guild_id, request_channel_id, announcement_channel_id, guide_message_id,
             weekly_message_id, weekly_message_key, day_message_ids, report_channel_id
      FROM guild_settings WHERE guild_id=?
    `).get(guildId) ?? null;
  }

  setGuildChannels(guildId, requestChannelId, announcementChannelId, reportChannelId = announcementChannelId) {
    this.db.prepare(`
      INSERT INTO guild_settings(guild_id, request_channel_id, announcement_channel_id, report_channel_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        request_channel_id=excluded.request_channel_id,
        announcement_channel_id=excluded.announcement_channel_id,
        report_channel_id=excluded.report_channel_id
    `).run(guildId, requestChannelId, announcementChannelId, reportChannelId);
  }

  setGuildGuideMessage(guildId, messageId) {
    this.db.prepare('UPDATE guild_settings SET guide_message_id=? WHERE guild_id=?').run(messageId, guildId);
  }

  setGuildWeeklyMessage(guildId, messageId, key) {
    this.db.prepare('UPDATE guild_settings SET weekly_message_id=?, weekly_message_key=? WHERE guild_id=?')
      .run(messageId, key, guildId);
  }

  setGuildDayMessages(guildId, messageIds, key) {
    this.db.prepare('UPDATE guild_settings SET day_message_ids=?, weekly_message_key=? WHERE guild_id=?')
      .run(JSON.stringify(messageIds), key, guildId);
  }

  setGuildDayMessageIds(guildId, messageIds) {
    this.db.prepare('UPDATE guild_settings SET day_message_ids=? WHERE guild_id=?')
      .run(JSON.stringify(messageIds), guildId);
  }

  clearGuildWeeklyMessage(guildId) {
    this.db.prepare('UPDATE guild_settings SET weekly_message_id=NULL WHERE guild_id=?').run(guildId);
  }

  resetWeekly(guildId) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM playlists WHERE guild_id=?').run(guildId);
      this.db.prepare('UPDATE day_settings SET locked=0, exclusive_user_id=NULL WHERE guild_id=?').run(guildId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  clearAll(guildId) {
    this.resetWeekly(guildId);
    this.db.prepare('DELETE FROM meta WHERE guild_id=?').run(guildId);
    this.db.prepare('DELETE FROM playlist_history WHERE guild_id=?').run(guildId);
  }

  meta(guildId, key) {
    return this.db.prepare('SELECT value FROM meta WHERE guild_id=? AND key=?').get(guildId, key)?.value ?? null;
  }

  setMeta(guildId, key, value) {
    this.db.prepare('INSERT INTO meta(guild_id,key,value) VALUES (?,?,?) ON CONFLICT(guild_id,key) DO UPDATE SET value=excluded.value').run(guildId, key, value);
  }

  claimMeta(guildId, key, value, staleBefore) {
    return this.db.prepare(`
      INSERT INTO meta(guild_id,key,value) VALUES (?,?,?)
      ON CONFLICT(guild_id,key) DO UPDATE SET value=excluded.value
      WHERE meta.value LIKE 'processing:%'
        AND CAST(substr(meta.value, 12, 13) AS INTEGER) < ?
    `).run(guildId, key, value, staleBefore).changes === 1;
  }

  clearMeta(guildId, key, value) {
    this.db.prepare('DELETE FROM meta WHERE guild_id=? AND key=? AND value=?').run(guildId, key, value);
  }

  clearGuild(guildId) {
    this.db.exec('BEGIN');
    try {
      for (const table of ['playlists', 'day_settings', 'playlist_history', 'meta', 'guild_settings']) {
        this.db.prepare(`DELETE FROM ${table} WHERE guild_id=?`).run(guildId);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}
