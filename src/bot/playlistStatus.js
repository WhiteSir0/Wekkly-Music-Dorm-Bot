import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { DAYS } from '../shared/constants.js';
import { renderDayPlaylistCanvas, renderWeeklyPlaylistCanvas } from './playlistCanvas.js';

export function weekKey(current) {
  const date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

export function weeklyStatusPayload(database) {
  return {
    files: [{ attachment: renderWeeklyPlaylistCanvas(database), name: 'weekly-playlist.png' }],
    components: [new ActionRowBuilder().addComponents(DAYS.map((day) => new ButtonBuilder()
      .setCustomId(`playlist:day:${day}`).setLabel(day).setStyle(ButtonStyle.Primary)))],
  };
}

export function dayStatusPayload(database, day) {
  const songs = database.daySongs(day);
  const payload = { files: [{ attachment: renderDayPlaylistCanvas(day, songs), name: `${day}-playlist.png` }], components: [] };
  if (songs.length) {
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

export function songDetailPayload(song) {
  const embed = new EmbedBuilder().setColor(0x85dce0).setTitle(song.title).setURL(song.url)
    .addFields({ name: '가수', value: song.artist || '정보 없음', inline: true }, { name: '신청자', value: `<@${song.user_id}>`, inline: true });
  return {
    embeds: [embed], files: [], attachments: [],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('유튜브에서 듣기').setURL(song.url).setStyle(ButtonStyle.Link),
      new ButtonBuilder().setCustomId(`playlist:report:${song.id}`).setLabel('신고하기').setStyle(ButtonStyle.Danger),
    )],
    allowedMentions: { parse: [] },
  };
}

export async function ensureWeeklyStatus({ client, database, guildId, key, forceEdit = false }) {
  const settings = database.guildChannels(guildId);
  if (!settings) return null;
  if (!forceEdit && settings.weekly_message_id && settings.weekly_message_key === key) return settings.weekly_message_id;
  const channel = await client.channels.fetch(settings.request_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return null;
  const payload = weeklyStatusPayload(database);
  let message = null;
  if (settings.weekly_message_id && settings.weekly_message_key === key) {
    message = await channel.messages?.fetch(settings.weekly_message_id).catch(() => null);
    if (message) await message.edit({ ...payload, attachments: [] });
  }
  if (!message) message = await channel.send(payload);
  database.setGuildWeeklyMessage(guildId, message.id, key);
  return message.id;
}
