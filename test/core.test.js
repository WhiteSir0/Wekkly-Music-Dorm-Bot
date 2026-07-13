import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { allowedDays, secondsFromText } from '../src/shared/constants.js';
import { MusicDatabase } from '../src/bot/database.js';
import { PlaylistService } from '../src/bot/playlistService.js';
import { enrichMusicVideos, parseMusicItem, parseSearch } from '../src/search/resultParser.js';
import { commandData, CommandHandler } from '../src/bot/commands.js';
import { parseGuildIds } from '../src/bot/config.js';
import { registerCommands } from '../src/bot/registration.js';
import { Scheduler } from '../src/bot/scheduler.js';
import { isTailscaleIpv4 } from '../src/search/config.js';
import { GUIDE_COPY, renderGuideCanvas } from '../src/bot/canvas.js';
import { DatabaseSync } from 'node:sqlite';

test('YouTube Music 검색은 앨범이 있는 노래만 반환한다', () => {
  const contents = new Set([
    {
      item_type: 'song', id: 'song-1', title: 'Album song', artists: [{ name: 'Artist' }],
      album: { id: 'MPR-album', name: 'Album' }, duration: { text: '3:12', seconds: 192 },
      thumbnails: [{ url: 'https://img/one.jpg', width: 320 }],
    },
    { item_type: 'song', id: 'song-2', title: 'No album', artists: [{ name: 'Artist' }] },
    { item_type: 'video', id: 'video-1', title: 'Music video', album: { id: 'MPR-video', name: 'Album' } },
  ]);
  assert.deepEqual(parseSearch({ contents: [{ contents }] }, 10), [{
    videoId: 'song-1', title: 'Album song', artist: 'Artist',
    url: 'https://www.youtube.com/watch?v=song-1', thumbnailUrl: 'https://img/one.jpg', durationSeconds: 192,
  }]);
});

test('YouTube Data API enrichment keeps music videos and fills authoritative metadata', async () => {
  const candidates = [
    { videoId: 'music', title: 'Song', artist: null, durationSeconds: null },
    { videoId: 'other', title: 'Talk', artist: 'Speaker', durationSeconds: 20 },
  ];
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      async json() {
        return { items: [
          { id: 'music', snippet: { categoryId: '10', channelTitle: 'Artist channel' }, contentDetails: { duration: 'PT4M5S' } },
          { id: 'other', snippet: { categoryId: '22', channelTitle: 'Other' }, contentDetails: { duration: 'PT20S' } },
        ] };
      },
    };
  };

  assert.deepEqual(await enrichMusicVideos(candidates, 'secret', fetchImpl), [
    { videoId: 'music', title: 'Song', artist: 'Artist channel', durationSeconds: 245 },
  ]);
  assert.equal(requestedUrl.searchParams.get('part'), 'snippet,contentDetails');
  assert.equal(requestedUrl.searchParams.get('id'), 'music,other');
  assert.equal(requestedUrl.searchParams.get('key'), 'secret');
});

test('YouTube Data API enrichment is optional', async () => {
  const candidates = [{ videoId: 'video', title: 'Video' }];
  assert.equal(await enrichMusicVideos(candidates, '', () => assert.fail('fetch should not run')), candidates);
});

test('YouTube Music 검색 결과를 봇 계약으로 변환한다', () => {
  const result = parseMusicItem({
    item_type: 'song', id: 'abc123', title: { text: '테스트 곡' }, artists: [{ name: '重音テト' }],
    album: { id: 'MPR-test', name: '테스트 앨범' },
    duration: { text: '3:21' }, thumbnail: { contents: [{ url: 'https://img/s.jpg', width: 120 }, { url: 'https://img/l.jpg', width: 480 }] },
  });
  assert.deepEqual(result, {
    videoId: 'abc123', title: '테스트 곡', artist: '重音テト', url: 'https://www.youtube.com/watch?v=abc123',
    thumbnailUrl: 'https://img/l.jpg', durationSeconds: 201,
  });
});

test('일요일 오전 9시부터 월요일을 포함한 신청이 열린다', () => {
  assert.deepEqual(allowedDays(new Date('2026-07-12T00:00:00Z')), ['월', '화', '수', '목', '금']);
  assert.deepEqual(allowedDays(new Date('2026-07-11T23:59:00Z')), []);
  assert.equal(secondsFromText('4:30'), 270);
});

test('주간 중복곡과 사용자 2곡 제한을 적용한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wekkly-'));
  let database;
  try {
    database = new MusicDatabase(join(directory, 'music.db'));
    const service = new PlaylistService(database, () => new Date('2026-07-12T01:00:00Z'));
    const song = (videoId) => ({ videoId, title: videoId, artist: 'Teto', url: `https://youtu.be/${videoId}`, durationSeconds: 200 });
    assert.equal(service.register('user-a', '월', song('one')).ok, true);
    assert.equal(service.register('user-b', '화', song('one')).ok, false);
    assert.equal(service.register('user-a', '화', song('two')).ok, true);
    assert.equal(service.register('user-a', '수', song('three')).ok, false);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Discord 명령어 JSON이 모두 생성된다', () => {
  const commands = commandData().map((command) => command.toJSON());
  assert.deepEqual(commands.map(({ name }) => name), ['도움말', '정보', '신청', '보기', '채널설정', '플리제한', '셔플', '삭제', 'db초기화']);
  assert.equal(commands.find(({ name }) => name === '정보').default_member_permissions, undefined);
  assert.equal(commands.find(({ name }) => name === '채널설정').default_member_permissions, '8');
  assert.equal(commands.find(({ name }) => name === '보기').options[0].required, false);
});

test('길드별 채널 설정을 SQLite에 영구 저장한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wekkly-settings-'));
  let database;
  try {
    const path = join(directory, 'music.db');
    database = new MusicDatabase(path);
    database.setGuildChannels('guild-a', 'request-a', 'announcement-a');
    database.close();
    database = new MusicDatabase(path);

    assert.deepEqual({ ...database.guildChannels('guild-a') }, {
      guild_id: 'guild-a', request_channel_id: 'request-a', announcement_channel_id: 'announcement-a', guide_message_id: null,
      weekly_message_id: null, weekly_message_key: null,
    });
    assert.equal(database.guildChannels('guild-b'), null);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('플리 잠금은 삭제한 곡 수를 반환한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wekkly-lock-'));
  let database;
  try {
    database = new MusicDatabase(join(directory, 'music.db'));
    database.addSong({ day: '월', videoId: 'one', title: 'One', artist: null, url: 'https://youtu.be/one', userId: 'user-a' });
    database.addSong({ day: '월', videoId: 'two', title: 'Two', artist: null, url: 'https://youtu.be/two', userId: 'user-b' });

    assert.equal(database.setLock('월', true, 'user-a'), 2);
    assert.equal(database.setLock('월', false), 0);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('길드 안내 메시지 ID를 안전하게 마이그레이션하고 영구 저장한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wekkly-guide-'));
  let database;
  try {
    const path = join(directory, 'music.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE guild_settings (
        guild_id TEXT PRIMARY KEY,
        request_channel_id TEXT NOT NULL,
        announcement_channel_id TEXT NOT NULL
      );
      INSERT INTO guild_settings VALUES ('guild-a', 'request-a', 'announcement-a');
    `);
    legacy.close();
    database = new MusicDatabase(path);
    database.setGuildGuideMessage('guild-a', 'guide-a');
    database.close();
    database = new MusicDatabase(path);

    assert.equal(database.guildChannels('guild-a').guide_message_id, 'guide-a');
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('미쿠 안내 캔버스를 PNG로 렌더링한다', async () => {
  const guide = await renderGuideCanvas();

  assert.deepEqual(guide.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(guide.length > 10_000);
});

test('안내 캔버스 문구는 자치회 용어를 사용한다', () => {
  const guideText = JSON.stringify(GUIDE_COPY);

  assert.match(guideText, /자치회 최소 3명/);
  assert.doesNotMatch(guideText, /평의회/);
});

test('채널 설정은 저장된 안내 메시지를 새로 만들지 않고 교체한다', async () => {
  const edits = [];
  const weeklyEdits = [];
  const sends = [];
  let savedMessageId;
  const guideMessage = { edit: async (payload) => edits.push(payload) };
  const requestChannel = {
    id: 'request-a', toString: () => '<#request-a>',
    isTextBased: () => true,
    messages: { fetch: async (id) => id === 'guide-a' ? guideMessage : { edit: async (payload) => weeklyEdits.push(payload) } },
    send: async (payload) => { sends.push(payload); return { id: 'new-guide' }; },
  };
  const announcementChannel = { id: 'announcement-a', toString: () => '<#announcement-a>' };
  const handler = new CommandHandler({
    database: {
      guildChannels: () => ({
        request_channel_id: 'request-a', announcement_channel_id: 'announcement-a', guide_message_id: 'guide-a',
        weekly_message_id: 'weekly-a', weekly_message_key: '2026-07-12',
      }),
      setGuildChannels: () => {},
      setGuildGuideMessage: (_guildId, messageId) => { savedMessageId = messageId; },
      setGuildWeeklyMessage: () => {},
      daySongs: () => [],
    },
    playlist: {}, search: {}, guildIds: ['guild-a'],
  });
  await handler.execute({
    commandName: '채널설정', guildId: 'guild-a',
    memberPermissions: { has: () => true },
    client: { channels: { fetch: async () => requestChannel } },
    options: { getChannel: (name) => name === '신청채널' ? requestChannel : announcementChannel },
    reply: async () => {},
  });

  assert.equal(edits.length, 1);
  assert.equal(edits[0].files[0].name, 'miku-guide.png');
  assert.deepEqual(edits[0].attachments, []);
  assert.equal(sends.length, 0);
  assert.equal(weeklyEdits.length, 1);
  assert.equal(savedMessageId, 'guide-a');
});

test('신청 명령은 길드에 설정된 신청 채널 밖에서 거절된다', async () => {
  const replies = [];
  const handler = new CommandHandler({
    database: { guildChannels: () => ({ request_channel_id: 'request-channel' }) },
    playlist: { validate: () => assert.fail('playlist validation should not run') },
    search: { search: () => assert.fail('search should not run') },
    guildIds: ['guild-a'],
  });
  await handler.execute({
    commandName: '신청', guildId: 'guild-a', channelId: 'other-channel',
    reply: async (payload) => replies.push(payload),
  });

  assert.match(replies[0].content, /<#request-channel>/);
});

test('여러 길드 ID를 중복 없이 읽는다', () => {
  assert.deepEqual(parseGuildIds('1263151654883295293, 1505572380905439403,1263151654883295293'), [
    '1263151654883295293',
    '1505572380905439403',
  ]);
});

test('한 길드 등록이 실패해도 나머지 길드를 등록한다', async () => {
  const calls = [];
  const rest = {
    async put(route) {
      calls.push(route);
      if (route.includes('1263151654883295293')) throw new Error('Missing Access');
    },
  };
  const failures = await registerCommands({
    rest,
    clientId: 'app',
    guildIds: ['1263151654883295293', '1505572380905439403'],
    body: [],
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(failures.map(({ guildId }) => guildId), ['1263151654883295293']);
});

test('마감 공지를 보내지 못하면 완료 처리하지 않는다', async () => {
  const meta = new Map();
  const database = {
    meta: (key) => meta.get(key) ?? null,
    setMeta: (key, value) => meta.set(key, value),
    daySongs: () => [{ title: '곡', url: 'https://youtu.be/song' }],
    setting: () => ({ locked: 0, exclusive_user_id: null }),
    guildChannels: () => null,
  };
  const scheduler = new Scheduler({
    client: { channels: { fetch: async () => null } },
    database,
    guildIds: ['guild-a'],
    now: () => new Date('2026-07-13T14:40:00Z'),
  });
  await scheduler.run();
  assert.equal(meta.has('last_close:guild-a'), false);
});

test('일부 마감 공지만 실패하면 성공한 채널에는 다시 보내지 않는다', async () => {
  const meta = new Map();
  let requestSends = 0;
  let announcementSends = 0;
  const announcement = {
    isTextBased: () => true,
    send: async () => {
      announcementSends += 1;
      if (announcementSends === 1) throw new Error('temporary');
    },
  };
  const request = {
    isTextBased: () => true,
    send: async () => {
      requestSends += 1;
      return { forward: async () => announcement.send() };
    },
  };
  const database = {
    meta: (key) => meta.get(key) ?? null,
    setMeta: (key, value) => meta.set(key, value),
    daySongs: () => [{ title: '곡', url: 'https://youtu.be/song' }],
    setting: () => ({ locked: 0, exclusive_user_id: null }),
    guildChannels: () => null,
  };
  const scheduler = new Scheduler({
    client: { channels: { fetch: async (id) => id === 'request' ? request : announcement } },
    database,
    guildIds: ['guild-a'],
    fallbackChannels: { request_channel_id: 'request', announcement_channel_id: 'announcement' },
    now: () => new Date('2026-07-13T14:40:00Z'),
  });
  await assert.rejects(() => scheduler.run(), /temporary/);
  await scheduler.run();
  assert.equal(requestSends, 1);
  assert.equal(announcementSends, 2);
  assert.equal(meta.has('last_close:guild-a'), true);
});

test('스케줄러는 길드별로 설정된 공지 채널을 사용한다', async () => {
  const meta = new Map();
  const sends = [];
  const database = {
    meta: (key) => meta.get(key) ?? null,
    setMeta: (key, value) => meta.set(key, value),
    daySongs: () => [{ title: '곡', url: 'https://youtu.be/song' }],
    setting: () => ({ locked: 0, exclusive_user_id: null }),
    guildChannels: (guildId) => ({
      request_channel_id: `${guildId}-request`, announcement_channel_id: `${guildId}-announcement`,
      weekly_message_id: 'weekly', weekly_message_key: '2026-07-12',
    }),
  };
  const scheduler = new Scheduler({
    client: { channels: { fetch: async (id) => ({ isTextBased: () => true, send: async () => sends.push(id) }) } },
    database,
    guildIds: ['guild-a', 'guild-b'],
    now: () => new Date('2026-07-13T14:40:00Z'),
  });
  await scheduler.run();

  assert.deepEqual(sends, [
    'guild-a-request', 'guild-a-announcement', 'guild-b-request', 'guild-b-announcement',
  ]);
});

test('봇이 늦게 시작해도 이번 주 현황 메시지를 한 번만 보낸다', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wekkly-status-'));
  let database;
  try {
    database = new MusicDatabase(join(directory, 'music.db'));
    database.setGuildChannels('guild-a', 'request-a', 'announcement-a');
    const sends = [];
    const channel = {
      isTextBased: () => true,
      messages: { fetch: async () => null },
      send: async (payload) => {
        sends.push(payload);
        return { id: 'weekly-a' };
      },
    };
    const scheduler = new Scheduler({
      client: { channels: { fetch: async () => channel } },
      database,
      guildIds: ['guild-a'],
      now: () => new Date('2026-07-13T03:00:00Z'),
    });

    await scheduler.run();
    await scheduler.run();

    assert.equal(sends.length, 1);
    assert.equal(sends[0].files[0].name, 'weekly-playlist.png');
    assert.deepEqual({ ...database.guildChannels('guild-a') }, {
      guild_id: 'guild-a', request_channel_id: 'request-a', announcement_channel_id: 'announcement-a',
      guide_message_id: null, weekly_message_id: 'weekly-a', weekly_message_key: '2026-07-12',
    });
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('검색 서버는 Tailscale IPv4만 외부 바인딩으로 허용한다', () => {
  assert.equal(isTailscaleIpv4('100.107.167.112'), true);
  assert.equal(isTailscaleIpv4('100.64.0.1'), true);
  assert.equal(isTailscaleIpv4('100.127.255.254'), true);
  assert.equal(isTailscaleIpv4('0.0.0.0'), false);
  assert.equal(isTailscaleIpv4('100.128.0.1'), false);
});
