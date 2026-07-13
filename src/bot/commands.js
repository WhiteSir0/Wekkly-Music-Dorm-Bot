import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { DAYS } from '../shared/constants.js';
import { songLabel } from './playlistService.js';
import { renderGuideCanvas } from './canvas.js';
import { ensureWeeklyStatus, songDetailPayload, weekKey } from './playlistStatus.js';
import { handleDelete, handleLock, handleReset, handleShuffle } from './adminCommands.js';
import { handleHistory, handleHistoryAutocomplete, handleView } from './playlistViews.js';

const dayChoices = DAYS.map((day) => ({ name: day, value: day }));

function dayOption(builder, required = true) {
  return builder.addStringOption((option) => option.setName('요일').setDescription('요일').setRequired(required).addChoices(...dayChoices));
}

export function commandData() {
  return [
    new SlashCommandBuilder().setName('도움말').setDescription('봇 사용법과 운영 규칙을 확인합니다.'),
    new SlashCommandBuilder().setName('정보').setDescription('봇 정보와 원본 소스를 확인합니다.'),
    dayOption(new SlashCommandBuilder().setName('신청').setDescription('요일 플레이리스트에 노래를 신청합니다.')
      .addStringOption((option) => option.setName('제목').setDescription('검색할 곡 제목').setRequired(true).setMaxLength(100))),
    dayOption(new SlashCommandBuilder().setName('보기').setDescription('이번 주 요일별 플레이리스트를 확인합니다.')),
    dayOption(new SlashCommandBuilder().setName('지난플리').setDescription('저장된 주차별 플레이리스트를 확인합니다.')
      .addStringOption((option) => option.setName('주차').setDescription('확인할 주차').setRequired(true).setAutocomplete(true))),
    new SlashCommandBuilder().setName('채널설정').setDescription('이 서버의 신청 및 공지 채널을 설정합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((option) => option.setName('신청채널').setDescription('노래 신청 명령을 사용할 채널')
        .setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addChannelOption((option) => option.setName('공지채널').setDescription('마감 플레이리스트를 공지할 채널')
        .setRequired(true).addChannelTypes(ChannelType.GuildText)),
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

export class CommandHandler {
  constructor({ database, playlist, search, guildIds, fallbackChannels = null, userNames = async () => null }) {
    this.database = database;
    this.playlist = playlist;
    this.search = search;
    this.guildIds = new Set(guildIds);
    this.fallbackChannels = fallbackChannels;
    this.userNames = userNames;
    this.pending = new Map();
  }

  async execute(interaction) {
    if (this.guildIds.size && !this.guildIds.has(interaction.guildId)) {
      await interaction.reply({ content: '지정된 서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
      return;
    }
    const handlers = {
      도움말: () => this.help(interaction), 정보: () => this.info(interaction), 신청: () => this.request(interaction), 보기: () => this.view(interaction),
      지난플리: () => this.history(interaction),
      채널설정: () => this.configureChannels(interaction),
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
    const registeredName = await this.userNames(interaction.guildId, interaction.user.id);
    const userName = registeredName ?? interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username;
    const result = this.playlist.register(interaction.user.id, pending.day, song, userName);
    if (result.ok) this.pending.delete(token);
    await interaction.update({ content: result.ok ? `${songLabel(song)}을 ${pending.day}요일에 등록했습니다.` : result.message, embeds: [], components: [] });
    if (result.ok) await ensureWeeklyStatus({
      client: interaction.client, database: this.database, guildId: interaction.guildId,
      key: weekKey(new Date(Date.now() + 9 * 60 * 60_000)), forceEdit: true,
      day: pending.day,
    }).catch((error) => console.error('[weekly status]', error));
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

  async info(interaction) {
    await interaction.reply({
      content: 'Wekkly Music Dorm Bot\n원본 소스: https://github.com/WhiteSir0/Wekkly-Music-Dorm-Bot',
    });
  }

  async configureChannels(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: '관리자 권한이 필요합니다.', flags: MessageFlags.Ephemeral });
      return;
    }
    const requestChannel = interaction.options.getChannel('신청채널');
    const announcementChannel = interaction.options.getChannel('공지채널');
    const previous = this.database.guildChannels(interaction.guildId);
    this.database.setGuildChannels(interaction.guildId, requestChannel.id, announcementChannel.id);
    const payload = { files: [{ attachment: await renderGuideCanvas(), name: 'miku-guide.png' }] };
    let guideMessageId = previous?.guide_message_id ?? null;
    if (guideMessageId && previous.request_channel_id === requestChannel.id) {
      const message = await requestChannel.messages.fetch(guideMessageId).catch(() => null);
      if (message) await message.edit({ ...payload, attachments: [] });
      else guideMessageId = null;
    } else if (guideMessageId) {
      const previousChannel = await interaction.client.channels.fetch(previous.request_channel_id).catch(() => null);
      const previousMessage = await previousChannel?.messages.fetch(guideMessageId).catch(() => null);
      await previousMessage?.delete().catch(() => null);
      guideMessageId = null;
    }
    if (!guideMessageId) guideMessageId = (await requestChannel.send(payload)).id;
    this.database.setGuildGuideMessage(interaction.guildId, guideMessageId);
    await ensureWeeklyStatus({
      client: interaction.client, database: this.database, guildId: interaction.guildId,
      key: weekKey(new Date(Date.now() + 9 * 60 * 60_000)), forceEdit: true,
    });
    await interaction.reply({
      content: `신청 채널을 ${requestChannel}, 공지 채널을 ${announcementChannel}(으)로 설정했습니다.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  async request(interaction) {
    const channels = this.database.guildChannels(interaction.guildId) ?? this.fallbackChannels;
    if (!channels) {
      await interaction.reply({ content: '서버 관리자가 먼저 `/채널설정`을 실행해야 합니다.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.channelId !== channels.request_channel_id) {
      await interaction.reply({ content: `노래 신청은 <#${channels.request_channel_id}> 채널에서만 사용할 수 있습니다.`, flags: MessageFlags.Ephemeral });
      return;
    }
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
    const now = Date.now();
    for (const [key, pending] of this.pending) {
      if (pending.expiresAt < now || pending.userId === interaction.user.id) this.pending.delete(key);
    }
    if (this.pending.size >= 500) this.pending.delete(this.pending.keys().next().value);
    const token = randomUUID().slice(0, 12);
    this.pending.set(token, { userId: interaction.user.id, day, results, expiresAt: now + 10 * 60_000 });
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
    await handleView(this.database, interaction);
  }

  async history(interaction) {
    await handleHistory(this.database, interaction);
  }

  async autocomplete(interaction) {
    await handleHistoryAutocomplete(this.database, interaction);
  }

  async playlistSong(interaction) {
    const song = this.database.song(Number(interaction.values[0]));
    if (!song) {
      await interaction.update({ content: '삭제된 곡입니다.', embeds: [], components: [], attachments: [] });
      return;
    }
    await interaction.reply({ ...songDetailPayload(song), flags: MessageFlags.Ephemeral });
  }

  async reportButton(interaction) {
    const songId = interaction.customId.split(':')[2];
    const modal = new ModalBuilder().setCustomId(`playlist:report:${songId}`).setTitle('신청곡 신고');
    const reason = new TextInputBuilder().setCustomId('reason').setLabel('사유').setStyle(TextInputStyle.Paragraph)
      .setRequired(true).setMaxLength(500);
    modal.addComponents(new ActionRowBuilder().addComponents(reason));
    await interaction.showModal(modal);
  }

  async reportSubmit(interaction) {
    const song = this.database.song(Number(interaction.customId.split(':')[2]));
    const channels = this.database.guildChannels(interaction.guildId);
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

  async lock(interaction) {
    await handleLock(this.database, interaction);
  }

  async shuffle(interaction) {
    await handleShuffle(this.database, interaction);
  }

  async delete(interaction) {
    await handleDelete(this.database, interaction);
  }

  async reset(interaction) {
    await handleReset(this.database, interaction);
  }
}

export { listEmbed } from './adminCommands.js';
