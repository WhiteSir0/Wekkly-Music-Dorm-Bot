import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';
import { CommandHandler } from '../src/bot/commands.js';
import { MusicDatabase } from '../src/bot/database.js';
import { ensureWeeklyStatus, weekLabel } from '../src/bot/playlistStatus.js';

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
