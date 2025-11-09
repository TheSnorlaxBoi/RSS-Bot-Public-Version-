import { SlashCommandBuilder } from 'discord.js';

// --- CONFIGURATION ---
// !!! IMPORTANT: Replace this with your actual Discord User ID.
// This ensures only YOU can run the shutdown command.
const OWNER_ID = 'YOUR_OWNER_USER_ID_HERE';

export const data = new SlashCommandBuilder()
    .setName('shutdown')
    .setDescription('Authorized command to safely shut down the bot process.');

/**
 * Executes the shutdown command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction The interaction object.
 */
export async function execute(interaction) {
    console.log(`[SHUTDOWN] Attempt received from user: ${interaction.user.tag} (${interaction.user.id})`);

    // --- 1. SECURITY CHECK: ONLY THE OWNER CAN SHUTDOWN ---
    if (interaction.user.id !== OWNER_ID) {
        console.warn(`[SHUTDOWN] Unauthorized attempt by ${interaction.user.tag}.`);
        return interaction.reply({
            content: '🚫 Access Denied: Only the authorized bot owner can execute the shutdown command.',
            ephemeral: true // Only the user who ran the command sees this
        });
    }

    // --- 2. EXECUTION & GRACEFUL EXIT ---

    // Acknowledge the command immediately.
    await interaction.reply({
        content: '🤖 Initiating graceful shutdown... Goodbye!',
        ephemeral: false
    });

    // Log the event
    console.log(`[SHUTDOWN] Shutdown initiated by ${interaction.user.tag}.`);

    // Set a brief delay (1 second) to ensure the reply is successfully sent to Discord
    // before the Node.js process is terminated.
    setTimeout(() => {
        console.log(`[SHUTDOWN] Bot process exiting now (PID: ${process.pid}).`);
        // Use interaction.client to access the running bot client
        interaction.client.destroy(); // Clean up client connections
        process.exit(0);   // Exit the Node.js process with a success code
    }, 1000);
}
