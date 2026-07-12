import { secondsFromText } from '../shared/constants.js';

function text(value) {
  if (typeof value === 'string') return value;
  if (typeof value?.text === 'string') return value.text;
  if (typeof value?.toString === 'function') {
    const result = value.toString();
    if (result !== '[object Object]') return result;
  }
  return null;
}

function array(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value[Symbol.iterator] === 'function') return [...value];
  return array(value.contents ?? value.items);
}

function thumbnail(item) {
  const candidates = item?.thumbnail?.contents ?? item?.thumbnail?.thumbnails ?? item?.thumbnails ?? [];
  return array(candidates).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;
}

export function parseMusicItem(item) {
  const id = item?.id ?? item?.video_id ?? item?.endpoint?.payload?.videoId ?? item?.endpoint?.payload?.video_id;
  if (!id) return null;
  const title = text(item?.title) ?? text(item?.name);
  if (!title) return null;
  const artistValues = array(item?.artists ?? item?.authors);
  const artists = artistValues.map((artist) => text(artist?.name ?? artist)).filter(Boolean);
  const author = artists.join(', ') || text(item?.author?.name ?? item?.author) || text(item?.channel?.name ?? item?.channel);
  const durationText = text(item?.duration) ?? text(item?.duration_text) ?? text(item?.length_text);
  const durationSeconds = item?.duration?.seconds ?? item?.duration_seconds;
  return {
    videoId: id,
    title,
    artist: author || null,
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnailUrl: thumbnail(item),
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : secondsFromText(durationText),
  };
}

export function parseSearch(search, limit) {
  const sources = [search?.results, search?.videos, search?.contents, search?.items].filter(Boolean);
  const items = sources.flatMap(array);
  const unique = new Map();
  for (const item of items) {
    const parsed = parseMusicItem(item);
    if (parsed && !unique.has(parsed.videoId)) unique.set(parsed.videoId, parsed);
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}

function secondsFromIsoDuration(value) {
  const match = /^P(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?)?$/.exec(value ?? '');
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600
    + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0);
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}

export async function enrichMusicVideos(results, apiKey, fetchImpl = fetch) {
  if (!apiKey || results.length === 0) return results;
  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    id: results.map(({ videoId }) => videoId).join(','),
    key: apiKey,
  });
  const response = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  if (!response.ok) throw new Error(`YouTube Data API request failed (${response.status})`);
  const payload = await response.json();
  const details = new Map(array(payload?.items).map((item) => [item?.id, item]));

  return results.flatMap((result) => {
    const item = details.get(result.videoId);
    if (!item || String(item?.snippet?.categoryId) !== '10') return [];
    return [{
      ...result,
      artist: text(item?.snippet?.channelTitle) ?? result.artist,
      durationSeconds: secondsFromIsoDuration(item?.contentDetails?.duration) ?? result.durationSeconds,
    }];
  });
}
