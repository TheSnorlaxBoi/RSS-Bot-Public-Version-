// shutdown.js
module.exports = async (client, reason = "Manual shutdown") => {
  try {
    console.log(`\n🔻 Shutting down bot... Reason: ${reason}`);

    // Optional: clear any intervals or timeouts
    if (client.intervals) {
      for (const interval of client.intervals) clearInterval(interval);
      console.log("🕒 Cleared all intervals.");
    }

    // Optional: close database connections
    if (client.db && client.db.destroy) {
      await client.db.destroy();
      console.log("💾 Database connection closed.");
    }

    // Log out Discord client
    if (client.isReady()) {
      await client.destroy();
      console.log("👋 Discord client logged out.");
    }

    console.log("✅ Shutdown complete. Exiting process...");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during shutdown:", error);
    process.exit(1);
  }
};
