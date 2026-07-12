import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { DAYS, MAX_SONGS } from '../shared/constants.js';
import { songLabel } from './playlistService.js';

const dayChoices = DAYS.map((day) => ({ name: day, value: day }));

function dayOption(builder) {
  return builder.addStringOption((option) => option.setName('요일').setDescription('요일').setRequired(true).addChoices(...dayChoices));
}

export function commandData() {
  return [
    new SlashCommandBuilder().setName('도움말').setDescription('봇 사용법과 운영 규칙을 확인합니다.'),
    dayOption(new SlashCommandBuilder().setName('신청').setDescription('요일 플레이리스트에 노래를 신청합니다.')
      .addStringOption((option) => option.setName('제목').setDescription('검색할 곡 제목').setRequired(true).setMaxLength(100))),
    dayOption(new SlashCommandBuilder().setName('보기').setDescription('요일 플레이리스트를 확인합니다.')),
    new SlashCommandBuilder().setName('플리제한').setDescription('요일 플레이리스트를 잠금 또는 해제합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((option) => option.setName('요일').setDescription('요일').setRequired(true).addChoices(...dayChoices))
      .addStringOption((option) => option.setName('상태').setDescription('상태').setRequired(true)
        .addChoices({ name: '잠금', value: '잠금' }, { name: '해제', value: '해제' }))
      .addUserOption((option) => option.setName('유저').setDescription('독점 권한 사용자')),
    dayOption(new SlashCommandBuilder().setName('셔플').setDescription('요일 곡 목록을 섞습니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)),
    dayOption(new SlashCommandBuilder().setName('삭제').setDescription('요일 플레이리스트에서 곡을 삭제합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addIntegerOption((option) => option.setName('번호').setDescription('삭제할 번호').setRequired(true).setMinValue(1).setMaxValue(15))),
    new SlashCommandBuilder().setName('db초기화').setDescription('모든 신청 데이터를 초기화합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((option) => option.setName('확인').setDescription('초기화 입력').setRequired(true)),
  ];
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function listEmbed(day, songs, shuffled = false) {
  const ordered = shuffled ? [...songs].sort(() => Math.random() - 0.5) : songs;
  const description = ordered.length
    ? ordered.map((song, index) => `${index + 1}. [${songLabel(song)}](${song.url})`).join('\n')
    : '신청된 곡이 없습니다.';
  return new EmbedBuilder().setColor(0xd95377).setTitle(`${day}요일 플레이리스트`).setDescription(description)
    .setFooter({ text: `${songs.length}/${MAX_SONGS[day]}곡` });
}

export class CommandHandler {
  constructor({ database, playlist, search, guildIds }) {
    this.database = database;
    this.playlist = playlist;
    this.search = search;
    this.guildIds = new Set(guildIds);
    this.pending = new Map();
  }

  async execute(interaction) {
    if (this.guildIds.size && !this.guildIds.has(interaction.guildId)) {
      await interaction.reply({ content: '지정된 서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
      return;
    }
    const handlers = {
      도움말: () => this.help(interaction), 신청: () => this.request(interaction), 보기: () => this.view(interaction),
      플리제한: () => this.lock(interaction), 셔플: () => this.shuffle(interaction), 삭제: () => this.delete(interaction),
      db초기화: () => this.reset(interaction),
    };
    await handlers[interaction.commandName]?.();
  }

  async button(interaction) {
    const [, token, indexText] = interaction.customId.split(':');
    const pending = this.pending.get(token);
    if (!pending || pending.expiresAt < Date.now()) {
      this.pending.delete(token);
      await interaction.reply({ content: '선택 시간이 만료됐습니다. 다시 검색해주세요.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (pending.userId !== interaction.user.id) {
      await interaction.reply({ content: '검색을 요청한 사용자만 선택할 수 있습니다.', flags: MessageFlags.Ephemeral });
      return;
    }
    const song = pending.results[Number(indexText)];
    const result = this.playlist.register(interaction.user.id, pending.day, song);
    if (result.ok) this.pending.delete(token);
    await interaction.update({ content: result.ok ? `${songLabel(song)}을 ${pending.day}요일에 등록했습니다.` : result.message, embeds: [], components: [] });
  }

  async help(interaction) {
    const embed = new EmbedBuilder().setColor(0xd95377).setTitle('주간 음악 신청')
      .setDescription('월~금 플레이리스트에 노래를 신청합니다.')
      .addFields(
        { name: '신청', value: '`/신청 제목 요일`\n검색 결과에서 곡을 선택하세요.' },
        { name: '보기', value: '`/보기 요일`' },
        { name: '기본 규칙', value: '월~목 12곡, 금요일 15곡\n한 사람당 주 2곡\n4분 30초 이하\n일요일 오전 9시 초기화' },
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  async request(interaction) {
    const day = interaction.options.getString('요일');
    const validation = this.playlist.validate(interaction.user.id, day);
    if (!validation.ok) {
      await interaction.reply({ content: validation.message, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const results = await this.search.search(interaction.options.getString('제목'), 3);
    if (!results.length) {
      await interaction.editReply('검색 결과가 없습니다.');
      return;
    }
    const token = randomUUID().slice(0, 12);
    this.pending.set(token, { userId: interaction.user.id, day, results, expiresAt: Date.now() + 10 * 60_000 });
    const embeds = results.map((song, index) => {
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`${index + 1}. ${songLabel(song)}`).setURL(song.url);
      if (song.thumbnailUrl) embed.setImage(song.thumbnailUrl);
      return embed;
    });
    const row = new ActionRowBuilder().addComponents(results.map((_, index) => new ButtonBuilder()
      .setCustomId(`song:${token}:${index}`).setLabel(`${index + 1}번`).setStyle(ButtonStyle.Primary)));
    await interaction.editReply({ embeds, components: [row] });
  }

  async view(interaction) {
    const day = interaction.options.getString('요일');
    await interaction.reply({ embeds: [listEmbed(day, this.database.daySongs(day))], flags: MessageFlags.Ephemeral });
  }

  async lock(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: '관리자 권한이 필요합니다.', flags: MessageFlags.Ephemeral });
    const day = interaction.options.getString('요일');
    const locked = interaction.options.getString('상태') === '잠금';
    const user = interaction.options.getUser('유저');
    this.database.setLock(day, locked, locked ? user?.id ?? null : null);
    await interaction.reply(`${day}요일 플레이리스트를 ${locked ? `잠갔습니다${user ? ` (${user} 전용)` : ''}` : '열었습니다'}.`);
  }

  async shuffle(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: '관리자 권한이 필요합니다.', flags: MessageFlags.Ephemeral });
    const day = interaction.options.getString('요일');
    await interaction.reply({ embeds: [listEmbed(day, this.database.daySongs(day), true)] });
  }

  async delete(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: '관리자 권한이 필요합니다.', flags: MessageFlags.Ephemeral });
    const day = interaction.options.getString('요일');
    const song = this.database.deleteSong(day, interaction.options.getInteger('번호'));
    await interaction.reply(song ? `${songLabel(song)}을 삭제했습니다.` : '해당 번호의 곡이 없습니다.');
  }

  async reset(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: '관리자 권한이 필요합니다.', flags: MessageFlags.Ephemeral });
    if (interaction.options.getString('확인') !== '초기화') {
      await interaction.reply({ content: '확인에 `초기화`를 입력해주세요.', flags: MessageFlags.Ephemeral });
      return;
    }
    this.database.clearAll();
    await interaction.reply('모든 신청 데이터를 초기화했습니다.');
  }
}

export { listEmbed };
