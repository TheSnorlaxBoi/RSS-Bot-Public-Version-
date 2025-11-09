const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removefeed')
    .setDescription('Remove a feed by URL.')
    .addStringOption(o => o.setName('url').setDescription('Feed URL').setRequired(true)),

  async execute(interaction, pool) {
    const url = interaction.options.getString('url');
    const res = await pool.query('DELETE FROM feeds WHERE url=$1 RETURNING *', [url]);
    if (res.rowCount === 0)
      return interaction.reply({ content: 'Feed not found.', ephemeral: true });
    await interaction.reply(`🗑️ Removed feed: ${url}`);
  },
};