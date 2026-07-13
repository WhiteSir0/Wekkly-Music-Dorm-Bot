import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { MusicDatabase } from '../src/bot/database.js';
import { resolveReport, showResolutionModal, submitReport } from '../src/bot/playlistReports.js';

function openDatabase(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return { directory, database: new MusicDatabase(join(directory, 'music.db')) };
}

function addSong(database) {
  return Number(database.addSong('guild-a', {
    day: '화', videoId: 'song-a', title: '노래', artist: '미쿠', url: 'https://youtu.be/song-a',
    userId: 'requester-a', userName: '홍길동',
  }).lastInsertRowid);
}

function reportMessage({ edit = async () => {} } = {}) {
  return {
    embeds: [new EmbedBuilder().setTitle('신청곡 신고').addFields(
      { name: '신청자', value: '<@requester-a>' },
      { name: '요일', value: '화' },
    ).data],
    edit,
  };
}

function resolutionInteraction({ action, songId, message, userId = 'admin-a', replies = [] }) {
  return {
    guildId: 'guild-a', customId: `report:resolve:${action}:${songId}:message-a`, user: { id: userId },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.ManageGuild },
    fields: { getTextInputValue: () => action === 'delete' ? '중복 신청' : '문제 없음' },
    channel: { messages: { fetch: async () => message } },
    reply: async (payload) => replies.push(payload),
  };
}

test('신고 처리 선점은 한 관리자에게만 허용하고 오래된 선점은 교체한다', () => {
  const { directory, database } = openDatabase('music-report-claim-');
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

test('신고는 설정된 신고 채널에 요일과 처리 버튼을 포함해 등록된다', async () => {
  const sends = [];
  const replies = [];
  const database = {
    song: () => ({ id: 7, day: '화', title: '노래', artist: '미쿠', url: 'https://youtu.be/song-a', user_id: 'requester-a' }),
    guildChannels: () => ({ announcement_channel_id: 'announcement-a', report_channel_id: 'report-a' }),
  };
  await submitReport(database, {
    customId: 'playlist:report:7', guildId: 'guild-a', user: { id: 'reporter-a' },
    fields: { getTextInputValue: () => '신고 사유' },
    client: { channels: { fetch: async () => ({ isTextBased: () => true, send: async (payload) => sends.push(payload) }) } },
    reply: async (payload) => replies.push(payload),
  });

  assert.equal(sends[0].embeds[0].data.fields.find(({ name }) => name === '요일').value, '화');
  assert.deepEqual(sends[0].components[0].components.map(({ data }) => data.custom_id), ['report:delete:7', 'report:reject:7']);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
});

test('신고 처리 버튼은 관리자와 올바른 동작만 사유 모달을 연다', async () => {
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

  await showResolutionModal({
    customId: 'report:other:7', memberPermissions: { has: () => true },
    reply: async (payload) => replies.push(payload),
  });
  assert.equal(replies.at(-1).content, '잘못된 신고 처리 요청입니다.');
});

test('삭제 처리는 SQLite에서 곡과 처리 결과를 함께 확정한 뒤 신고 글을 바꾼다', async () => {
  const { directory, database } = openDatabase('music-report-delete-');
  try {
    const songId = addSong(database);
    const edits = [];
    const replies = [];
    const message = reportMessage({ edit: async (payload) => edits.push(payload) });

    const day = await resolveReport(database, resolutionInteraction({ action: 'delete', songId, message, replies }));

    assert.equal(day, '화');
    assert.equal(database.song('guild-a', songId), null);
    assert.equal(database.resolvedReport('guild-a', 'report:message-a').action, 'delete');
    assert.equal(edits[0].components.length, 0);
    assert.equal(edits[0].embeds[0].data.fields.find(({ name }) => name === '처리').value, '<@admin-a>');
    assert.equal(replies[0].content, '삭제 처리했습니다.');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('기각은 곡을 유지하고 처리 결과를 저장한다', async () => {
  const { directory, database } = openDatabase('music-report-reject-');
  try {
    const songId = addSong(database);
    const edits = [];
    await resolveReport(database, resolutionInteraction({
      action: 'reject', songId, message: reportMessage({ edit: async (payload) => edits.push(payload) }),
    }));

    assert.ok(database.song('guild-a', songId));
    assert.equal(database.resolvedReport('guild-a', 'report:message-a').action, 'reject');
    assert.equal(edits[0].embeds[0].data.fields.find(({ name }) => name === '기각 사유').value, '문제 없음');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('곡이 이미 없어도 신고 글은 처리할 수 있다', async () => {
  const { directory, database } = openDatabase('music-report-missing-');
  try {
    const edits = [];
    const day = await resolveReport(database, resolutionInteraction({
      action: 'delete', songId: 404, message: reportMessage({ edit: async (payload) => edits.push(payload) }),
    }));

    assert.equal(day, '화');
    assert.equal(database.resolvedReport('guild-a', 'report:message-a').action, 'delete');
    assert.equal(edits.length, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite 확정이 실패하면 신고 글을 완료 상태로 바꾸지 않는다', async () => {
  let edited = false;
  const database = {
    song: () => ({ id: 7, day: '화' }),
    claimMeta: () => true,
    clearMeta: () => {},
    completeReport: () => { throw new Error('database failed'); },
  };
  await assert.rejects(() => resolveReport(database, resolutionInteraction({
    action: 'delete', songId: 7, message: reportMessage({ edit: async () => { edited = true; } }),
  })), /database failed/);
  assert.equal(edited, false);
});

test('Discord 글 갱신이 실패하면 다음 처리에서 저장된 결과로 복구한다', async () => {
  const { directory, database } = openDatabase('music-report-repair-');
  try {
    const songId = addSong(database);
    await assert.rejects(() => resolveReport(database, resolutionInteraction({
      action: 'delete', songId, message: reportMessage({ edit: async () => { throw new Error('temporary'); } }),
    })), /temporary/);
    assert.equal(database.song('guild-a', songId), null);

    const edits = [];
    const replies = [];
    const day = await resolveReport(database, resolutionInteraction({
      action: 'delete', songId, message: reportMessage({ edit: async (payload) => edits.push(payload) }), replies,
    }));
    assert.equal(day, '화');
    assert.equal(edits.length, 1);
    assert.equal(replies[0].content, '이미 처리된 신고입니다.');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('오래된 처리자가 재개돼도 새 처리자의 결정을 덮어쓰지 못한다', () => {
  const { directory, database } = openDatabase('music-report-fence-');
  try {
    const songId = addSong(database);
    const oldClaim = 'processing:0:delete:admin-old';
    const newClaim = `processing:${Date.now()}:reject:admin-new`;
    assert.equal(database.claimMeta('guild-a', 'report:message-a', oldClaim, -1), true);
    assert.equal(database.claimMeta('guild-a', 'report:message-a', newClaim, Date.now() - 300_000), true);

    assert.equal(database.completeReport('guild-a', 'report:message-a', oldClaim, {
      action: 'delete', reason: '오래된 처리', userId: 'admin-old', day: '화',
    }, songId).ok, false);
    assert.equal(database.completeReport('guild-a', 'report:message-a', newClaim, {
      action: 'reject', reason: '새 처리', userId: 'admin-new', day: '화',
    }, songId).ok, true);
    assert.ok(database.song('guild-a', songId));
    assert.equal(database.resolvedReport('guild-a', 'report:message-a').action, 'reject');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
