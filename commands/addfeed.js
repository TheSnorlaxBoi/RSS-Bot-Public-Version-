const { SlashCommandBuilder, ChannelType } = require('discord.js');
const Parser = require('rss-parser');
const parser = new Parser();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addfeed')
    .setDescription('Add an RSS feed and link it to a channel.')
    .addStringOption(o => o.setName('url').setDescription('Feed URL').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),

  async execute(interaction, pool) {
    const url = interaction.options.getString('url');
    const channel = interaction.options.getChannel('channel');

    // Check if exists
    const exists = await pool.query('SELECT * FROM feeds WHERE url=$1', [url]);
    if (exists.rowCount > 0)
      return interaction.reply({ content: 'Feed already exists.', ephemeral: true });

    // Try to fetch and baseline
    let lastSentId = null;
    try {
      const data = await parser.parseURL(url);
      if (data.items?.length) {
        data.items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
        lastSentId = data.items[0].link || data.items[0].guid || data.items[0].title;
      }
    } catch (err) {
      return interaction.reply({ content: `Failed to fetch feed: ${err.message}`, ephemeral: true });
    }

    await pool.query(
      'INSERT INTO feeds (url, channel_id, last_sent_id) VALUES ($1, $2, $3)',
      [url, channel.id, lastSentId]
    );

    await interaction.reply(`✅ Added feed:\n${url}\n➡️ <#${channel.id}>\n(Starting from latest article)`);
  },
};