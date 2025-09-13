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
    const signalsCollection = db.collection("trading-signals");

    // Get all users to remove them from subscribers arrays
    const users = await usersCollection.find({}, { projection: { username: 1 } }).toArray();
    const usernames = users.map(user => user.username);

    // Update all users to set credits to 0
    const userUpdateResult = await usersCollection.updateMany(
      {},
      {
        $set: {
          credits: 0,
          credits_reset_at: new Date()
        }
      }
    );

    // Remove all users from subscribers arrays in trading-signals
    const signalsUpdateResult = await signalsCollection.updateMany(
      {},
      {
        $pull: {
          subscribers: {
            username: { $in: usernames }
          }
        }
      }
    );

    console.log("Credits reset for all users:", userUpdateResult);
    console.log("Users removed from trading-signals subscribers:", signalsUpdateResult);
    return {
      userUpdateResult,
      signalsUpdateResult
    };
  } catch (error) {
    console.error("Error resetting credits and removing subscribers:", error);
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
