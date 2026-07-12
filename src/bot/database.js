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
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS playlists_video_id ON playlists(video_id);
      CREATE INDEX IF NOT EXISTS playlists_day ON playlists(day);
      CREATE TABLE IF NOT EXISTS day_settings (
        day TEXT PRIMARY KEY,
        locked INTEGER NOT NULL DEFAULT 0,
        exclusive_user_id TEXT
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const insertDay = this.db.prepare('INSERT OR IGNORE INTO day_settings(day) VALUES (?)');
    for (const day of DAYS) insertDay.run(day);
  }

  daySongs(day) {
    return this.db.prepare('SELECT * FROM playlists WHERE day=? ORDER BY id').all(day);
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
    return this.db.prepare('INSERT INTO playlists(day,video_id,title,artist,url,user_id) VALUES (?,?,?,?,?,?)')
      .run(song.day, song.videoId, song.title, song.artist, song.url, song.userId);
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
    if (locked) this.db.prepare('DELETE FROM playlists WHERE day=?').run(day);
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
    this.db.exec('DELETE FROM meta');
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
