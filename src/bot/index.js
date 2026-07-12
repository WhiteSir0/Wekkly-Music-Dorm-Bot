import 'dotenv/config';
import { ActivityType, Client, Collection, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import { commandData, CommandHandler } from './commands.js';
import { MusicDatabase } from './database.js';
import { PlaylistService } from './playlistService.js';
import { SearchClient } from './searchClient.js';
import { Scheduler } from './scheduler.js';
import { parseGuildIds } from './config.js';

const required = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'SEARCH_API_URL', 'SEARCH_API_TOKEN'];
for (const name of required) if (!process.env[name]?.trim()) throw new Error(`${name} is required`);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const database = new MusicDatabase(process.env.DB_PATH ?? '/app/data/music.db');
const playlist = new PlaylistService(database);
const search = new SearchClient(process.env.SEARCH_API_URL, process.env.SEARCH_API_TOKEN);
const guildIds = parseGuildIds(process.env.DISCORD_GUILD_IDS);
const handler = new CommandHandler({ database, playlist, search, guildIds });
client.commands = new Collection(commandData().map((command) => [command.name, command]));

client.once(Events.ClientReady, async (readyClient) => {
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  const body = commandData().map((command) => command.toJSON());
  if (guildIds.length) {
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: [] });
    await Promise.all(guildIds.map((guildId) => rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
      { body },
    )));
  } else {
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body });
  }
  readyClient.user.setPresence({ activities: [{ name: '/도움말', type: ActivityType.Listening }], status: 'online' });
  new Scheduler({
    client: readyClient,
    database,
    requestChannelId: process.env.SONG_REQUEST_CHANNEL_ID?.trim() || null,
    announcementChannelId: process.env.SONG_ANNOUNCEMENT_CHANNEL_ID?.trim() || null,
  }).start();
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId.startsWith('song:')) await handler.button(interaction);
    else if (interaction.isChatInputCommand()) await handler.execute(interaction);
  } catch (error) {
    console.error('[interaction]', error);
    const payload = { content: '처리 중 오류가 발생했습니다.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

await client.login(process.env.DISCORD_BOT_TOKEN);
