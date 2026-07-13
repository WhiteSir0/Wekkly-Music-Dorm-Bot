import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const usersSchema = z.record(z.string(), z.string().trim().min(1));

export class RegisteredUsers {
  constructor(path) {
    this.path = path;
  }

  async name(guildId, userId) {
    try {
      const path = join(this.path, `${guildId}.json`);
      const users = usersSchema.parse(JSON.parse(await readFile(path, 'utf8')));
      return users[userId] ?? null;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }
}
