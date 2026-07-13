import 'dotenv/config';
import { ActivityType, Client, Collection, Events, GatewayIntentBits, REST } from 'discord.js';
import { commandData, CommandHandler } from './commands.js';
import { MusicDatabase } from './database.js';
import { PlaylistService } from './playlistService.js';
import { SearchClient } from './searchClient.js';
import { Scheduler } from './scheduler.js';
import { parseGuildIds } from './config.js';
import { registerCommands } from './registration.js';
import { ensureWeeklyStatus, weekKey } from './playlistStatus.js';
import { kstNow } from '../shared/constants.js';
import { MIKU_TRACKS } from '../shared/mikuTracks.js';
import { RegisteredUsers } from './registeredUsers.js';

const required = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_IDS', 'SEARCH_API_URL', 'SEARCH_API_TOKEN'];
for (const name of required) if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
if (process.env.SEARCH_API_TOKEN.trim().length < 32) throw new Error('SEARCH_API_TOKEN must be at least 32 characters');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const database = new MusicDatabase(process.env.DB_PATH ?? '/app/data/music.db');
const playlist = new PlaylistService(database);
const search = new SearchClient(process.env.SEARCH_API_URL, process.env.SEARCH_API_TOKEN);
const registeredUsers = new RegisteredUsers(process.env.DORM_DATABASE_PATH ?? '/app/dorm-users');
const guildIds = parseGuildIds(process.env.DISCORD_GUILD_IDS);
if (!guildIds.length) throw new Error('DISCORD_GUILD_IDS is required');
const fallbackChannels = process.env.SONG_REQUEST_CHANNEL_ID?.trim() && process.env.SONG_ANNOUNCEMENT_CHANNEL_ID?.trim()
  ? {
      request_channel_id: process.env.SONG_REQUEST_CHANNEL_ID.trim(),
      announcement_channel_id: process.env.SONG_ANNOUNCEMENT_CHANNEL_ID.trim(),
    }
  : null;
const handler = new CommandHandler({
  database, playlist, search, guildIds, fallbackChannels,
  userNames: (guildId, userId) => registeredUsers.name(guildId, userId),
});
client.commands = new Collection(commandData().map((command) => [command.name, command]));

client.once(Events.ClientReady, async (readyClient) => {
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  const body = commandData().map((command) => command.toJSON());
  const failures = await registerCommands({ rest, clientId: process.env.DISCORD_CLIENT_ID, guildIds, body });
  for (const failure of failures) {
    console.warn('길드 명령어 등록 건너뜀', { guildId: failure.guildId, code: failure.error?.code ?? 'unknown' });
  }
  let presenceIndex = Math.floor(Math.random() * MIKU_TRACKS.length);
  const updatePresence = () => {
    const [title, artist] = MIKU_TRACKS[presenceIndex % MIKU_TRACKS.length];
    readyClient.user.setPresence({ activities: [{ name: `${title} - ${artist}`, type: ActivityType.Listening }], status: 'online' });
    presenceIndex += 1;
  };
  updatePresence();
  setInterval(updatePresence, 3 * 60_000);
  for (const song of database.songsWithoutUserName()) {
    for (const guildId of guildIds) {
      const guild = await readyClient.guilds.fetch(guildId).catch(() => null);
      const member = await guild?.members.fetch(song.user_id).catch(() => null);
      if (member) {
        database.setSongUserName(song.id, member.displayName);
        break;
      }
    }
  }
  for (const guildId of guildIds) {
    await ensureWeeklyStatus({
      client: readyClient, database, guildId, key: weekKey(kstNow()), forceEdit: true,
    }).catch((error) => console.error('[weekly status]', error));
  }
  new Scheduler({
    client: readyClient,
    database,
    guildIds,
    fallbackChannels,
  }).start();
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId.startsWith('song:')) await handler.button(interaction);
    else if (interaction.isButton() && interaction.customId.startsWith('playlist:report:')) await handler.reportButton(interaction);
    else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('playlist:song:')) await handler.playlistSong(interaction);
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('playlist:report:')) await handler.reportSubmit(interaction);
    else if (interaction.isAutocomplete()) await handler.autocomplete(interaction);
    else if (interaction.isChatInputCommand()) await handler.execute(interaction);
  } catch (error) {
    console.error('[interaction]', error);
    const payload = { content: '처리 중 오류가 발생했습니다.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

await client.login(process.env.DISCORD_BOT_TOKEN);
