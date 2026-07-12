import 'dotenv/config';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Innertube, UniversalCache } from 'youtubei.js';
import { z } from 'zod';
import { enrichMusicVideos, parseSearch } from './resultParser.js';

const token = process.env.SEARCH_API_TOKEN?.trim();
if (!token) throw new Error('SEARCH_API_TOKEN is required');
const host = process.env.SEARCH_HOST ?? '0.0.0.0';
const port = Number(process.env.SEARCH_PORT ?? 4310);
const bodySchema = z.object({ query: z.string().trim().min(1).max(100), limit: z.number().int().min(1).max(10).default(3) });
let clientPromise;

function authorized(value) {
  const given = Buffer.from(value ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function youtubeClient() {
  clientPromise ??= Innertube.create({ cache: new UniversalCache(true), generate_session_locally: true });
  return clientPromise;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      json(response, 200, { ok: true, region: process.env.SEARCH_REGION ?? 'JP' });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/search') {
      json(response, 404, { error: 'not_found' });
      return;
    }
    if (!authorized(request.headers.authorization)) {
      json(response, 401, { error: 'unauthorized' });
      return;
    }
    const input = bodySchema.parse(await readBody(request));
    const youtube = await youtubeClient();
    const search = await youtube.search(input.query, { type: 'video' });
    const apiKey = process.env.YOUTUBE_API_KEY?.trim();
    const candidates = parseSearch(search, apiKey ? 50 : input.limit);
    const results = await enrichMusicVideos(candidates, apiKey);
    json(response, 200, { results: results.slice(0, input.limit) });
  } catch (error) {
    const badRequest = error instanceof z.ZodError || error instanceof SyntaxError || error?.message === 'body_too_large';
    console.error('[search]', error instanceof Error ? error.message : error);
    json(response, badRequest ? 400 : 502, { error: badRequest ? 'invalid_request' : 'search_failed' });
  }
});

server.listen(port, host, () => console.log(`Search API listening on ${host}:${port}`));
