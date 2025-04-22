const { connect, closeConnection } = require('../db/index');

/**
 * Resets the credits of all users to zero.
 * @returns {Promise<Object>} - Result of the database operation.
 */
async function resetAllUsersCredits() {
  const client = await connect();
  try {
    const db = client.db("ctxbt-signal-flow");
    const usersCollection = db.collection("users");

    // Update all users to set credits to 0
    const result = await usersCollection.updateMany(
      {},
      {
        $set: {
          credits: 0,
          credits_reset_at: new Date()
        }
      }
    );

    console.log("Credits reset for all users:", result);
    return result;
  } catch (error) {
    console.error("Error resetting credits:", error);
    throw error;
  } finally {
    await closeConnection(client);
  }
}

module.exports = {
  resetAllUsersCredits
};

// For testing: run with `node src/services/zeroCredits.js`
if (require.main === module) {
  (async function () {
    try {
      await resetAllUsersCredits();
      console.log("Successfully reset credits for all users.");
    } catch (err) {
      console.error("Error resetting credits:", err);
    } finally {
      process.exit();
    }
  })();
}
