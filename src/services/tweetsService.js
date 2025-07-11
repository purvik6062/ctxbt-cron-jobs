// src/services/tweetsService.js
const axios = require('axios');
const { connect, closeConnection } = require('../db');
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
            const subscription = {
                twitterHandleUsername: doc.twitterHandle,
                account: doc.twitterHandle // Pass the account name for impact factor lookup
            };

            const result = await scrapeTwitterAccount(subscription, { timeout: 300000 });
            if (result.success) {
                // Pass the account information to the processing functions
                await processAndStoreTweetsForHandle(
                    subscription.twitterHandleUsername,
                    doc.subscribers,
                    result.data,
                    subscription.account
                );
                await processAndGenerateSignalsForTweets(
                    subscription.twitterHandleUsername,
                    subscription.account
                );
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Send messages only once after processing all handles
        await processAndSendTradingSignalMessage();
    } catch (error) {
        console.error('Error processing tweets:', error);
    } finally {
        // Use closeConnection instead of client.close()
        await closeConnection(client);
    }
}

module.exports = { scrapeTwitterAccount, processTweets };
