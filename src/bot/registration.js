import { Routes } from 'discord.js';

export async function registerCommands({ rest, clientId, guildIds, body }) {
  if (!guildIds.length) {
    await rest.put(Routes.applicationCommands(clientId), { body });
    return [];
  }
  await rest.put(Routes.applicationCommands(clientId), { body: [] });
  const results = await Promise.allSettled(guildIds.map((guildId) => rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body },
  )));
  return results.flatMap((result, index) => result.status === 'rejected'
    ? [{ guildId: guildIds[index], error: result.reason }]
    : []);
}
