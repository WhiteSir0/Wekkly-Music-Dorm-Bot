import { z } from 'zod';

const resultSchema = z.object({
  videoId: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().nullable(),
  url: z.string().url(),
  thumbnailUrl: z.string().url().nullable(),
  durationSeconds: z.number().int().positive().nullable(),
});

export class SearchClient {
  constructor(url, token) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  async search(query, limit = 3) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${this.url}/search`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query, limit }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`검색 서버 오류 (${response.status})`);
      const payload = z.object({ results: z.array(resultSchema) }).parse(await response.json());
      return payload.results;
    } finally {
      clearTimeout(timeout);
    }
  }
}
