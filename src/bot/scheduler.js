import { kstDate, kstNow } from '../shared/constants.js';
import { listEmbed } from './commands.js';

function sundayKey(current) {
  const date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

export class Scheduler {
  constructor({ client, database, requestChannelId, announcementChannelId, now = () => new Date() }) {
    this.client = client;
    this.database = database;
    this.requestChannelId = requestChannelId;
    this.announcementChannelId = announcementChannelId;
    this.now = now;
  }

  start() {
    this.run().catch(console.error);
    this.timer = setInterval(() => this.run().catch(console.error), 60_000);
    return this.timer;
  }

  async run() {
    const current = kstNow(this.now());
    await this.resetIfNeeded(current);
    await this.closeIfNeeded(current);
  }

  async resetIfNeeded(current) {
    if (current.getUTCDay() !== 0 || current.getUTCHours() < 9) return;
    const key = sundayKey(current);
    if (this.database.meta('last_weekly_reset') === key) return;
    this.database.resetWeekly();
    this.database.setMeta('last_weekly_reset', key);
  }

  async closeIfNeeded(current) {
    if (current.getUTCHours() !== 23 || current.getUTCMinutes() < 40) return;
    const targets = { 0: '월', 1: '화', 2: '수', 3: '목', 4: '금' };
    const day = targets[current.getUTCDay()];
    if (!day) return;
    const key = `${kstDate(this.now())}:${day}`;
    if (this.database.meta('last_close') === key) return;
    const songs = this.database.daySongs(day);
    if (!songs.length) return;
    const setting = this.database.setting(day);
    const exclusiveUserId = setting.locked ? setting.exclusive_user_id : null;
    const requestKey = `${key}:request`;
    const announcementKey = `${key}:announcement`;
    if (exclusiveUserId && this.announcementChannelId) {
      const channel = await this.client.channels.fetch(this.announcementChannelId).catch(() => null);
      if (channel?.isTextBased() && this.database.meta(announcementKey) !== 'sent') {
        await channel.send({ content: `<@${exclusiveUserId}> 상점 플리입니다.`, embeds: [listEmbed(day, songs)] });
        this.database.setMeta(announcementKey, 'sent');
      }
    } else if (this.requestChannelId && this.announcementChannelId) {
      const request = await this.client.channels.fetch(this.requestChannelId).catch(() => null);
      const announcement = await this.client.channels.fetch(this.announcementChannelId).catch(() => null);
      if (request?.isTextBased() && announcement?.isTextBased()) {
        const payload = { embeds: [listEmbed(day, songs, true)] };
        if (this.database.meta(requestKey) !== 'sent') {
          await request.send(payload);
          this.database.setMeta(requestKey, 'sent');
        }
        if (this.requestChannelId === this.announcementChannelId) {
          this.database.setMeta(announcementKey, 'sent');
        } else if (this.database.meta(announcementKey) !== 'sent') {
          await announcement.send(payload);
          this.database.setMeta(announcementKey, 'sent');
        }
      }
    }
    if (this.database.meta(announcementKey) === 'sent'
      && (exclusiveUserId || this.database.meta(requestKey) === 'sent')) this.database.setMeta('last_close', key);
  }
}
