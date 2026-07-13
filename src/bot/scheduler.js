import { kstDate, kstNow } from '../shared/constants.js';
import { listEmbed } from './commands.js';
import { ensureWeeklyStatus, weekKey } from './playlistStatus.js';

export class Scheduler {
  constructor({ client, database, guildIds, fallbackChannels = null, now = () => new Date() }) {
    this.client = client;
    this.database = database;
    this.guildIds = guildIds;
    this.fallbackChannels = fallbackChannels;
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
    await this.ensureStatus(current);
    await this.closeIfNeeded(current);
  }

  async resetIfNeeded(current) {
    if (current.getUTCDay() === 6 || (current.getUTCDay() === 0 && current.getUTCHours() < 9)) return;
    const key = weekKey(current);
    for (const guildId of this.guildIds) {
      if (this.database.meta(guildId, 'last_weekly_reset') === key) continue;
      const previousKey = this.database.meta(guildId, 'last_weekly_reset')
        ?? weekKey(new Date(current.getTime() - 7 * 24 * 60 * 60_000));
      this.database.archiveWeek(guildId, previousKey);
      this.database.resetWeekly(guildId);
      this.database.setMeta(guildId, 'last_weekly_reset', key);
    }
  }

  async ensureStatus(current) {
    const day = current.getUTCDay();
    if (day === 6 || (day === 0 && current.getUTCHours() < 9)) return;
    const key = weekKey(current);
    for (const guildId of this.guildIds) {
      await ensureWeeklyStatus({ client: this.client, database: this.database, guildId, key });
    }
  }

  async closeIfNeeded(current) {
    if (current.getUTCHours() !== 23 || current.getUTCMinutes() < 40) return;
    const targets = { 0: '월', 1: '화', 2: '수', 3: '목', 4: '금' };
    const day = targets[current.getUTCDay()];
    if (!day) return;
    const key = `${kstDate(this.now())}:${day}`;
    for (const guildId of this.guildIds) {
      const songs = this.database.daySongs(guildId, day);
      if (!songs.length) continue;
      const setting = this.database.setting(guildId, day);
      const exclusiveUserId = setting.locked ? setting.exclusive_user_id : null;
      const channels = this.database.guildChannels(guildId) ?? this.fallbackChannels;
      if (channels) await this.closeGuild({ guildId, channels, key, day, songs, exclusiveUserId });
    }
  }

  async closeGuild({ guildId, channels, key, day, songs, exclusiveUserId }) {
    const lastCloseKey = `last_close:${guildId}`;
    if (this.database.meta(guildId, lastCloseKey) === key) return;
    const requestKey = `${key}:${guildId}:request`;
    const announcementKey = `${key}:${guildId}:announcement`;
    if (exclusiveUserId) {
      const channel = await this.client.channels.fetch(channels.announcement_channel_id).catch(() => null);
      if (channel?.isTextBased() && this.database.meta(guildId, announcementKey) !== 'sent') {
        await channel.send({ content: `<@${exclusiveUserId}> 상점 플리입니다.`, embeds: [listEmbed(day, songs)] });
        this.database.setMeta(guildId, announcementKey, 'sent');
      }
    } else {
      const request = await this.client.channels.fetch(channels.request_channel_id).catch(() => null);
      const announcement = await this.client.channels.fetch(channels.announcement_channel_id).catch(() => null);
      if (request?.isTextBased() && announcement?.isTextBased()) {
        const payload = { embeds: [listEmbed(day, songs, true)] };
        if (this.database.meta(guildId, requestKey) !== 'sent') {
          await request.send(payload);
          this.database.setMeta(guildId, requestKey, 'sent');
        }
        if (channels.request_channel_id === channels.announcement_channel_id) {
          this.database.setMeta(guildId, announcementKey, 'sent');
        } else if (this.database.meta(guildId, announcementKey) !== 'sent') {
          await announcement.send(payload);
          this.database.setMeta(guildId, announcementKey, 'sent');
        }
      }
    }
    if (this.database.meta(guildId, announcementKey) === 'sent'
      && (exclusiveUserId || this.database.meta(guildId, requestKey) === 'sent')) this.database.setMeta(guildId, lastCloseKey, key);
  }
}
