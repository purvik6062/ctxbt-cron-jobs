const { connect } = require('../db');
const { dbName, influencerCollectionName, perplexity, tradingSignalsCollectionName } = require('../config/config');
const CryptoService = require('./cryptoService');
const axios = require('axios');
const fs = require('fs');

const cryptoService = new CryptoService();
let globalState = [];

const columns = [
    'token', 'signal', 'targets', 'stopLoss', 'timeline', 'tradeTip',
    'currentPrice', 'tweet_id', 'tweet_link', 'tweet_timestamp',
    'priceAtTweet', 'exitValue'
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
        'Sell': '🐻 **Bearish Warning** 🐻',
        'Hold': '⏳ **Hold Steady** ⏳'
    }[data.signal] || '⚠️ **Signal** ⚠️';

    const targets = data.targets.map((t, i) => `TP${i + 1}: $${t}`).join('\n');
    const stopLoss = data.stopLoss != null ? `🛑 **Stop Loss**: $${data.stopLoss}` : '';
    const timeline = data.timeline ? `⏳ **Timeline:** ${data.timeline}` : '';

    return `
${heading}

🏛️ **Token**: ${data.token}
📈 **Signal**: ${data.signal}
🎯 **Targets**:
${targets}
${stopLoss}
${timeline}

💡 **Trade Tip**:
${data.tradeTip}
`.trim();
}

/**
 * Creates a prompt for the Perplexity API to generate a JSON object with trading parameters.
 * @param {string} tweetContent - The tweet text.
 * @param {Array} marketDataArray - Array of market data for coins mentioned in the tweet.
 * @returns {string} - The prompt string.
 */
function generatePrompt(tweetContent, marketDataArray) {
    const marketDataStr = marketDataArray.map(data => `
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
`).join('');

    return `Based on the provided tweet and market data, determine the trading signal and fill in the following format accordingly. Use your analysis to decide the values for signal, sentiment, momentum, targets, stop loss, etc., but only output the completed format without additional commentary or sections. 
    
--- INPUT DATA ---
### Tweet: "${tweetContent}"
### Market Data: ${marketDataStr}

### Trading Signal Format(Pure JSON) - The JSON should have the following structure:

{
  "token": "Token Name (SYM)",
  "signal": "Buy/Sell/Hold",
  "targets": [num1 (Target Price 1), num2 (Target Price 2)],
  "stopLoss": num,
  "timeline": "Text",
  "tradeTip": "Provide a concise trade tip with market insight and trading advice specific to this token based on the tweet and market data. The tip must not exceed four lines in length (e.g., 2 to 4 short sentences)."
}

Please provide only the JSON object without any additional text.

--- RULES ---
1. Strict and valid JSON required
2. Do not include any additional text, analysis, or sections beyond this format. Only output the completed trading signal as shown above.
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

            const tweetsToProcess = doc.tweets.filter(tweet => !tweet.signalsGenerated);
            if (tweetsToProcess.length === 0) return;

            console.log(`Processing ${tweetsToProcess.length} tweets for ${twitterHandle}`);

            for (const tweet of tweetsToProcess) {
                try {
                    const marketDataArray = [];
                    for (const coinId of tweet.coins) {
                        const marketData = await cryptoService.getHistoricalTokenData(
                            coinId,
                            tweet.timestamp,
                            new Date()
                        );
                        marketDataArray.push(marketData);
                    }

                    globalState.push({
                        tweet: tweet.content,
                        timestamp: tweet.timestamp,
                        twitterHandle,
                        subscribers: doc.subscribers,
                        market_data: marketDataArray
                    });

                    const prompt = generatePrompt(tweet.content, marketDataArray);
                    const data = await callPerplexityAPI(prompt);
                    const message = generateMessage(data);

                    // Determine the token from the API response
                    const tokenSymbol = data.token.split('(')[1]?.replace(')', '').trim() || data.token;
                    const tokenData = marketDataArray.find(md => md.token.toUpperCase() === tokenSymbol.toUpperCase());

                    if (!tokenData) {
                        throw new Error(`Token data not found for ${data.token}`);
                    }

                    // Extract price information
                    const currentPrice = tokenData.current_data.price_usd;
                    const priceAtTweet = tokenData.historical_data.price_usd;

                    // Enhance signal_data with additional fields
                    const enhancedSignalData = {
                        ...data,
                        currentPrice,
                        tweet_id: tweet.tweet_id,
                        tweet_link: tweet.tweet_link,
                        tweet_timestamp: tweet.timestamp,
                        priceAtTweet,
                        exitValue: null  // Default to null
                    };

                    // Store the enhanced signal data in the database
                    await tradingSignalsCollection.insertOne({
                        tweet_id: tweet.tweet_id,
                        twitterHandle,
                        signal_message: message,
                        signal_data: enhancedSignalData,
                        generatedAt: new Date(),
                        coins: tweet.coins,
                        subscribers: doc.subscribers,
                        tweet_link: tweet.tweet_link,
                        messageSent: false
                    });

                    // Write enhancedSignalData to backtest.csv
                    const csvFile = 'backtest.csv';
                    const row = columns.map(col => escapeCSV(enhancedSignalData[col])).join(',');

                    try {
                        if (!fs.existsSync(csvFile)) {
                            const header = columns.join(',');
                            fs.writeFileSync(csvFile, header + '\n' + row + '\n');
                        } else {
                            fs.appendFileSync(csvFile, row + '\n');
                        }
                    } catch (csvError) {
                        console.error('Error writing to CSV:', csvError);
                    }

                    // Update tweet status
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

                    console.log(`Processed tweet ${tweet.tweet_id}`);
                } catch (error) {
                    console.error(`Error processing tweet ${tweet.tweet_id}:`, error);
                    await influencerCollection.updateOne(
                        { twitterHandle, 'tweets.tweet_id': tweet.tweet_id },
                        { $set: { 'tweets.$.signalsGenerated': true } }
                    );
                }
            }

            globalState = [];
            console.log(`Completed processing for ${twitterHandle}`);
        } finally {
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

module.exports = { processAndGenerateSignalsForTweets };