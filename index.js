// index.js
// Render-ready: tiny Express server + env var fallbacks
require('dotenv').config();

const express = require('express');
const { Client, Events, GatewayIntentBits, EmbedBuilder, Collection } = require('discord.js');
const { Pool } = require('pg');
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

// config.json fallback (local dev)
let cfg = {};
try { cfg = require('./config.json'); } catch (e) { /* ignore if missing */ }

const TOKEN = process.env.DISCORD_TOKEN || cfg.token;
const guildId = process.env.GUILD_ID || cfg.guildId;
const DATABASE_URL = process.env.DATABASE_URL || cfg.databaseUrl || process.env.DATABASE_URL;

if (!TOKEN) {
  console.error('❌ No Discord token found. Set DISCORD_TOKEN env var or add token to config.json');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('❌ No DATABASE_URL found. Set DATABASE_URL env var (Postgres connection string).');
  process.exit(1);
}

const parser = new Parser({ customFields: { item: ['media:content', 'enclosure'] } });
const pool = new Pool({ 
  connectionString: DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
client.commands = new Collection();

// load commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  for (const f of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const c = require(path.join(commandsPath, f));
    if ('data' in c && 'execute' in c) client.commands.set(c.data.name, c);
  }
}

const UPDATE_INTERVAL = 1000 * 60 * 5;

// ---------- database helpers ----------
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feeds (
      id SERIAL PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      channel_id TEXT NOT NULL,
      last_sent_id TEXT,
      last_pub_date TEXT
    );
  `);
}

async function getFeeds() {
  const res = await pool.query('SELECT * FROM feeds ORDER BY id');
  return res.rows;
}
async function updateFeed(url, id, pubDate) {
  await pool.query(
    'UPDATE feeds SET last_sent_id=$1, last_pub_date=$2 WHERE url=$3',
    [id, pubDate, url]
  );
}

// ---------- rss helpers ----------
function getUniqueId(item) {
  return item.link || item.guid || item.id || item.title;
}
function getDate(item) {
  return new Date(item.pubDate || item.isoDate || 0);
}
function extractImage(item) {
  if (item['media:content']?.$?.url) return item['media:content'].$.url;
  if (item.enclosure?.url) return item.enclosure.url;
  const match = item.content?.match(/<img[^>]+src="([^">]+)"/i);
  return match ? match[1] : null;
}

// set initial baselines (no send)
async function initializeBaselines() {
  const feeds = await getFeeds();
  for (const f of feeds) {
    try {
      const data = await parser.parseURL(f.url);
      if (!data.items?.length) continue;
      data.items.sort((a, b) => getDate(b) - getDate(a));
      const latest = data.items[0];
      await updateFeed(f.url, getUniqueId(latest), latest.pubDate || latest.isoDate || null);
      console.log(`[baseline] ${f.url} → ${latest.title}`);
    } catch (e) {
      console.error(`[baseline] ${f.url} failed: ${e.message}`);
    }
  }
}

// main fetch
async function fetchAndSend(feed) {
  try {
    const data = await parser.parseURL(feed.url);
    if (!data.items?.length) return;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = guild.channels.cache.get(feed.channel_id);
    if (!channel) return;

    // sort oldest→newest
    const items = data.items.sort((a, b) => getDate(a) - getDate(b));
    const lastDate = feed.last_pub_date ? new Date(feed.last_pub_date) : null;
    let sent = 0;

    for (const item of items) {
      const pub = getDate(item);
      if (lastDate && pub <= lastDate) continue; // skip old or same-date
      const embed = new EmbedBuilder()
        .setColor(0x9877d7)
        .setAuthor({ name: 'RSS Bot', iconURL: 'https://i.imgur.com/ukQ6Ukh.gif' })
        .setTitle(item.title || 'Untitled')
        .setURL(item.link)
        .setDescription(item.contentSnippet?.slice(0, 300) || item.pubDate || '')
        .setTimestamp(pub)
        .setFooter({ text: data.title || feed.url });

      const img = extractImage(item);
      if (img) embed.setImage(img);

      await channel.send({ embeds: [embed] });
      await updateFeed(feed.url, getUniqueId(item), item.pubDate || item.isoDate || null);
      sent++;
    }

    if (sent) console.log(`✅ Sent ${sent} new from ${feed.url}`);
  } catch (err) {
    console.error(`❌ Fetch ${feed.url}: ${err.message}`);
  }
}

// ---------- bot lifecycle ----------
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await ensureTable();
  await initializeBaselines();

  setInterval(async () => {
    const feeds = await getFeeds();
    for (const f of feeds) await fetchAndSend(f);
  }, UPDATE_INTERVAL);
});

client.on(Events.InteractionCreate, async i => {
  if (!i.isChatInputCommand()) return;
  const cmd = client.commands.get(i.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(i, pool);
  } catch (err) {
    console.error(err);
    await i.reply({ content: 'Error executing command.', ephemeral: true });
  }
});

client.login(TOKEN);

// ---------- tiny Express keep-alive server ----------
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('RSS Delivery Bot is running.'));
app.get('/ping', (req, res) => res.send('pong'));

app.listen(PORT, () => {
  console.log(`🌐 Keep-alive server listening on port ${PORT}`);
});
