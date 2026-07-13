import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandHandler } from '../src/bot/commands.js';
import { createLockCard, renderLockCanvas } from '../src/bot/canvas.js';

test('exclusive lock card contains the dynamic day, name, avatar URL, and deleted count', () => {
  const card = createLockCard({
    day: '목', displayName: '서버 미쿠', avatarUrl: 'https://cdn.discordapp.com/avatar.png', deletedCount: 7,
  });

  assert.deepEqual(card, {
    title: '목요일 독점 플리',
    applicant: '서버 미쿠 님만 신청 가능',
    avatarUrl: 'https://cdn.discordapp.com/avatar.png',
    deleted: '기존 신청곡 7곡 정리 완료',
  });
});

test('general lock card has no fake selected user', () => {
  const card = createLockCard({ day: '화', deletedCount: 2 });

  assert.deepEqual(card, {
    title: '화요일 신청이 잠겼어요',
    applicant: null,
    avatarUrl: null,
    deleted: '기존 신청곡 2곡 정리 완료',
  });
  assert.doesNotMatch(JSON.stringify(card), /선택된 사용자/);
});

test('lock canvas renders the exported card payload as PNG', async () => {
  const card = createLockCard({ day: '월', displayName: '하츠네 미쿠', deletedCount: 3 });
  const image = await renderLockCanvas(card);

  assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(image.length > 10_000);
});

test('lock canvas falls back without an avatar when decoding fails', async () => {
  const card = createLockCard({
    day: '수', displayName: '서버 미쿠', avatarUrl: 'https://cdn.invalid/avatar.png', deletedCount: 3,
  });
  const image = await renderLockCanvas(card, {
    avatarLoader: async () => { throw new Error('offline'); },
  });

  assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(image.length > 10_000);
});

test('exclusive lock command sends the user mention with the canvas', async () => {
  const replies = [];
  const followUps = [];
  const handler = new CommandHandler({
    database: { setLock: () => 4, guildChannels: () => null }, playlist: {}, search: {}, guildIds: ['guild-a'],
  });
  const avatarCalls = [];
  const user = {
    id: 'user-a', username: 'miku',
    displayAvatarURL: (options) => {
      avatarCalls.push(options);
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQH/qc6T9QAAAABJRU5ErkJggg==';
    },
  };

  await handler.execute({
    commandName: '플리제한', guildId: 'guild-a',
    memberPermissions: { has: () => true },
    options: {
      getString: (name) => name === '요일' ? '수' : '잠금',
      getUser: () => user,
      getMember: () => ({ displayName: '서버 미쿠' }),
    },
    reply: async (payload) => replies.push(payload),
    followUp: async (payload) => followUps.push(payload),
  });

  assert.equal(replies.length, 1);
  assert.equal(replies[0].files[0].name, 'miku-lock.png');
  assert.equal(replies[0].content, '<@user-a>');
  assert.deepEqual(replies[0].allowedMentions, { users: ['user-a'] });
  assert.deepEqual(avatarCalls, [{ extension: 'png', size: 256 }]);
  assert.deepEqual(followUps, []);
});

test('general lock command sends a card without a mention', async () => {
  const replies = [];
  const followUps = [];
  const handler = new CommandHandler({
    database: { setLock: () => 5, guildChannels: () => null }, playlist: {}, search: {}, guildIds: ['guild-a'],
  });

  await handler.execute({
    commandName: '플리제한', guildId: 'guild-a',
    memberPermissions: { has: () => true },
    options: {
      getString: (name) => name === '요일' ? '금' : '잠금',
      getUser: () => null,
      getMember: () => { throw new Error('member lookup must not run without a user'); },
    },
    reply: async (payload) => replies.push(payload),
    followUp: async (payload) => followUps.push(payload),
  });

  assert.equal(replies.length, 1);
  assert.equal(replies[0].files[0].name, 'miku-lock.png');
  assert.deepEqual(followUps, []);
});

test('unlock command remains a text response', async () => {
  const replies = [];
  const handler = new CommandHandler({
    database: { setLock: () => 0, guildChannels: () => null }, playlist: {}, search: {}, guildIds: ['guild-a'],
  });

  await handler.execute({
    commandName: '플리제한', guildId: 'guild-a',
    memberPermissions: { has: () => true },
    options: {
      getString: (name) => name === '요일' ? '일' : '해제',
      getUser: () => null,
    },
    reply: async (payload) => replies.push(payload),
  });

  assert.deepEqual(replies, ['일요일 플레이리스트를 열었습니다.']);
});
