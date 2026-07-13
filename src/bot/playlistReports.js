import { ActionRowBuilder, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
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
  const song = database.song(Number(interaction.customId.split(':')[2]));
  const channels = database.guildChannels(interaction.guildId);
  if (!song || !channels) {
    await interaction.reply({ content: '신고할 곡을 찾지 못했습니다.', flags: MessageFlags.Ephemeral });
    return;
  }
  const channel = await interaction.client.channels.fetch(channels.announcement_channel_id).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: '신고 채널을 찾지 못했습니다.', flags: MessageFlags.Ephemeral });
    return;
  }
  const embed = new EmbedBuilder().setColor(0xed4245).setTitle('신청곡 신고')
    .addFields(
      { name: '곡', value: `[${songLabel(song)}](${song.url})` },
      { name: '신청자', value: `<@${song.user_id}>`, inline: true },
      { name: '신고자', value: `<@${interaction.user.id}>`, inline: true },
      { name: '사유', value: interaction.fields.getTextInputValue('reason') },
    );
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  await interaction.reply({ content: '신고했습니다.', flags: MessageFlags.Ephemeral });
}
