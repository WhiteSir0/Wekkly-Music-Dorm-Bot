import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandHandler } from '../src/bot/commands.js';

async function selectedRequesterName(registeredName) {
  let requesterName;
  const handler = new CommandHandler({
    database: {},
    playlist: {
      register(_userId, _day, _song, userName) {
        requesterName = userName;
        return { ok: false, message: 'test complete' };
      },
    },
    search: {},
    guildIds: ['guild-a'],
    userNames: async () => registeredName,
  });
  handler.pending.set('request', {
    userId: 'user-a',
    day: '월',
    results: [{ videoId: 'song-a', title: 'Song A', artist: 'Artist', url: 'https://youtu.be/song-a' }],
    expiresAt: Date.now() + 60_000,
  });

  await handler.button({
    customId: 'song:request:0',
    guildId: 'guild-a',
    user: { id: 'user-a', username: 'account-name' },
    member: { displayName: 'server-name' },
    update: async () => {},
  });
  return requesterName;
}

test('노래 신청자는 학번등록에서 입력한 이름을 우선 사용한다', async () => {
  assert.equal(await selectedRequesterName('홍길동'), '홍길동');
});

test('학번등록 정보가 없으면 서버 프로필 이름을 사용한다', async () => {
  assert.equal(await selectedRequesterName(null), 'server-name');
});
