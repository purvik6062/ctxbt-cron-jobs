const { connect } = require('../db/index');

const TWEETSCOUT_API_URL = 'https://api.tweetscout.io/v2/check-follow';
const TWEETSCOUT_API_KEY = process.env.TWEETSCOUT_API_KEY;

/**
 * Checks if all users in the database follow a specific Twitter account and updates their follow status.
 * @param {string} project_handle - The project handle to check follows for.
 * @returns {Promise<Array>} - Array of results for each user.
 */
async function verifyAndUpdateAllUsersFollow(project_handle) {
  const client = await connect();
  const db = client.db("ctxbt-signal-flow");
  const usersCollection = db.collection("users");

  // Fetch all users
  const users = await usersCollection.find({}).toArray();

  // For each user, check if they follow the target account and update the DB
  const results = await Promise.all(users.map(async function(user) {
    // Use user_id if available, otherwise user_handle
    const body = JSON.stringify({
      project_handle: project_handle,
      user_handle: user.twitterUsername,
      user_id: user.twitterId
    });

    try {
      const response = await fetch(TWEETSCOUT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ApiKey: TWEETSCOUT_API_KEY
        },
        body: body
      });

      const data = await response.json();

      // Update the user document with follow status
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            follow: data.follow,
            user_protected: data.user_protected
          },
          $inc: {
            credits: data.follow ? 100 : 0
          }
        }
      );

      return {
        twitterUsername: user.twitterUsername,
        twitterId: user.twitterId,
        follow: data.follow,
        user_protected: data.user_protected
      };
    } catch (error) {
      // Optionally update the user with error info
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            follow: null,
            follow_error: error.message || error
          }
        }
      );
      return {
        twitterUsername: user.twitterUsername,
        twitterId: user.twitterId,
        error: error.message || error
      };
    }
  }));

  return results;
}

module.exports = {
  verifyAndUpdateAllUsersFollow
};

if (require.main === module) {
  const project_handle = 'triggerxnetwork';

  (async function() {
    try {
      const results = await verifyAndUpdateAllUsersFollow(project_handle);
      console.log("Follow check results:", results);
    } catch (err) {
      console.error("Error running verifyAndUpdateAllUsersFollow:", err);
    } finally {
      process.exit();
    }
  })();
}
