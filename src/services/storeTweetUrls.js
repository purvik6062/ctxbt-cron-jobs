const { connect, closeConnection } = require('../db/index');

/**
 * Stores tweet URLs in the database under a specific collection or document.
 * @param {Array<string>} tweetUrls - Array of tweet URLs to store.
 * @returns {Promise<Object>} - Result of the database operation.
 */
async function storeTweetUrls(tweetUrls) {
  const client = await connect();
  try {
    const db = client.db("ctxbt-signal-flow");
    const tweetsCollection = db.collection("maxxit_tweets");

    // Update or insert a document with the tweet URLs
    const result = await tweetsCollection.updateOne(
      { id: "tweet_list" }, // Using a fixed ID to store the list of tweets
      {
        $set: {
          urls: tweetUrls,
          updatedAt: new Date()
        }
      },
      { upsert: true } // Create the document if it doesn't exist
    );

    console.log("Tweet URLs stored/updated in database:", result);
    return result;
  } catch (error) {
    console.error("Error storing tweet URLs:", error);
    throw error;
  } finally {
    await closeConnection(client);
  }
}

module.exports = {
  storeTweetUrls
};

// For testing: run with `node src/services/storeTweetUrls.js`
if (require.main === module) {
  const tweetUrls = [
    "https://x.com/triggerxnetwork/status/1904152272252326152",
    "https://x.com/triggerxnetwork/status/1911699968773218581",
    "https://x.com/triggerxnetwork/status/1911600281298608248"
  ];

  (async function () {
    try {
      await storeTweetUrls(tweetUrls);
      console.log("Successfully stored tweet URLs.");
    } catch (err) {
      console.error("Error storing tweet URLs:", err);
    } finally {
      process.exit();
    }
  })();
} 