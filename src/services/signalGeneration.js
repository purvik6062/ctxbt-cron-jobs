const { connect } = require('../db');
const { dbName, influencerCollectionName, perplexity, tradingSignalsCollectionName } = require('../config/config');
const CryptoService = require('./cryptoService');
const axios = require('axios');

const cryptoService = new CryptoService();

// Global state to store tweet data temporarily
let globalState = [];

async function processAndGenerateSignalsForTweets(twitterHandle) {
    const client = await connect();
    try {
        const db = client.db(dbName);
        const influencerCollection = db.collection(influencerCollectionName);
        const tradingSignalsCollection = db.collection(tradingSignalsCollectionName);

        // Check if the Twitter handle is already being processed
        const result = await influencerCollection.findOneAndUpdate(
            { twitterHandle, isProcessing: { $ne: true } },
            { $set: { isProcessing: true } },
            { returnDocument: 'after' }
        );
        if (!result) {
            console.log(`Already processing for ${twitterHandle}`);
            return;
        }

        try {
            // Fetch the influencer's document
            const doc = await influencerCollection.findOne({ twitterHandle });
            if (!doc) {
                console.log(`No document found for ${twitterHandle}`);
                return;
            }

            // Filter tweets where signalsGenerated is false
            const tweetsToProcess = doc.tweets.filter(tweet => !tweet.signalsGenerated);
            if (tweetsToProcess.length === 0) {
                console.log(`No unprocessed tweets found for ${twitterHandle}`);
                return;
            }

            console.log(`Processing ${tweetsToProcess.length} tweets for ${twitterHandle}`);

            // Process each tweet
            for (const tweet of tweetsToProcess) {
                try {
                    // Step 1: Fetch market data for each coin
                    const marketDataArray = [];
                    for (const coinId of tweet.coins) {
                        const marketData = await cryptoService.getHistoricalTokenData(
                            coinId,
                            tweet.timestamp,
                            new Date()
                        );
                        marketDataArray.push(marketData);
                    }

                    // Step 2: Store in global state
                    globalState.push({
                        tweet: tweet.content,
                        timestamp: tweet.timestamp,
                        twitterHandle: twitterHandle,
                        subscribers: doc.subscribers,
                        market_data: marketDataArray
                    });

                    // Step 3: Generate trading signal prompt
                    const prompt = generatePrompt(tweet.content, marketDataArray);

                    // Step 4: Call Perplexity API to generate signal
                    const signalMessage = await callPerplexityAPI(prompt);
                    const trimmedMessage = signalMessage.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                    const finalMessage = trimmedMessage + `\n\n🔗 [Tweet Link](${tweet.tweet_link})`;

                    // Step 5: Store the trading signal in the database
                    await tradingSignalsCollection.insertOne({
                        tweet_id: tweet.tweet_id,
                        twitterHandle: twitterHandle,
                        signal_message: finalMessage,
                        generatedAt: new Date(),
                        coins: tweet.coins,
                        subscribers: doc.subscribers,
                        tweet_link: tweet.tweet_link,
                        messageSent: false
                    });

                    // Step 6: Update the tweet's signalsGenerated field
                    await influencerCollection.updateOne(
                        { twitterHandle, 'tweets.tweet_id': tweet.tweet_id },
                        { $set: { 'tweets.$.signalsGenerated': true } }
                    );

                    console.log(`Successfully processed tweet ${tweet.tweet_id}`);
                } catch (error) {
                    console.error(`Error processing tweet ${tweet.tweet_id}:`, error);
                    // Mark as processed to avoid reprocessing on error
                    await influencerCollection.updateOne(
                        { twitterHandle, 'tweets.tweet_id': tweet.tweet_id },
                        { $set: { 'tweets.$.signalsGenerated': true } }
                    );
                }
            }

            // Step 7: Clear the global state after processing all tweets
            globalState = [];
            console.log(`Completed processing for ${twitterHandle}, global state cleared.`);
        } finally {
            // Reset isProcessing to false, even if an error occurs
            await influencerCollection.updateOne(
                { twitterHandle },
                { $set: { isProcessing: false } }
            );
        }
    } catch (error) {
        console.error('Error in processAndGenerateSignalsForTweets:', error);
    } finally {
        await client.close();
    }
}

/**
 * Generates a prompt for the Perplexity AI model based on tweet content and market data.
 * @param {string} tweetContent - The content of the tweet.
 * @param {Array} marketDataArray - Array of market data objects for each coin.
 * @returns {string} - The formatted prompt.
 */
function generatePrompt(tweetContent, marketDataArray) {
    let marketDataStr = '';
    for (const data of marketDataArray) {
        marketDataStr += `
- ${data.token} (${data.coin_id}):
  Historical Data (${data.historical_data.timestamp}):
    Price: $${data.historical_data.price_usd}
    Market Cap: $${data.historical_data.market_cap}
    Volume: $${data.historical_data.total_volume}
  Current Data (${data.current_data.timestamp}):
    Price: $${data.current_data.price_usd}
    Market Cap: $${data.current_data.market_cap}
    Volume: $${data.current_data.total_volume}
  Price Change: ${data.current_data.price_change_since_historical}%
`;
    }

    return `
Analyze the below given tweets, research about the tokens mentioned and provide me a trading signal out of it:

Tweet: "${tweetContent}"

Market data from CoinGecko:
${marketDataStr}

The trading signal should have the token, signal, current price mandatorily (if it doesn't exist in the tweet then search for it) and if there exist target price, stop loss, timeline then that as well otherwise those fields can be null.

Please provide the trading signals for each token in this format, using Markdown and emojis:

🚨 **Trading Signal Alert** 🚨

[For each token:]
🏛️ **Token:** [Token Name]  
📈 **Signal:** [Buy/Sell/Hold]  
💰 **Current Price:** $[Current Price]  
🎯 **Target Price:** $[Target Price] (if available, otherwise omit)  
🛑 **Stop Loss:** $[Stop Loss] (if available, otherwise omit)  
⏳ **Timeline:** [Timeline] (if available, otherwise omit)

Do not include any extra analysis, descriptive text.
`;
}

/**
 * Calls the Perplexity Sonar-Reasoning-Pro model to generate a trading signal.
 * @param {string} prompt - The prompt to send to the API.
 * @returns {Promise<string>} - The generated trading signal message.
 */
async function callPerplexityAPI(prompt) {
    try {
        const response = await axios.post(
            'https://api.perplexity.ai/chat/completions',
            {
                model: 'sonar-reasoning-pro',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
            },
            {
                headers: {
                    'Authorization': `Bearer ${perplexity.apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log("response", response);

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error calling Perplexity API:', error);
        if (error.response) {
            console.error('API Response:', error.response.data);
        }
        throw new Error('Failed to generate trading signal');
    }
}

module.exports = { processAndGenerateSignalsForTweets };