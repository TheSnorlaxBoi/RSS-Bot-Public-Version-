// deploy-commands.js
// Registers all commands in ./commands as guild commands (fast) or global (slow).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.APP_ID || process.env.CLIENT_ID; // set on Render
const guildId = process.env.GUILD_ID; // optional: for guild-scoped commands (fast)

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or APP_ID/CLIENT_ID in env. Aborting.');
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
if (!fs.existsSync(commandsPath)) {
  console.error('No commands folder found. Nothing to register.');
  process.exit(0);
}

for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command && command.data) {
    // command.data should be a SlashCommandBuilder or an object with toJSON()
    commands.push(command.data.toJSON ? command.data.toJSON() : command.data);
  }
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    if (guildId) {
      // Guild commands update instantly — good for dev
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands },
      );
      console.log(`Successfully registered commands for guild ${guildId}.`);
    } else {
      // Global commands can take up to 1 hour to propagate
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands },
      );
      console.log('Successfully registered global commands.');
    }
  } catch (error) {
    console.error('Failed to register commands:', error);
    process.exit(1);
  }
})();
