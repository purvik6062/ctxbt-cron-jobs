const { connect } = require('../db/index');
const { tweetScoutApiKey, dbName } = require('../config/config');
const axios = require('axios');

async function updateInfluencerScores() {
    const { default: PQueue } = await import('p-queue');
    const client = await connect();
    const db = client.db(dbName);
    const influencersCollection = db.collection('influencers');

    try {
        console.log('Fetching influencers from database...');
        const influencers = await influencersCollection.find({}).toArray();
        // console.log("influencers:::", influencers)
        console.log(`Found ${influencers.length} influencers to process`);

        const queue = new PQueue({ concurrency: 5 }); // Limit to 5 concurrent API calls

        const updatePromises = influencers.map(influencer => {
            console.log("Processing influencer:", influencer.twitterHandle);
            return queue.add(async () => {
                try {
                    const twitterHandle = influencer.twitterHandle;
                    console.log("Making API request for:", twitterHandle);
                    const url = `https://api.tweetscout.io/v2/score/${twitterHandle}`;
                    const headers = {
                        Accept: 'application/json',
                        ApiKey: tweetScoutApiKey
                    };

                    const response = await axios.get(url, { headers });
                    const data = response.data;
                    const score = data.score;
                    await influencersCollection.updateOne(
                        { _id: influencer._id },
                        { $set: { tweetScoutScore: score } }
                    );
                    console.log(`Successfully updated score for ${twitterHandle}: ${score}`);
                } catch (error) {
                    console.error(`Error processing ${influencer.twitterHandle}:`, error.message);
                }
            });
        });

        console.log('Waiting for all updates to complete...');
        await Promise.all(updatePromises);
        console.log('All updates completed successfully');
    } catch (error) {
        console.error('Error in updateInfluencerScores:', error);
    } finally {
        await client.close();
        console.log('Database connection closed');
    }
}

module.exports = { updateInfluencerScores };