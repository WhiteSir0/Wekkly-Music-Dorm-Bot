import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { songLabel } from './playlistService.js';

export async function showReportModal(interaction) {
  const songId = interaction.customId.split(':')[2];
  const modal = new ModalBuilder().setCustomId(`playlist:report:${songId}`).setTitle('신청곡 신고');
  const reason = new TextInputBuilder().setCustomId('reason').setLabel('사유').setStyle(TextInputStyle.Paragraph)
    .setRequired(true).setMaxLength(500);
  modal.addComponents(new ActionRowBuilder().addComponents(reason));
  await interaction.showModal(modal);
}

export async function submitReport(database, interaction) {
  const song = database.song(interaction.guildId, Number(interaction.customId.split(':')[2]));
  const channels = database.guildChannels(interaction.guildId);
  if (!song || !channels) {
    await interaction.reply({ content: '신고할 곡을 찾지 못했습니다.', flags: MessageFlags.Ephemeral });
    return;
  }
  const channel = await interaction.client.channels.fetch(channels.report_channel_id ?? channels.announcement_channel_id).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: '신고 채널을 찾지 못했습니다.', flags: MessageFlags.Ephemeral });
    return;
  }
  const embed = new EmbedBuilder().setColor(0xed4245).setTitle('신청곡 신고')
    .addFields(
      { name: '곡', value: `[${songLabel(song)}](${song.url})` },
      { name: '신청자', value: `<@${song.user_id}>`, inline: true },
      { name: '신고자', value: `<@${interaction.user.id}>`, inline: true },
      { name: '요일', value: song.day, inline: true },
      { name: '사유', value: interaction.fields.getTextInputValue('reason') },
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`report:delete:${song.id}`).setLabel('삭제 처리').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`report:reject:${song.id}`).setLabel('기각').setStyle(ButtonStyle.Secondary),
  );
  await channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
  await interaction.reply({ content: '신고했습니다.', flags: MessageFlags.Ephemeral });
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

export async function showResolutionModal(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '관리자 권한이 필요합니다.', flags: MessageFlags.Ephemeral });
    return;
  }
  const [, action, songId] = interaction.customId.split(':');
  if (!['delete', 'reject'].includes(action) || !/^\d+$/.test(songId)) {
    await interaction.reply({ content: '잘못된 신고 처리 요청입니다.', flags: MessageFlags.Ephemeral });
    return;
  }
  const label = action === 'delete' ? '삭제 사유' : '기각 사유';
  const modal = new ModalBuilder()
    .setCustomId(`report:resolve:${action}:${songId}:${interaction.message.id}`)
    .setTitle(label);
  const reason = new TextInputBuilder().setCustomId('reason').setLabel(label).setStyle(TextInputStyle.Paragraph)
    .setRequired(true).setMaxLength(500);
  modal.addComponents(new ActionRowBuilder().addComponents(reason));
  await interaction.showModal(modal);
}

export async function resolveReport(database, interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '관리자 권한이 필요합니다.', flags: MessageFlags.Ephemeral });
    return null;
  }
  const [, , action, songId, messageId] = interaction.customId.split(':');
  if (!['delete', 'reject'].includes(action) || !/^\d+$/.test(songId) || !messageId) {
    await interaction.reply({ content: '잘못된 신고 처리 요청입니다.', flags: MessageFlags.Ephemeral });
    return null;
  }
  const reportKey = `report:${messageId}`;
  const now = Date.now();
  const claim = `processing:${now}:${action}:${interaction.user.id}`;
  if (!database.claimMeta(interaction.guildId, reportKey, claim, now - 5 * 60_000)) {
    const resolution = database.resolvedReport(interaction.guildId, reportKey);
    if (resolution) {
      const message = await interaction.channel?.messages.fetch(messageId).catch(() => null);
      if (message?.embeds?.[0]) await message.edit(resolutionPayload(message, resolution));
    }
    await interaction.reply({ content: '이미 처리된 신고입니다.', flags: MessageFlags.Ephemeral });
    return resolution?.action === 'delete' ? resolution.day ?? null : null;
  }
  let completed = false;
  try {
    const song = database.song(interaction.guildId, Number(songId));
    const message = await interaction.channel?.messages.fetch(messageId).catch(() => null);
    if (!message?.embeds?.[0]) {
      await interaction.reply({ content: '신고 글을 찾지 못했습니다.', flags: MessageFlags.Ephemeral });
      return null;
    }
    const reason = interaction.fields.getTextInputValue('reason');
    const day = song?.day ?? message.embeds[0].fields.find(({ name }) => name === '요일')?.value ?? null;
    const resolution = { action, reason, userId: interaction.user.id, day };
    const finalized = database.completeReport(interaction.guildId, reportKey, claim, resolution, Number(songId));
    if (!finalized.ok) {
      await interaction.reply({ content: '다른 관리자가 먼저 처리했습니다.', flags: MessageFlags.Ephemeral });
      return null;
    }
    completed = true;
    await message.edit(resolutionPayload(message, resolution));
    const result = action === 'delete' ? '삭제 처리' : '기각';
    await interaction.reply({ content: `${result}했습니다.`, flags: MessageFlags.Ephemeral });
    return action === 'delete' ? day : null;
  } finally {
    if (!completed) database.clearMeta(interaction.guildId, reportKey, claim);
  }
}

function resolutionPayload(message, resolution) {
  const result = resolution.action === 'delete' ? '삭제 처리' : '기각';
  const reasonLabel = resolution.action === 'delete' ? '삭제 사유' : '기각 사유';
  const fields = (message.embeds[0].fields ?? [])
    .filter(({ name }) => !['처리 결과', '처리', '삭제 사유', '기각 사유'].includes(name));
  const embed = EmbedBuilder.from(message.embeds[0])
    .setColor(resolution.action === 'delete' ? 0xed4245 : 0x747f8d)
    .setFields(
      ...fields,
      { name: '처리 결과', value: result, inline: true },
      { name: '처리', value: `<@${resolution.userId}>`, inline: true },
      { name: reasonLabel, value: resolution.reason },
    );
  return { embeds: [embed], components: [], allowedMentions: { parse: [] } };
}
