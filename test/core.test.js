import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { allowedDays, secondsFromText } from '../src/shared/constants.js';
import { MusicDatabase } from '../src/bot/database.js';
import { PlaylistService } from '../src/bot/playlistService.js';
import { enrichMusicVideos, parseMusicItem, parseSearch } from '../src/search/resultParser.js';
import { commandData } from '../src/bot/commands.js';
import { parseGuildIds } from '../src/bot/config.js';
import { registerCommands } from '../src/bot/registration.js';
import { Scheduler } from '../src/bot/scheduler.js';
import { isTailscaleIpv4 } from '../src/search/config.js';

test('general YouTube search parsing handles iterables, author objects, and length text', () => {
  const results = new Set([
    {
      video_id: 'video-1', title: { toString: () => 'General result' }, author: { name: 'Channel name' },
      length_text: { text: '1:02:03' }, thumbnails: [{ url: 'https://img/one.jpg', width: 320 }],
    },
    { video_id: 'video-1', title: 'Duplicate' },
    { title: 'Not a video' },
  ]);
  assert.deepEqual(parseSearch({ results }, 10), [{
    videoId: 'video-1', title: 'General result', artist: 'Channel name',
    url: 'https://www.youtube.com/watch?v=video-1', thumbnailUrl: 'https://img/one.jpg', durationSeconds: 3723,
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
    id: 'abc123', title: { text: '테스트 곡' }, artists: [{ name: '重音テト' }],
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
  assert.deepEqual(commands.map(({ name }) => name), ['도움말', '신청', '보기', '플리제한', '셔플', '삭제', 'db초기화']);
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
  };
  const scheduler = new Scheduler({
    client: { channels: { fetch: async () => null } },
    database,
    requestChannelId: null,
    announcementChannelId: null,
    now: () => new Date('2026-07-13T14:40:00Z'),
  });
  await scheduler.run();
  assert.equal(meta.has('last_close'), false);
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
  };
  const scheduler = new Scheduler({
    client: { channels: { fetch: async (id) => id === 'request' ? request : announcement } },
    database,
    requestChannelId: 'request',
    announcementChannelId: 'announcement',
    now: () => new Date('2026-07-13T14:40:00Z'),
  });
  await assert.rejects(() => scheduler.run(), /temporary/);
  await scheduler.run();
  assert.equal(requestSends, 1);
  assert.equal(announcementSends, 2);
  assert.equal(meta.has('last_close'), true);
});

test('검색 서버는 Tailscale IPv4만 외부 바인딩으로 허용한다', () => {
  assert.equal(isTailscaleIpv4('100.107.167.112'), true);
  assert.equal(isTailscaleIpv4('100.64.0.1'), true);
  assert.equal(isTailscaleIpv4('100.127.255.254'), true);
  assert.equal(isTailscaleIpv4('0.0.0.0'), false);
  assert.equal(isTailscaleIpv4('100.128.0.1'), false);
});
