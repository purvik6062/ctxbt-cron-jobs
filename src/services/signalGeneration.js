const { connect } = require('../db');
const { dbName, influencerCollectionName, perplexity, tradingSignalsCollectionName } = require('../config/config');
const CryptoService = require('./cryptoService');
const axios = require('axios');
const fs = require('fs');

const cryptoService = new CryptoService();

// Updated columns as per your requirements: Removed Highest price columns, added Max Exit Time
const columns = [
    'Twitter Account', 'Tweet', 'Tweet Date', 'Signal Generation Date',
    'Signal Message', 'Token Mentioned', 'Token ID', 'Price at Tweet',
    'Current Price', 'TP1', 'TP2', 'SL', 'Exit Price', 'P&L', 'Max Exit Time'
];

function escapeCSV(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        if (value.includes(',') || value.includes('"')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    } else if (Array.isArray(value)) {
        const arrayStr = JSON.stringify(value);
        return `"${arrayStr.replace(/"/g, '""')}"`;
    } else if (value instanceof Date) {
        return value.toISOString();
    } else {
        return String(value);
    }
}

/**
 * Generates a markdown-formatted trading signal message from JSON data.
 * @param {Object} data - JSON object containing trading parameters.
 * @returns {string} - Formatted markdown message.
 */
function generateMessage(data) {
    const heading = {
        'Buy': '🚀 **Bullish Alert** 🚀',
        'Put Options': '🐻 **Bearish Put Option** 🐻',
        'Hold': '⏳ **Hold Steady** ⏳'
    }[data.signal] || '⚠️ **Signal** ⚠️';

    const targets = data.targets.map((t, i) => `TP${i + 1}: $${t}`).join('\n');
    const stopLoss = data.stopLoss != null ? `🛑 **Stop Loss**: $${data.stopLoss}` : '';
    const timeline = data.timeline ? `⏳ **Timeline:** ${data.timeline}` : '';
    const maxExit = data.maxExitTime ? `⏰ **Max Exit Time:** ${data.maxExitTime}` : '';

    return `
${heading}

🏛️ **Token**: ${data.token}
📈 **Signal**: ${data.signal}
💰 **Entry Price**: $${data.currentPrice}
🎯 **Targets**:
${targets}
${stopLoss}
${timeline}
${maxExit}

💡 **Trade Tip**:
${data.tradeTip}
`.trim();
}

/**
 * Creates a prompt for the Perplexity API to generate a JSON object with trading parameters.
 * @param {string} tweetContent - The tweet text.
 * @param {Object} marketData - Market data for the coin mentioned in the tweet.
 * @returns {string} - The prompt string.
 */
function generatePrompt(tweetContent, marketData) {
    // Format market data for the specific coin
    const marketDataStr = `
     - ${marketData.token} (${marketData.coin_id}):
       Historical Data (${marketData.historical_data.timestamp}):
         Price: $${marketData.historical_data.price_usd}
         Market Cap: $${marketData.historical_data.market_cap}
         Volume: $${marketData.historical_data.total_volume}
       Current Data (${marketData.current_data.timestamp}):
         Price: $${marketData.current_data.price_usd}
         Market Cap: $${marketData.current_data.market_cap}
         Volume: $${marketData.current_data.total_volume} 
       Price Change: ${marketData.current_data.price_change_since_historical}%
         `;

    return `Based on the provided tweet and market data, determine the trading signal for ${marketData.token} and fill in the following format accordingly. Use your analysis to decide the values for signal, sentiment, momentum, targets, stop loss, max exit time, etc., based on the tweet and market data provided, but only output the completed format without additional commentary or sections. 
    
--- INPUT DATA ---
### Tweet: "${tweetContent}"
### Market Data: ${marketDataStr}

### Trading Signal Format(Pure JSON) - The JSON should have the following structure:

{
  "token": "${marketData.token} (${marketData.coin_id})",
  "signal": "Buy/Put Options/Hold",
  "currentPrice": ${marketData.current_data.price_usd}.toFixed(4),
  "targets": [num1 (Target Price 1), num2 (Target Price 2)],
  "stopLoss": num,
  "timeline": "Text",
  "maxExitTime": "ISO 8601 Date/Time string representing the maximum exit time",
  "tradeTip": "Provide a concise trade tip with market insight and trading advice specific to ${marketData.token} based on the tweet and market data. The tip must not exceed four lines in length (e.g., 2 to 4 short sentences)."
}

Please provide only the JSON object without any additional text.

--- RULES ---
1. Ensure strict, valid JSON required
2. Do not include any additional text, analysis, or sections beyond this format. Only output the completed trading signal as shown above.
3. Output only the JSON object, no additional text.
4. When analysis suggests a bearish outlook, use "Put Options" instead of "Sell" as the signal value.
`;
}

/**
 * Calls the Perplexity API and parses the response as a JSON object.
 * @param {string} prompt - The prompt to send to the API.
 * @returns {Object} - Parsed JSON data with trading parameters.
 */
async function callPerplexityAPI(prompt) {
    try {
        const response = await axios.post(
            'https://api.perplexity.ai/chat/completions',
            {
                model: 'sonar-reasoning-pro',
                messages: [{ role: 'user', content: prompt }]
            },
            {
                headers: {
                    'Authorization': `Bearer ${perplexity.apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const content = response.data.choices[0].message.content;
        try {
            return JSON.parse(content);
        } catch (parseError) {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            console.error('No valid JSON found in response:', content);
            throw new Error('Invalid JSON response');
        }
    } catch (error) {
        console.error('API Error:', error);
        throw new Error('Failed to generate trading signal');
    }
}

/**
 * Processes tweets for a given Twitter handle and generates trading signals.
 * @param {string} twitterHandle - The influencer's Twitter handle.
 */
async function processAndGenerateSignalsForTweets(twitterHandle) {
    const client = await connect();
    try {
        const db = client.db(dbName);
        const influencerCollection = db.collection(influencerCollectionName);
        const tradingSignalsCollection = db.collection(tradingSignalsCollectionName);

        // Atomic update for processing status
        const result = await influencerCollection.findOneAndUpdate(
            { twitterHandle, isProcessing: { $ne: true } },
            { $set: { isProcessing: true, lastProcessed: new Date() } },
            { returnDocument: 'after' }
        );
        if (!result) return;

        try {
            const doc = await influencerCollection.findOne({ twitterHandle });
            if (!doc) return;

            const tweetsToProcess = doc.tweets.filter(
                tweet => !tweet.signalsGenerated && tweet.coins?.length > 0
            );
            if (tweetsToProcess.length === 0) return;

            console.log(`Processing ${tweetsToProcess.length} tweets for ${twitterHandle}`);

            // Define the CSV file path
            const csvFile = 'backtesting.csv';

            // Check if CSV file exists, if not, create it with headers
            if (!fs.existsSync(csvFile)) {
                const header = columns.join(',');
                fs.writeFileSync(csvFile, header + '\n');
            }

            for (const tweet of tweetsToProcess) {
                try {
                    for (const coinId of tweet.coins) {
                        try {
                            const marketData = await cryptoService.getHistoricalTokenDataFromCustomEndpoints(
                                coinId,
                                tweet.timestamp,
                                new Date().toISOString()
                            );
                            // console.log("marketData", marketData)
                            if (!marketData) continue;

                            const prompt = generatePrompt(tweet.content, marketData);
                            const data = await callPerplexityAPI(prompt);
                            const message = generateMessage(data);

                            // Extract token details
                            const tokenInfo = data.token.split('(');
                            const tokenMentioned = tokenInfo[0].trim();
                            const tokenId = marketData.id ? marketData.id : coinId;

                            const csvData = {
                                'Twitter Account': twitterHandle,
                                'Tweet': tweet.tweet_link,
                                'Tweet Date': tweet.timestamp,
                                'Signal Generation Date': new Date(),
                                'Signal Message': data.signal,
                                'Token Mentioned': tokenMentioned,
                                'Token ID': tokenId,
                                'Price at Tweet': marketData.historical_data.price_usd,
                                'Current Price': marketData.current_data.price_usd,
                                'TP1': data.targets && data.targets.length > 0 ? data.targets[0] : null,
                                'TP2': data.targets && data.targets.length > 1 ? data.targets[1] : null,
                                'SL': data.stopLoss || null,
                                'Exit Price': null, // Will need to be determined later
                                'P&L': null, // Will need to be calculated
                                'Max Exit Time': data.maxExitTime || null
                            };

                            // Store enhanced data in database
                            const enhancedSignalData = {
                                ...data,
                                currentPrice: marketData.current_data.price_usd,
                                tweet_id: tweet.tweet_id,
                                tweet_link: tweet.tweet_link,
                                tweet_timestamp: tweet.timestamp,
                                priceAtTweet: marketData.historical_data.price_usd,
                                exitValue: null,
                                twitterHandle,
                                tokenMentioned,
                                tokenId
                            };

                            await tradingSignalsCollection.insertOne({
                                tweet_id: tweet.tweet_id,
                                twitterHandle,
                                coin: coinId,
                                signal_message: message,
                                signal_data: enhancedSignalData,
                                generatedAt: new Date(),
                                subscribers: doc.subscribers.map(subscriber => ({
                                    username: subscriber,
                                    sent: false
                                })),
                                tweet_link: tweet.tweet_link,
                                messageSent: false
                            });

                            // Prepare CSV row
                            const row = columns.map(col => escapeCSV(csvData[col])).join(',');
                            // Append to CSV file
                            fs.appendFileSync(csvFile, row + '\n');

                            console.log(`Generated signal for ${coinId} in tweet ${tweet.tweet_id}`);
                        } catch (coinError) {
                            console.error(`Error processing coin ${coinId} for tweet ${tweet.tweet_id}:`, coinError);
                        }
                    }

                    // Update tweet status after processing all coins
                    await influencerCollection.updateOne(
                        { twitterHandle, 'tweets.tweet_id': tweet.tweet_id },
                        {
                            $set: {
                                'tweets.$.signalsGenerated': true,
                                'tweets.$.processedAt': new Date(),
                                'tweets.$.analysisStatus': 'completed'
                            },
                            $inc: { 'tweets.$.processingAttempts': 1 }
                        }
                    );
                    console.log(`Tweet ${tweet.tweet_id} fully processed`);
                } catch (tweetError) {
                    console.error(`Error processing tweet ${tweet.tweet_id}:`, tweetError);
                }
            }

            console.log(`Completed processing tweets for ${twitterHandle}`);
        } finally {
            await influencerCollection.updateOne(
                { twitterHandle },
                { $set: { isProcessing: false } }
            );
        }
    } catch (error) {
        console.error(`Error in processAndGenerateSignalsForTweets for ${twitterHandle}:`, error);
    } finally {
        await client.close();
    }
}

module.exports = { processAndGenerateSignalsForTweets };