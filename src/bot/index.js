import 'dotenv/config';
import { ActivityType, Client, Collection, Events, GatewayIntentBits, REST } from 'discord.js';
import { commandData, CommandHandler } from './commands.js';
import { MusicDatabase } from './database.js';
import { PlaylistService } from './playlistService.js';
import { SearchClient } from './searchClient.js';
import { Scheduler } from './scheduler.js';
import { parseGuildIds } from './config.js';
import { registerCommands } from './registration.js';

const required = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_IDS', 'SEARCH_API_URL', 'SEARCH_API_TOKEN'];
for (const name of required) if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
if (process.env.SEARCH_API_TOKEN.trim().length < 32) throw new Error('SEARCH_API_TOKEN must be at least 32 characters');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const database = new MusicDatabase(process.env.DB_PATH ?? '/app/data/music.db');
const playlist = new PlaylistService(database);
const search = new SearchClient(process.env.SEARCH_API_URL, process.env.SEARCH_API_TOKEN);
const guildIds = parseGuildIds(process.env.DISCORD_GUILD_IDS);
if (!guildIds.length) throw new Error('DISCORD_GUILD_IDS is required');
const handler = new CommandHandler({ database, playlist, search, guildIds });
client.commands = new Collection(commandData().map((command) => [command.name, command]));

client.once(Events.ClientReady, async (readyClient) => {
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  const body = commandData().map((command) => command.toJSON());
  const failures = await registerCommands({ rest, clientId: process.env.DISCORD_CLIENT_ID, guildIds, body });
  for (const failure of failures) {
    console.warn('길드 명령어 등록 건너뜀', { guildId: failure.guildId, code: failure.error?.code ?? 'unknown' });
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
