// src/services/tweetsService.js
const axios = require('axios');
const { connect } = require('../db');
const { dbName, influencerCollectionName, scrapeEndpoint, scraperCredentials, openAI } = require('../config/config');
const { processAndStoreTweetsForHandle } = require('./processAndStoreRelevantTweets');
const { processAndGenerateSignalsForTweets } = require('./signalGeneration');
const { processAndSendTradingSignalMessage } = require('./telegramService');
const { messageSender } = require('./messageSender');

async function scrapeTwitterAccount(subscription) {
    try {
        const requestBody = {
            ...scraperCredentials,
            username: subscription.twitterHandleUsername
        };
        console.log(`Calling scrape API for Twitter handle: ${subscription.twitterHandleUsername}`);
        const response = await axios.post(scrapeEndpoint, requestBody, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log(`API call for ${subscription.twitterHandleUsername} successful`);
        return { subscription, success: true, data: response.data };

        // console.log(`API call for ${subscription.twitterHandleUsername} successful:`, responseData.status);
        // return { subscription, success: true, data: responseData };
    } catch (error) {
        console.error(`Error calling API for ${subscription.twitterHandleUsername}:`, error.message);
        return { subscription, success: false, error: error.message };
    }
}

async function processTweets() {
    const client = await connect();
    try {
        const db = client.db(dbName);
        const influencerCollection = db.collection(influencerCollectionName);
        // Process only twitter handles with active subscribers
        const docs = await influencerCollection.find({ subscribers: { $exists: true, $ne: [] } }).toArray();
        for (const doc of docs) {
            const subscription = { twitterHandleUsername: doc.twitterHandle };
            // const result = await scrapeTwitterAccount(subscription); //1/
            // if (result.success) {
            // await processAndStoreTweetsForHandle(subscription.twitterHandleUsername, doc.subscribers, result.data); //1/
            await processAndGenerateSignalsForTweets(subscription.twitterHandleUsername); //2/
            await processAndSendTradingSignalMessage(); //3/
            // }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (error) {
        console.error('Error processing tweets:', error);
    } finally {
        await client.close();
    }
}

module.exports = { scrapeTwitterAccount, processTweets };
