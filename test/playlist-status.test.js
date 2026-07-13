import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';
import { CommandHandler } from '../src/bot/commands.js';
import { MusicDatabase } from '../src/bot/database.js';
import { ensureWeeklyStatus, weekLabel } from '../src/bot/playlistStatus.js';
import { Scheduler } from '../src/bot/scheduler.js';

function openDatabase(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return { directory, database: new MusicDatabase(join(directory, 'music.db')) };
}

test('주간 초기화 뒤에도 주차별 곡과 신청자 이름을 보관한다', () => {
  const { directory, database } = openDatabase('wekkly-history-');
  try {
    database.addSong({
      day: '월', videoId: 'song-a', title: '노래', artist: '미쿠', url: 'https://youtu.be/song-a',
      userId: 'user-a', userName: '홍길동',
    });
    database.archiveWeek('2026-07-12');
    database.resetWeekly();

    assert.deepEqual(database.historyWeeks(), ['2026-07-12']);
    assert.deepEqual(database.historyDaySongs('2026-07-12', '월').map(({ title, user_name: name }) => ({ title, name })), [
      { title: '노래', name: '홍길동' },
    ]);
    assert.equal(database.daySongs('월').length, 0);
    assert.equal(weekLabel('2026-07-12'), '7월 2주차');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('월요일 신청 뒤에는 월요일 메시지만 수정한다', async () => {
  const { directory, database } = openDatabase('wekkly-day-messages-');
  try {
    database.setGuildChannels('guild-a', 'request-a', 'announcement-a');
    const messages = new Map();
    const sends = [];
    const edits = [];
    const channel = {
      isTextBased: () => true,
      messages: { fetch: async (id) => messages.get(id) ?? null },
      send: async (payload) => {
        const id = `message-${sends.length + 1}`;
        sends.push(payload);
        messages.set(id, { edit: async (edited) => edits.push({ id, edited }) });
        return { id };
      },
    };
    const client = { channels: { fetch: async () => channel } };

    await ensureWeeklyStatus({ client, database, guildId: 'guild-a', key: '2026-07-12' });
    database.addSong({
      day: '월', videoId: 'song-a', title: '노래', artist: '미쿠', url: 'https://youtu.be/song-a',
      userId: 'user-a', userName: '홍길동',
    });
    await ensureWeeklyStatus({ client, database, guildId: 'guild-a', key: '2026-07-12', forceEdit: true, day: '월' });

    assert.equal(sends.length, 5);
    assert.deepEqual(edits.map(({ id }) => id), ['message-1']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('요일 메시지 전송이 중간에 실패해도 성공한 메시지를 재사용한다', async () => {
  const { directory, database } = openDatabase('wekkly-partial-messages-');
  try {
    database.setGuildChannels('guild-a', 'request-a', 'announcement-a');
    const messages = new Map();
    let attempts = 0;
    let failOnce = true;
    const channel = {
      isTextBased: () => true,
      messages: { fetch: async (id) => messages.get(id) ?? null },
      send: async () => {
        attempts += 1;
        if (attempts === 3 && failOnce) {
          failOnce = false;
          throw new Error('temporary');
        }
        const id = `message-${messages.size + 1}`;
        const message = { edit: async () => {} };
        messages.set(id, message);
        return { id };
      },
    };
    const client = { channels: { fetch: async () => channel } };

    await assert.rejects(() => ensureWeeklyStatus({ client, database, guildId: 'guild-a', key: '2026-07-12' }), /temporary/);
    assert.equal(Object.keys(JSON.parse(database.guildChannels('guild-a').day_message_ids)).length, 2);
    assert.equal(database.guildChannels('guild-a').weekly_message_key, null);

    await ensureWeeklyStatus({ client, database, guildId: 'guild-a', key: '2026-07-12' });

    assert.equal(messages.size, 5);
    assert.equal(Object.keys(JSON.parse(database.guildChannels('guild-a').day_message_ids)).length, 5);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('기존 단일 메시지 삭제가 실패하면 ID를 남겨 다음 실행에 재시도한다', async () => {
  const { directory, database } = openDatabase('wekkly-legacy-retry-');
  try {
    database.setGuildChannels('guild-a', 'request-a', 'announcement-a');
    database.setGuildDayMessages('guild-a', { 월: 'm', 화: 't', 수: 'w', 목: 'h', 금: 'f' }, '2026-07-12');
    database.setGuildWeeklyMessage('guild-a', 'legacy', '2026-07-12');
    let deleteAttempts = 0;
    const channel = {
      isTextBased: () => true,
      messages: { fetch: async (id) => id === 'legacy'
        ? { delete: async () => { deleteAttempts += 1; if (deleteAttempts === 1) throw new Error('temporary'); } }
        : { edit: async () => {} } },
    };
    const client = { channels: { fetch: async () => channel } };

    await assert.rejects(() => ensureWeeklyStatus({ client, database, guildId: 'guild-a', key: '2026-07-12' }), /temporary/);
    assert.equal(database.guildChannels('guild-a').weekly_message_id, 'legacy');
    await ensureWeeklyStatus({ client, database, guildId: 'guild-a', key: '2026-07-12' });

    assert.equal(deleteAttempts, 2);
    assert.equal(database.guildChannels('guild-a').weekly_message_id, null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('곡 선택은 요일 메시지를 바꾸지 않고 선택한 사용자에게만 보인다', async () => {
  const replies = [];
  const handler = new CommandHandler({
    database: { song: () => ({ id: 1, title: '노래', artist: '미쿠', url: 'https://youtu.be/song-a', user_id: 'user-a' }) },
    playlist: {}, search: {}, guildIds: ['guild-a'],
  });
  await handler.playlistSong({
    values: ['1'],
    reply: async (payload) => replies.push(payload),
    update: async () => assert.fail('공개 요일 메시지를 수정하면 안 됩니다.'),
  });

  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  assert.deepEqual(replies[0].components[0].components.map(({ data }) => data.label), ['보기', '신고하기']);
});

test('삭제된 곡을 선택해도 공개 요일 메시지를 수정하지 않는다', async () => {
  const replies = [];
  const handler = new CommandHandler({
    database: { song: () => null }, playlist: {}, search: {}, guildIds: ['guild-a'],
  });
  await handler.playlistSong({
    values: ['404'],
    reply: async (payload) => replies.push(payload),
    update: async () => assert.fail('공개 요일 메시지를 수정하면 안 됩니다.'),
  });

  assert.equal(replies[0].content, '삭제된 곡입니다.');
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
});

test('지난 플리는 주차에서 요일과 곡을 차례로 비공개 조회한다', async () => {
  const { directory, database } = openDatabase('wekkly-history-flow-');
  try {
    database.addSong({
      day: '화', videoId: 'song-a', title: '노래', artist: '미쿠', url: 'https://youtu.be/song-a',
      userId: 'user-a', userName: '홍길동',
    });
    database.archiveWeek('2026-07-12');
    const handler = new CommandHandler({ database, playlist: {}, search: {}, guildIds: ['guild-a'] });
    const replies = [];
    const dayUpdates = [];
    const songUpdates = [];

    await handler.history({
      options: { getString: () => '2026-07-12' },
      reply: async (payload) => replies.push(payload),
    });
    await handler.historyDay({
      customId: 'history:day:2026-07-12:화',
      update: async (payload) => dayUpdates.push(payload),
    });
    await handler.historySong({
      customId: 'history:song:2026-07-12:화', values: ['song-a'],
      update: async (payload) => songUpdates.push(payload),
    });

    assert.equal(replies[0].flags, MessageFlags.Ephemeral);
    assert.deepEqual(replies[0].components[0].components.map(({ data }) => data.label), ['월', '화', '수', '목', '금']);
    assert.equal(dayUpdates[0].components[0].components[0].data.placeholder, '곡 선택');
    assert.deepEqual(songUpdates[0].components[0].components.map(({ data }) => data.label), ['보기']);
    assert.equal(songUpdates[0].embeds[0].data.fields.find(({ name }) => name === '신청자').value, '홍길동');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('주차가 바뀌면 기존 곡을 보관하고 다섯 요일 메시지를 비운다', async () => {
  const { directory, database } = openDatabase('wekkly-rollover-');
  try {
    database.setGuildChannels('guild-a', 'request-a', 'announcement-a');
    database.setGuildDayMessages('guild-a', { 월: 'm', 화: 't', 수: 'w', 목: 'h', 금: 'f' }, '2026-07-12');
    database.setMeta('last_weekly_reset', '2026-07-12');
    database.addSong({
      day: '월', videoId: 'song-a', title: '노래', artist: '미쿠', url: 'https://youtu.be/song-a',
      userId: 'user-a', userName: '홍길동',
    });
    const edits = [];
    const channel = {
      isTextBased: () => true,
      messages: { fetch: async (id) => ({ edit: async (payload) => edits.push({ id, payload }) }) },
      send: async () => assert.fail('기존 요일 메시지를 새로 보내면 안 됩니다.'),
    };
    const scheduler = new Scheduler({
      client: { channels: { fetch: async () => channel } }, database, guildIds: ['guild-a'],
      now: () => new Date('2026-07-20T03:00:00Z'),
    });

    await scheduler.run();

    assert.equal(database.daySongs('월').length, 0);
    assert.equal(database.historyDaySongs('2026-07-12', '월').length, 1);
    assert.equal(edits.length, 5);
    assert.equal(database.guildChannels('guild-a').weekly_message_key, '2026-07-19');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
