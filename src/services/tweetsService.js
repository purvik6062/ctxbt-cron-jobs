// src/services/tweetsService.js
const axios = require('axios');
const { connect, closeConnection } = require('../db');
const { dbName, influencerCollectionName, scrapeEndpoint, scraperCredentials, openAI } = require('../config/config');
const { processAndStoreTweetsForHandle } = require('./processAndStoreRelevantTweets');
const { processAndGenerateSignalsForTweets } = require('./signalGeneration');
const { processAndSendTradingSignalMessage } = require('./telegramService');
const { messageSender } = require('./messageSender');

// Rate limiting: 35 tweets per 5 minutes (7 API calls × 5 tweets each)
let tweetCount = 0;
const MAX_TWEETS_PER_WINDOW = 35;
const TWEETS_PER_CALL = 5;
const WAIT_DURATION_MS = 6 * 60 * 1000; // 6 minutes

async function checkRateLimit() {
    // If adding 5 more tweets would exceed the limit, wait for 5 minutes
    if (tweetCount + TWEETS_PER_CALL > MAX_TWEETS_PER_WINDOW) {
        console.log(`🕒 Rate limit reached (${tweetCount + TWEETS_PER_CALL} tweets would exceed ${MAX_TWEETS_PER_WINDOW}). Waiting 5 minutes...`);
        await new Promise(resolve => setTimeout(resolve, WAIT_DURATION_MS));

        // Reset after waiting
        tweetCount = 0;
    }

    tweetCount += TWEETS_PER_CALL;
}

async function scrapeTwitterAccount(subscription, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const timeout = options.timeout || 300000; // 5 minutes default
    const retryDelay = options.retryDelay || 5000; // 5 seconds delay between retries

    // Validate scraper credentials
    // if (!scraperCredentials.user || !scraperCredentials.password) {
    //     console.warn('⚠️  Scraper credentials are missing. Please set SCRAPER_USER and SCRAPER_PASSWORD environment variables.');
    //     return { 
    //         subscription, 
    //         success: false, 
    //         error: 'Missing scraper credentials - SCRAPER_USER and SCRAPER_PASSWORD required'
    //     };
    // }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Check rate limit before making the API call
            await checkRateLimit();

            const requestBody = {
                ...scraperCredentials,
                username: subscription.twitterHandleUsername
            };

            console.log({
                username: requestBody.username,
                tweets: requestBody.tweets,
                tweetCount: tweetCount,
                limit: `${tweetCount}/${MAX_TWEETS_PER_WINDOW} tweets`
            });

            console.log(`Calling scrape API for Twitter handle: ${subscription.twitterHandleUsername} (attempt ${attempt}/${maxRetries})`);

            const response = await axios.post(scrapeEndpoint, requestBody, {
                headers: { 'Content-Type': 'application/json' },
                timeout: timeout
            });

            console.log(response.data);

            console.log(`API call for ${subscription.twitterHandleUsername} successful`);
            return { subscription, success: true, data: response.data };

        } catch (error) {
            const isServerError = error.response && (error.response.status >= 500 || error.response.status === 429);
            const isTimeoutError = error.code === 'ECONNABORTED' || error.message.includes('timeout');

            console.error(`Error calling API for ${subscription.twitterHandleUsername} (attempt ${attempt}/${maxRetries}):`, error.message);

            // Log detailed error information for better debugging
            if (error.response) {
                console.error('API Error Response:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data,
                    headers: error.response.headers
                });
            } else if (error.request) {
                console.error('No response received:', error.request);
            } else {
                console.error('Request setup error:', error.message);
            }

            // Retry on server errors, timeouts, or rate limits
            if ((isServerError || isTimeoutError) && attempt < maxRetries) {
                console.log(`Retrying ${subscription.twitterHandleUsername} in ${retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }

            // If all retries failed or it's a client error, return failure
            return {
                subscription,
                success: false,
                error: error.message,
                statusCode: error.response?.status,
                responseData: error.response?.data
            };
        }
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

            const result = await scrapeTwitterAccount(subscription, {
                timeout: 240000,    // 4 minutes per request
                maxRetries: 3,      // Try up to 3 times
                retryDelay: 10000   // Wait 10 seconds between retries
            });
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
