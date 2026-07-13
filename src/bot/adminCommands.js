import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { MAX_SONGS } from '../shared/constants.js';
import { createLockCard, renderLockCanvas } from './canvas.js';
import { songLabel } from './playlistService.js';

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

export function listEmbed(day, songs, shuffled = false) {
  const ordered = shuffled ? [...songs].sort(() => Math.random() - 0.5) : songs;
  const description = ordered.length
    ? ordered.map((song, index) => `${index + 1}. [${songLabel(song)}](${song.url})`).join('\n')
    : '신청된 곡이 없습니다.';
  return new EmbedBuilder().setColor(0xd95377).setTitle(`${day}요일 플레이리스트`).setDescription(description)
    .setFooter({ text: `${songs.length}/${MAX_SONGS[day]}곡` });
}

export async function handleLock(database, interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '관리자 권한이 필요합니다.', flags: MessageFlags.Ephemeral });
    return null;
  }
  const day = interaction.options.getString('요일');
  const locked = interaction.options.getString('상태') === '잠금';
  const user = interaction.options.getUser('유저');
  const deletedCount = database.setLock(day, locked, locked ? user?.id ?? null : null);
  if (!locked) {
    await interaction.reply(`${day}요일 플레이리스트를 열었습니다.`);
    return day;
  }
  const member = user ? interaction.options.getMember('유저') : null;
  const displayName = member?.displayName ?? user?.globalName ?? user?.username;
  const avatarUrl = user?.displayAvatarURL({ extension: 'png', size: 256 });
  const attachment = await renderLockCanvas(createLockCard({ day, displayName, avatarUrl, deletedCount }));
  const payload = { files: [{ attachment, name: 'miku-lock.png' }] };
  if (user) {
    payload.content = `<@${user.id}>`;
    payload.allowedMentions = { users: [user.id] };
  }
  await interaction.reply(payload);
  return day;
}

export function handleShuffle(database, interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '관리자 권한이 필요합니다.', flags: MessageFlags.Ephemeral });
  const day = interaction.options.getString('요일');
  return interaction.reply({ embeds: [listEmbed(day, database.daySongs(day), true)] });
}

export async function handleDelete(database, interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '관리자 권한이 필요합니다.', flags: MessageFlags.Ephemeral });
    return null;
  }
  const day = interaction.options.getString('요일');
  const song = database.deleteSong(day, interaction.options.getInteger('번호'));
  await interaction.reply(song ? `${songLabel(song)}을 삭제했습니다.` : '해당 번호의 곡이 없습니다.');
  return song ? day : null;
}

export async function handleReset(database, interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '관리자 권한이 필요합니다.', flags: MessageFlags.Ephemeral });
    return false;
  }
  if (interaction.options.getString('확인') !== '초기화') {
    await interaction.reply({ content: '확인에 `초기화`를 입력해주세요.', flags: MessageFlags.Ephemeral });
    return false;
  }
  database.clearAll();
  await interaction.reply('모든 신청 데이터를 초기화했습니다.');
  return true;
}
