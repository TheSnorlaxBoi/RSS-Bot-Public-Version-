const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listfeeds')
    .setDescription('List all feeds and their channels.'),
  async execute(interaction, pool) {
    const res = await pool.query('SELECT * FROM feeds ORDER BY id');
    if (res.rowCount === 0)
      return interaction.reply('📭 No feeds added yet.');
    const text = res.rows.map(r => `🔗 ${r.url}\n➡️ <#${r.channel_id}>`).join('\n\n');
    await interaction.reply(`📜 **Feeds:**\n\n${text}`);
  },
};