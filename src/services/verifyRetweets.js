const { connect } = require('../db/index');

const TWEETSCOUT_API_URL = 'https://api.tweetscout.io/v2/check-retweet';
const TWEETSCOUT_API_KEY = process.env.TWEETSCOUT_API_KEY;

/**
 * Fetches the latest tweet URL from the database.
 * @returns {Promise<string|null>} - The latest tweet URL or null if not found.
 */
async function getLatestTweetUrl() {
  const client = await connect();
  const db = client.db("ctxbt-signal-flow");
  const tweetsCollection = db.collection("maxxit_tweets");

  const tweetDoc = await tweetsCollection.findOne({ id: "tweet_list" });
  if (tweetDoc && tweetDoc.urls && tweetDoc.urls.length > 0) {
    // Return the last URL in the array (latest)
    return tweetDoc.urls[tweetDoc.urls.length - 1];
  }
  return null;
}

/**
 * Checks if all users in the database have retweeted the latest tweet from the database and updates their retweet status.
 * @param {string} next_cursor - Optional cursor for pagination from TweetScout API.
 * @returns {Promise<Array>} - Array of results for each user.
 */
async function verifyAndUpdateAllUsersRetweet(next_cursor = '') {
  // Fetch the latest tweet URL
  const tweet_link = await getLatestTweetUrl();
  if (!tweet_link) {
    throw new Error("No tweet URLs found in the database.");
  }
  console.log("Verifying retweets for tweet:", tweet_link);

  const client = await connect();
  const db = client.db("ctxbt-signal-flow");
  const usersCollection = db.collection("users");

  // Fetch all users
  const users = await usersCollection.find({}).toArray();

  // For each user, check if they have retweeted the specified tweet and update the DB
  const results = await Promise.all(users.map(async function(user) {
    const body = JSON.stringify({
      next_cursor: next_cursor,
      tweet_link: tweet_link,
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

      // Update the user document with retweet status
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            retweet: data.retweet,
            checked_tweet: tweet_link
          },
          $inc: {
            credits: data.retweet ? 100 : 0
          }
        }
      );

      return {
        twitterUsername: user.twitterUsername,
        twitterId: user.twitterId,
        retweet: data.retweet,
        checked_tweet: tweet_link
      };
    } catch (error) {
      // Optionally update the user with error info
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            retweet: null,
            checked_tweet: tweet_link
          }
        }
      );
      return {
        twitterUsername: user.twitterUsername,
        twitterId: user.twitterId,
        error: error.message || error,
        checked_tweet: tweet_link
      };
    }
  }));

  return results;
}

module.exports = {
  verifyAndUpdateAllUsersRetweet
};

// For testing: run with `node src/services/verifyRetweets.js`
if (require.main === module) {
  (async function() {
    try {
      const results = await verifyAndUpdateAllUsersRetweet();
      console.log("Retweet check results:", results);
    } catch (err) {
      console.error("Error running verifyAndUpdateAllUsersRetweet:", err);
    } finally {
      process.exit();
    }
  })();
} 