import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { DAYS } from '../shared/constants.js';
import { renderDayPlaylistCanvas } from './playlistCanvas.js';

export function weekKey(current) {
  const date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

export function weekLabel(key) {
  const [, month, date] = key.split('-').map(Number);
  return `${month}월 ${Math.ceil(date / 7)}주차`;
}

export function dayStatusPayload(database, guildId, day, key = null) {
  const songs = key ? database.historyDaySongs(guildId, key, day) : database.daySongs(guildId, day);
  const label = key ? weekLabel(key) : '이번 주';
  const payload = { files: [{ attachment: renderDayPlaylistCanvas(day, songs, label), name: `${day}-playlist.png` }], components: [] };
  if (songs.length && !key) {
    const menu = new StringSelectMenuBuilder().setCustomId(`playlist:song:${day}`).setPlaceholder('곡 선택')
      .addOptions(songs.map((song, index) => ({
        label: `${index + 1}. ${song.title}`.slice(0, 100),
        description: `${song.artist || '가수 정보 없음'} · ${song.user_name || `사용자 ${String(song.user_id).slice(-6)}`}`.slice(0, 100),
        value: String(song.id),
      })));
    payload.components.push(new ActionRowBuilder().addComponents(menu));
  }
  return payload;
}

export function historyOverviewPayload(key) {
  return {
    content: `**${weekLabel(key)} 플리**`,
    components: [new ActionRowBuilder().addComponents(DAYS.map((day) => new ButtonBuilder()
      .setCustomId(`history:day:${key}:${day}`).setLabel(day).setStyle(ButtonStyle.Primary)))],
  };
}

export function historyDayStatusPayload(database, guildId, key, day) {
  const songs = database.historyDaySongs(guildId, key, day);
  const payload = {
    content: '',
    files: [{ attachment: renderDayPlaylistCanvas(day, songs, weekLabel(key)), name: `${day}-playlist.png` }],
    components: [],
  };
  if (songs.length) {
    const menu = new StringSelectMenuBuilder().setCustomId(`history:song:${key}:${day}`).setPlaceholder('곡 선택')
      .addOptions(songs.map((song, index) => ({
        label: `${index + 1}. ${song.title}`.slice(0, 100),
        description: `${song.artist || '가수 정보 없음'} · ${song.user_name || `사용자 ${String(song.user_id).slice(-6)}`}`.slice(0, 100),
        value: song.video_id,
      })));
    payload.components.push(new ActionRowBuilder().addComponents(menu));
  }
  return payload;
}

export function songDetailPayload(song, reportable = true) {
  const embed = new EmbedBuilder().setColor(0x85dce0).setTitle(song.title).setURL(song.url)
    .addFields(
      { name: '가수', value: song.artist || '정보 없음', inline: true },
      { name: '신청자', value: song.user_name || `<@${song.user_id}>`, inline: true },
    );
  const buttons = [new ButtonBuilder().setLabel('보기').setURL(song.url).setStyle(ButtonStyle.Link)];
  if (reportable) buttons.push(new ButtonBuilder().setCustomId(`playlist:report:${song.id}`).setLabel('신고하기').setStyle(ButtonStyle.Danger));
  return {
    embeds: [embed], files: [], attachments: [],
    components: [new ActionRowBuilder().addComponents(buttons)],
    allowedMentions: { parse: [] },
  };
}

export async function ensureWeeklyStatus({ client, database, guildId, key, forceEdit = false, day: changedDay = null }) {
  const settings = database.guildChannels(guildId);
  if (!settings) return null;
  let messageIds = {};
  try { messageIds = JSON.parse(settings.day_message_ids || '{}'); } catch { messageIds = {}; }
  if (!forceEdit && !settings.weekly_message_id
    && settings.weekly_message_key === key && DAYS.every((day) => messageIds[day])) return messageIds;
  const channel = await client.channels.fetch(settings.request_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return null;
  const legacyMessage = settings.weekly_message_id
    ? await channel.messages?.fetch(settings.weekly_message_id).catch(() => null)
    : null;
  for (const day of DAYS) {
    if (forceEdit && changedDay && settings.weekly_message_key === key && day !== changedDay) continue;
    const payload = dayStatusPayload(database, guildId, day);
    let message = messageIds[day] ? await channel.messages?.fetch(messageIds[day]).catch(() => null) : null;
    if (message) await message.edit({ ...payload, attachments: [] });
    else {
      message = await channel.send(payload);
      messageIds[day] = message.id;
      database.setGuildDayMessageIds(guildId, messageIds);
    }
  }
  database.setGuildDayMessages(guildId, messageIds, key);
  if (legacyMessage) {
    await legacyMessage.delete();
    database.clearGuildWeeklyMessage(guildId);
  }
  return messageIds;
}

export async function deleteStoredStatusMessages(client, settings) {
  if (!settings?.request_channel_id) return;
  const channel = await client.channels.fetch(settings.request_channel_id);
  if (!channel?.isTextBased()) throw new Error('기존 신청 채널을 찾지 못했습니다.');
  let dayMessageIds = {};
  try { dayMessageIds = JSON.parse(settings.day_message_ids || '{}'); } catch { dayMessageIds = {}; }
  const ids = new Set([settings.weekly_message_id, ...Object.values(dayMessageIds)].filter(Boolean));
  for (const id of ids) {
    let message;
    try {
      message = await channel.messages?.fetch(id);
    } catch (error) {
      if (error?.code === 10008) continue;
      throw error;
    }
    await message?.delete();
  }
}
