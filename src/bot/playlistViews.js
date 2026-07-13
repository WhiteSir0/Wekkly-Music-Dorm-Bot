import { MessageFlags } from 'discord.js';
import { dayStatusPayload, weekLabel } from './playlistStatus.js';

export async function handleView(database, interaction) {
  await interaction.reply({ ...dayStatusPayload(database, interaction.options.getString('요일')), flags: MessageFlags.Ephemeral });
}

export async function handleHistory(database, interaction) {
  const key = interaction.options.getString('주차');
  if (!database.historyWeeks().includes(key)) {
    await interaction.reply({ content: '저장된 주차를 찾지 못했습니다.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({
    ...dayStatusPayload(database, interaction.options.getString('요일'), key),
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleHistoryAutocomplete(database, interaction) {
  const query = interaction.options.getFocused().trim();
  const choices = database.historyWeeks().map((key) => ({ name: weekLabel(key), value: key }))
    .filter(({ name, value }) => !query || name.includes(query) || value.includes(query)).slice(0, 25);
  await interaction.respond(choices);
}
