import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { MusicDatabase } from '../src/bot/database.js';
import { resolveReport, showResolutionModal, submitReport } from '../src/bot/playlistReports.js';

const song = {
  id: 7,
  day: '화',
  title: '노래',
  artist: '미쿠',
  url: 'https://youtu.be/song-a',
  user_id: 'requester-a',
};

test('신고 처리 선점은 한 관리자에게만 허용하고 오래된 선점은 교체한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'music-report-'));
  const database = new MusicDatabase(join(directory, 'music.db'));
  try {
    const now = Date.now();
    assert.equal(database.claimMeta('guild-a', 'report:a', `processing:${now}:delete:admin-a`, now - 300_000), true);
    assert.equal(database.claimMeta('guild-a', 'report:a', `processing:${now}:reject:admin-b`, now - 300_000), false);
    database.setMeta('guild-a', 'report:a', 'processing:0:delete:admin-a');
    assert.equal(database.claimMeta('guild-a', 'report:a', `processing:${now}:reject:admin-b`, now - 300_000), true);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('신고는 설정된 신고 채널에 삭제 처리와 기각 버튼으로 등록된다', async () => {
  const sends = [];
  const replies = [];
  const fetchedChannels = [];
  const database = {
    song: () => song,
    guildChannels: () => ({ announcement_channel_id: 'announcement-a', report_channel_id: 'report-a' }),
  };
  await submitReport(database, {
    customId: 'playlist:report:7', guildId: 'guild-a', user: { id: 'reporter-a' },
    fields: { getTextInputValue: () => '신고 사유' },
    client: { channels: { fetch: async (id) => {
      fetchedChannels.push(id);
      return { isTextBased: () => true, send: async (payload) => sends.push(payload) };
    } } },
    reply: async (payload) => replies.push(payload),
  });

  assert.deepEqual(fetchedChannels, ['report-a']);
  assert.deepEqual(sends[0].components[0].components.map(({ data }) => data.label), ['삭제 처리', '기각']);
  assert.deepEqual(sends[0].components[0].components.map(({ data }) => data.custom_id), ['report:delete:7', 'report:reject:7']);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
});

test('신고 처리 버튼은 관리자만 사유 모달을 연다', async () => {
  const replies = [];
  await showResolutionModal({
    customId: 'report:delete:7', memberPermissions: { has: () => false },
    reply: async (payload) => replies.push(payload),
  });
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);

  const modals = [];
  await showResolutionModal({
    customId: 'report:reject:7', message: { id: 'message-a' },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.Administrator },
    showModal: async (modal) => modals.push(modal),
  });
  assert.equal(modals[0].data.custom_id, 'report:resolve:reject:7:message-a');
  assert.equal(modals[0].components[0].components[0].data.label, '기각 사유');
});

test('삭제 처리는 곡을 지우고 처리자와 삭제 사유를 신고 글에 남긴다', async () => {
  const edits = [];
  const replies = [];
  const meta = new Map();
  let deletedId;
  const message = {
    embeds: [new EmbedBuilder().setTitle('신청곡 신고').addFields({ name: '신청자', value: '<@requester-a>' })],
    edit: async (payload) => edits.push(payload),
  };
  const database = {
    song: () => song,
    deleteSongById: (_guildId, id) => { deletedId = id; return song; },
    meta: (_guildId, key) => meta.get(key) ?? null,
    setMeta: (_guildId, key, value) => meta.set(key, value),
    claimMeta: (_guildId, key, value) => { meta.set(key, value); return true; },
    clearMeta: (_guildId, key, value) => { if (meta.get(key) === value) meta.delete(key); },
  };
  const day = await resolveReport(database, {
    guildId: 'guild-a', customId: 'report:resolve:delete:7:message-a', user: { id: 'admin-a' },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.ManageGuild },
    fields: { getTextInputValue: () => '중복 신청' },
    channel: { messages: { fetch: async () => message } },
    reply: async (payload) => replies.push(payload),
  });

  assert.equal(day, '화');
  assert.equal(deletedId, 7);
  assert.equal(meta.get('report:message-a'), 'delete');
  assert.deepEqual(edits[0].components, []);
  const fields = edits[0].embeds[0].data.fields;
  assert.equal(fields.find(({ name }) => name === '처리').value, '<@admin-a>');
  assert.equal(fields.find(({ name }) => name === '삭제 사유').value, '중복 신청');
  assert.equal(replies[0].content, '삭제 처리했습니다.');
});

test('기각은 곡을 유지하고 기각 사유만 남긴다', async () => {
  const edits = [];
  const database = {
    song: () => song,
    deleteSongById: () => assert.fail('기각할 때 곡을 삭제하면 안 됩니다.'),
    meta: () => null,
    setMeta: () => {},
    claimMeta: () => true,
    clearMeta: () => {},
  };
  const day = await resolveReport(database, {
    guildId: 'guild-a', customId: 'report:resolve:reject:7:message-a', user: { id: 'admin-a' },
    memberPermissions: { has: () => true },
    fields: { getTextInputValue: () => '문제 없음' },
    channel: { messages: { fetch: async () => ({
      embeds: [new EmbedBuilder().setTitle('신청곡 신고')],
      edit: async (payload) => edits.push(payload),
    }) } },
    reply: async () => {},
  });

  assert.equal(day, null);
  assert.equal(edits[0].embeds[0].data.fields.find(({ name }) => name === '기각 사유').value, '문제 없음');
});

test('신고 글 수정이 실패하면 곡을 삭제하지 않는다', async () => {
  let deleted = false;
  const database = {
    song: () => song,
    deleteSongById: () => { deleted = true; return song; },
    meta: () => null,
    setMeta: () => assert.fail('실패한 처리를 완료로 저장하면 안 됩니다.'),
    claimMeta: () => true,
    clearMeta: () => {},
  };
  await assert.rejects(() => resolveReport(database, {
    guildId: 'guild-a', customId: 'report:resolve:delete:7:message-a', user: { id: 'admin-a' },
    memberPermissions: { has: () => true },
    fields: { getTextInputValue: () => '중복 신청' },
    channel: { messages: { fetch: async () => ({
      embeds: [new EmbedBuilder().setTitle('신청곡 신고')],
      edit: async () => { throw new Error('temporary'); },
    }) } },
    reply: async () => {},
  }), /temporary/);

  assert.equal(deleted, false);
});

test('같은 신고는 여러 관리자가 동시에 처리할 수 없다', async () => {
  const meta = new Map();
  const edits = [];
  let releaseEdit;
  const firstEdit = new Promise((resolve) => { releaseEdit = resolve; });
  const database = {
    song: () => song,
    deleteSongById: () => song,
    meta: (_guildId, key) => meta.get(key) ?? null,
    setMeta: (_guildId, key, value) => meta.set(key, value),
    claimMeta: (_guildId, key, value) => {
      if (meta.has(key)) return false;
      meta.set(key, value);
      return true;
    },
    clearMeta: (_guildId, key, value) => {
      if (meta.get(key) === value) meta.delete(key);
    },
  };
  const message = {
    embeds: [new EmbedBuilder().setTitle('신청곡 신고')],
    edit: async (payload) => {
      edits.push(payload);
      if (edits.length === 1) await firstEdit;
    },
  };
  const interaction = (action, userId) => ({
    guildId: 'guild-a', customId: `report:resolve:${action}:7:message-a`, user: { id: userId },
    memberPermissions: { has: () => true },
    fields: { getTextInputValue: () => '처리 사유' },
    channel: { messages: { fetch: async () => message } },
    reply: async () => {},
  });

  const deleting = resolveReport(database, interaction('delete', 'admin-a'));
  await new Promise((resolve) => setImmediate(resolve));
  const rejecting = resolveReport(database, interaction('reject', 'admin-b'));
  await new Promise((resolve) => setImmediate(resolve));
  releaseEdit();
  await Promise.all([deleting, rejecting]);

  assert.equal(edits.length, 1);
  assert.equal(meta.get('report:message-a'), 'delete');
});
