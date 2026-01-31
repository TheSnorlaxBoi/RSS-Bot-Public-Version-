// index.js
require('dotenv').config();
require('dns').setDefaultResultOrder('ipv4first');

const express = require('express');
const { Client, Events, GatewayIntentBits, EmbedBuilder, Collection } = require('discord.js');
const { Pool } = require('pg');
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');
const shutdown = require('./shutdown.js');

/* ---------------- config ---------------- */

let cfg = {};
try { cfg = require('./config.json'); } catch {}

const TOKEN = process.env.DISCORD_TOKEN || cfg.token;
const guildId = process.env.GUILD_ID || cfg.guildId;
const DATABASE_URL = process.env.DATABASE_URL || cfg.databaseUrl;

if (!TOKEN || !DATABASE_URL) {
  console.error('❌ Missing DISCORD_TOKEN or DATABASE_URL');
  process.exit(1);
}

/* ---------------- clients ---------------- */

const parser = new Parser({ customFields: { item: ['media:content', 'enclosure'] } });

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
});

pool.on('error', err => {
  console.error('🔥 Postgres pool error (ignored):', err.message);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});
client.commands = new Collection();

client.on('error', err => {
  console.error('❌ Discord client error:', err);
});

client.on('shardError', err => {
  console.error('❌ Discord shard error:', err);
});

client.on('disconnect', event => {
  console.error('❌ Discord disconnected:', event);
});

client.on('debug', msg => {
  if (
    msg.includes('IDENTIFY') ||
    msg.includes('READY') ||
    msg.includes('RESUME') ||
    msg.includes('Invalid')
  ) {
    console.log('[discord debug]', msg);
  }
});

/* ---------------- command loader ---------------- */

const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  for (const f of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const c = require(path.join(commandsPath, f));
    if (c.data && c.execute) client.commands.set(c.data.name, c);
  }
}

/* ---------------- constants ---------------- */

const UPDATE_INTERVAL = 1000 * 60 * 5;
let isCheckingFeeds = false; // execution lock

/* ---------------- database ---------------- */

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feeds (
      id SERIAL PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      channel_id TEXT NOT NULL,
      last_pub_date TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sent_items (
      feed_url TEXT NOT NULL,
      item_id TEXT NOT NULL,
      sent_at TIMESTAMP DEFAULT now(),
      UNIQUE (feed_url, item_id)
    );
  `);
}

async function ensureTablesWithRetry(retries = 5) {
  while (retries--) {
    try {
      await ensureTables();
      console.log('✅ DB ready');
      return;
    } catch (e) {
      console.warn('⏳ DB not ready, retrying...', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  throw new Error('DB unavailable');
}

async function getFeeds() {
  const res = await pool.query('SELECT * FROM feeds ORDER BY id');
  return res.rows;
}

/* ---------------- rss helpers ---------------- */

function getUniqueId(item) {
  return item.guid || item.id || item.link || item.title;
}

function getDate(item) {
  return new Date(item.pubDate || item.isoDate || 0);
}

function extractImage(item) {
  if (item['media:content']?.$?.url) return item['media:content'].$.url;
  if (item.enclosure?.url) return item.enclosure.url;
  const m = item.content?.match(/<img[^>]+src="([^">]+)"/i);
  return m ? m[1] : null;
}

/* ---------------- dedupe insert ---------------- */

async function markAsSent(feedUrl, itemId) {
  const res = await pool.query(
    `INSERT INTO sent_items (feed_url, item_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [feedUrl, itemId]
  );
  return res.rowCount === 1; // true = first time
}

/* ---------------- fetch + send ---------------- */

async function fetchAndSend(feed) {
  const data = await parser.parseURL(feed.url);
  if (!data.items?.length) return;

  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(feed.channel_id);
  if (!channel) return;

  const items = data.items.sort((a, b) => getDate(a) - getDate(b));

  for (const item of items) {
    const itemId = getUniqueId(item);
    if (!itemId) continue;

    // 🔐 HARD DEDUPE (insert-before-send)
    const shouldSend = await markAsSent(feed.url, itemId);
    if (!shouldSend) continue;

    const embed = new EmbedBuilder()
      .setColor(0x9877d7)
      .setTitle(item.title || 'Untitled')
      .setURL(item.link)
      .setDescription(item.contentSnippet?.slice(0, 300) || '')
      .setTimestamp(getDate(item))
      .setFooter({ text: data.title || feed.url });

    const img = extractImage(item);
    if (img) embed.setImage(img);

    await channel.send({ embeds: [embed] });
    console.log(`📨 Sent: ${item.title}`);
  }
}

/* ---------------- lifecycle ---------------- */

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await ensureTablesWithRetry();

  setInterval(async () => {
    if (isCheckingFeeds) return;
    isCheckingFeeds = true;
    try {
      const feeds = await getFeeds();
      for (const f of feeds) await fetchAndSend(f);
    } catch (e) {
      console.error('❌ Feed loop error:', e.message);
    } finally {
      isCheckingFeeds = false;
    }
  }, UPDATE_INTERVAL);
});

client.on(Events.InteractionCreate, async i => {
  if (!i.isChatInputCommand()) return;
  const cmd = client.commands.get(i.commandName);
  if (!cmd) return;
  await cmd.execute(i, pool);
});

client.login(TOKEN);

/* ---------------- keep-alive server ---------------- */

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('RSS Bot running'));
app.get('/ping', (_, res) => res.send('pong'));
app.listen(PORT, () => console.log(`🌐 Listening on ${PORT}`));
