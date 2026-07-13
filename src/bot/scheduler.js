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
    if (this.database.meta('last_weekly_reset') === key) return;
    const previousKey = this.database.meta('last_weekly_reset')
      ?? weekKey(new Date(current.getTime() - 7 * 24 * 60 * 60_000));
    this.database.archiveWeek(previousKey);
    this.database.resetWeekly();
    this.database.setMeta('last_weekly_reset', key);
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
    const songs = this.database.daySongs(day);
    if (!songs.length) return;
    const setting = this.database.setting(day);
    const exclusiveUserId = setting.locked ? setting.exclusive_user_id : null;
    for (const guildId of this.guildIds) {
      const channels = this.database.guildChannels(guildId) ?? this.fallbackChannels;
      if (channels) await this.closeGuild({ guildId, channels, key, day, songs, exclusiveUserId });
    }
  }

  async closeGuild({ guildId, channels, key, day, songs, exclusiveUserId }) {
    const lastCloseKey = `last_close:${guildId}`;
    if (this.database.meta(lastCloseKey) === key) return;
    const requestKey = `${key}:${guildId}:request`;
    const announcementKey = `${key}:${guildId}:announcement`;
    if (exclusiveUserId) {
      const channel = await this.client.channels.fetch(channels.announcement_channel_id).catch(() => null);
      if (channel?.isTextBased() && this.database.meta(announcementKey) !== 'sent') {
        await channel.send({ content: `<@${exclusiveUserId}> 상점 플리입니다.`, embeds: [listEmbed(day, songs)] });
        this.database.setMeta(announcementKey, 'sent');
      }
    } else {
      const request = await this.client.channels.fetch(channels.request_channel_id).catch(() => null);
      const announcement = await this.client.channels.fetch(channels.announcement_channel_id).catch(() => null);
      if (request?.isTextBased() && announcement?.isTextBased()) {
        const payload = { embeds: [listEmbed(day, songs, true)] };
        if (this.database.meta(requestKey) !== 'sent') {
          await request.send(payload);
          this.database.setMeta(requestKey, 'sent');
        }
        if (channels.request_channel_id === channels.announcement_channel_id) {
          this.database.setMeta(announcementKey, 'sent');
        } else if (this.database.meta(announcementKey) !== 'sent') {
          await announcement.send(payload);
          this.database.setMeta(announcementKey, 'sent');
        }
      }
    }
    if (this.database.meta(announcementKey) === 'sent'
      && (exclusiveUserId || this.database.meta(requestKey) === 'sent')) this.database.setMeta(lastCloseKey, key);
  }
}
