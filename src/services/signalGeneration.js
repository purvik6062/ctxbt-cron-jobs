const { connect, closeConnection } = require('../db');
const { dbName, influencerCollectionName, perplexity, tradingSignalsCollectionName } = require('../config/config');
const CryptoService = require('./cryptoService');
const { processAndSendSignal } = require('./hyperliquidSignalService');
const axios = require('axios');

const cryptoService = new CryptoService();



// Bitcoin identifiers (common coin IDs for Bitcoin)
const BITCOIN_COIN_IDS = ['bitcoin', 'btc', 'BTC'];

// Ethereum identifiers (common coin IDs for Ethereum)
const ETHEREUM_COIN_IDS = ['ethereum', 'eth', 'ETH'];

// Solana identifiers (common coin IDs for Solana)
const SOLANA_COIN_IDS = ['solana', 'sol', 'SOL'];

// Cache for top influencers to avoid repeated database calls
let topInfluencersCache = {
    top10: null,
    top30: null,
    lastUpdated: null,
    cacheDuration: 5 * 60 * 1000 // 5 minutes
};

/**
 * Fetches top influencers from the database based on impact factor
 * @param {number} limit - Number of top influencers to fetch
 * @returns {Array} - Array of influencer objects sorted by impact factor
 */
async function getTopInfluencersByImpactFactor(limit = 30) {
    try {
        const client = await connect();
        const signalFlowDb = client.db("ctxbt-signal-flow");
        const influencersCollection = signalFlowDb.collection('influencers');
        
        // Fetch top influencers sorted by impact factor (descending)
        const topInfluencers = await influencersCollection
            .find({ 
                impactFactor: { $exists: true, $ne: null },
                // Filter out influencers with invalid impact factors
                $and: [
                    { impactFactor: { $ne: Infinity } },
                    { impactFactor: { $ne: -Infinity } },
                    { impactFactor: { $ne: NaN } }
                ]
            })
            .sort({ impactFactor: -1 })
            .limit(limit)
            .project({ 
                twitterHandle: 1, 
                impactFactor: 1, 
                totalPnL: 1, 
                signalCount: 1 
            })
            .toArray();
        
        console.log(`Fetched top ${topInfluencers.length} influencers by impact factor`);
        return topInfluencers;
    } catch (error) {
        console.error('Error fetching top influencers by impact factor:', error);
        return [];
    }
}

/**
 * Gets cached top influencers or fetches fresh data if cache is expired
 * @param {number} limit - Number of top influencers to fetch
 * @returns {Array} - Array of top influencer objects
 */
async function getCachedTopInfluencers(limit = 30) {
    const now = Date.now();
    const cacheKey = limit === 10 ? 'top10' : 'top30';
    
    // Check if cache is valid
    if (topInfluencersCache[cacheKey] && 
        topInfluencersCache.lastUpdated && 
        (now - topInfluencersCache.lastUpdated) < topInfluencersCache.cacheDuration) {
        return topInfluencersCache[cacheKey];
    }
    
    // Fetch fresh data
    const topInfluencers = await getTopInfluencersByImpactFactor(limit);
    
    // Update cache
    topInfluencersCache[cacheKey] = topInfluencers;
    topInfluencersCache.lastUpdated = now;
    
    return topInfluencers;
}

/**
 * Gets top 10 influencers by impact factor
 * @returns {Array} - Array of top 10 influencer objects
 */
async function getTop10Influencers() {
    return getCachedTopInfluencers(10);
}

/**
 * Gets top 30 influencers by impact factor
 * @returns {Array} - Array of top 30 influencer objects
 */
async function getTop30Influencers() {
    return getCachedTopInfluencers(30);
}

/**
 * Checks if an influencer is in the top 10 list based on impact factor
 * @param {string} twitterHandle - The influencer's Twitter handle
 * @returns {boolean} - True if the influencer is in the top 10 list, false otherwise
 */
async function isTop10Influencer(twitterHandle) {
    const top10 = await getTop10Influencers();
    return top10.some(influencer => influencer.twitterHandle === twitterHandle);
}

/**
 * Checks if an influencer is in the top 30 list based on impact factor
 * @param {string} twitterHandle - The influencer's Twitter handle
 * @returns {boolean} - True if the influencer is in the top 30 list, false otherwise
 */
async function isTop30Influencer(twitterHandle) {
    const top30 = await getTop30Influencers();
    return top30.some(influencer => influencer.twitterHandle === twitterHandle);
}

/**
 * Determines if a signal should be sent to Hyperliquid based on influencer rank and token type
 * @param {string} twitterHandle - The influencer's Twitter handle
 * @param {string} tokenId - The token ID
 * @returns {Object} - Object with shouldSend and reason properties
 */
async function shouldSendToHyperliquid(twitterHandle, tokenId) {
    const tokenIdLower = tokenId.toLowerCase();
    const isBTC = BITCOIN_COIN_IDS.some(btcId => tokenIdLower.includes(btcId.toLowerCase()));
    const isETH = ETHEREUM_COIN_IDS.some(ethId => tokenIdLower.includes(ethId.toLowerCase()));
    const isSOL = SOLANA_COIN_IDS.some(solId => tokenIdLower.includes(solId.toLowerCase()));
    
    // For BTC/ETH/SOL tokens, only top 10 influencers can send signals
    if (isBTC || isETH || isSOL) {
        const isTop10 = await isTop10Influencer(twitterHandle);
        const tokenType = isBTC ? 'BTC' : isETH ? 'ETH' : 'SOL';
        return {
            shouldSend: isTop10,
            reason: isTop10 ? `Top 10 influencer for ${tokenType} token` : `${tokenType} tokens restricted to top 10 influencers only`
        };
    }
    
    // For other tokens, top 30 influencers can send signals
    const isTop30 = await isTop30Influencer(twitterHandle);
    return {
        shouldSend: isTop30,
        reason: isTop30 ? 'Top 30 influencer for non-BTC/ETH/SOL token' : 'Not in top 30 influencers list'
    };
}

/**
 * Checks if a coin should be processed based on the influencer's specialization.
 * @param {string} twitterHandle - The influencer's Twitter handle.
 * @param {string} coinId - The coin ID to check.
 * @returns {Promise<boolean>} - True if the coin should be processed, false otherwise.
 */
async function shouldProcessCoinForInfluencer(twitterHandle, coinId) {
    const coinIdLower = coinId.toLowerCase();
    
    // Check if this is a Bitcoin-related coin
    const isBTC = BITCOIN_COIN_IDS.some(btcId => coinIdLower.includes(btcId.toLowerCase()));
    // Check if this is an Ethereum-related coin
    const isETH = ETHEREUM_COIN_IDS.some(ethId => coinIdLower.includes(ethId.toLowerCase()));
    // Check if this is a Solana-related coin
    const isSOL = SOLANA_COIN_IDS.some(solId => coinIdLower.includes(solId.toLowerCase()));
    
    // For BTC, ETH, and SOL tokens, only top 10 influencers can process them
    if (isBTC || isETH || isSOL) {
        const isTop10 = await isTop10Influencer(twitterHandle);
        return isTop10;
    }
    
    // For other tokens, top 30 influencers can process them
    const isTop30 = await isTop30Influencer(twitterHandle);
    return isTop30;
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
    const entryPrice = data.currentPrice ? `💰 **Entry Price**: $${Number(data.currentPrice).toFixed(2)}` : '';

    return `
${heading}

🏛️ **Token**: ${data.token}
📈 **Signal**: ${data.signal}
${entryPrice}
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

            for (const tweet of tweetsToProcess) {
                try {
                    // Filter coins based on influencer specialization
                    const coinsToProcess = [];
                    for (const coinId of tweet.coins) {
                        const shouldProcess = await shouldProcessCoinForInfluencer(twitterHandle, coinId);
                        if (shouldProcess) {
                            coinsToProcess.push(coinId);
                        }
                    }
                    
                    if (coinsToProcess.length === 0) {
                        console.log(`No eligible coins for ${twitterHandle} in tweet ${tweet.tweet_id} (specialization filter applied)`);
                        // Still mark as processed since we've evaluated it
                        await influencerCollection.updateOne(
                            { twitterHandle, 'tweets.tweet_id': tweet.tweet_id },
                            {
                                $set: {
                                    'tweets.$.signalsGenerated': true,
                                    'tweets.$.processedAt': new Date(),
                                    'tweets.$.analysisStatus': 'skipped_specialization_filter'
                                },
                                $inc: { 'tweets.$.processingAttempts': 1 }
                            }
                        );
                        continue;
                    }
                    
                    console.log(`Processing ${coinsToProcess.length} eligible coins for ${twitterHandle} in tweet ${tweet.tweet_id}`);
                    
                    for (const coinId of coinsToProcess) {
                        try {
                            const marketData = await cryptoService.getHistoricalTokenDataFromCustomEndpoints(
                                coinId,
                                tweet.timestamp,
                                new Date().toISOString()
                            );
                            if (!marketData) continue;

                            const prompt = generatePrompt(tweet.content, marketData);
                            const data = await callPerplexityAPI(prompt);
                            const message = generateMessage(data);

                            // Extract token details
                            const tokenInfo = data.token.split('(');
                            const tokenMentioned = tokenInfo[0].trim();
                            const tokenId = marketData.id ? marketData.id : coinId;

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

                            // Store in backtesting database
                            const backtestingDb = client.db('backtesting_db');
                            const backtestingCollection = backtestingDb.collection('trading_signals_backtesting');
                            await backtestingCollection.insertOne({
                                'Twitter Account': twitterHandle,
                                'Tweet': tweet.tweet_link,
                                'Tweet Date': new Date(tweet.timestamp),
                                'Signal Generation Date': new Date(),
                                'Signal Message': data.signal,
                                'Token Mentioned': tokenMentioned,
                                'Token ID': tokenId,
                                'Price at Tweet': marketData.historical_data.price_usd,
                                'Current Price': marketData.current_data.price_usd,
                                'TP1': data.targets && data.targets.length > 0 ? data.targets[0] : null,
                                'TP2': data.targets && data.targets.length > 1 ? data.targets[1] : null,
                                'SL': data.stopLoss || null,
                                'Max Exit Time': data.maxExitTime ? new Date(data.maxExitTime) : null,
                                'backtesting_done': false
                            });

                            // Send signal to Hyperliquid API for position creation (only for top 10 influencers)
                            const { shouldSend, reason } = await shouldSendToHyperliquid(twitterHandle, tokenId);
                            if (shouldSend) {
                                try {
                                    const signalPayload = {
                                        signal: data.signal,
                                        tokenMentioned: tokenMentioned,
                                        targets: data.targets || [],
                                        stopLoss: data.stopLoss,
                                        currentPrice: marketData.current_data.price_usd,
                                        maxExitTime: data.maxExitTime
                                    };
                                    
                                    const apiResponse = await processAndSendSignal(signalPayload);
                                    
                                    if (apiResponse.status === 'success') {
                                        console.log(`Successfully sent signal to Hyperliquid API for ${tokenMentioned} from ${twitterHandle} (${reason})`);
                                    } else {
                                        console.error(`Failed to send signal to Hyperliquid API for ${tokenMentioned} from ${twitterHandle} (${reason}):`, apiResponse.error);
                                    }
                                } catch (apiError) {
                                    console.error(`Error sending signal to Hyperliquid API for ${tokenMentioned} from ${twitterHandle} (${reason}):`, apiError);
                                }
                            } else {
                                console.log(`Skipping Hyperliquid API for ${tokenMentioned} - ${twitterHandle} (${reason})`);
                            }

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
        await closeConnection(client);
    }
}

/**
 * Utility function to get current top influencers for debugging/monitoring
 * @returns {Object} - Object containing top 10 and top 30 influencers
 */
async function getCurrentTopInfluencers() {
    try {
        const top10 = await getTop10Influencers();
        const top30 = await getTop30Influencers();
        
        return {
            top10: top10.map(inf => ({
                twitterHandle: inf.twitterHandle,
                impactFactor: inf.impactFactor,
                totalPnL: inf.totalPnL,
                signalCount: inf.signalCount
            })),
            top30: top30.map(inf => ({
                twitterHandle: inf.twitterHandle,
                impactFactor: inf.impactFactor,
                totalPnL: inf.totalPnL,
                signalCount: inf.signalCount
            })),
            cacheInfo: {
                lastUpdated: topInfluencersCache.lastUpdated,
                cacheAge: topInfluencersCache.lastUpdated ? 
                    Math.round((Date.now() - topInfluencersCache.lastUpdated) / 1000) + 's ago' : 'Never'
            }
        };
    } catch (error) {
        console.error('Error getting current top influencers:', error);
        return { error: error.message };
    }
}

/**
 * Utility function to clear the influencer cache (useful for testing)
 */
function clearInfluencerCache() {
    topInfluencersCache = {
        top10: null,
        top30: null,
        lastUpdated: null,
        cacheDuration: 5 * 60 * 1000
    };
    console.log('Influencer cache cleared');
}

/**
 * Utility function to check if an influencer can send signals for a specific token
 * @param {string} twitterHandle - The influencer's Twitter handle
 * @param {string} tokenId - The token ID
 * @returns {Object} - Detailed information about the influencer's eligibility
 */
async function checkInfluencerEligibility(twitterHandle, tokenId) {
    try {
        const top10 = await getTop10Influencers();
        const top30 = await getTop30Influencers();
        
        const isInTop10 = top10.some(inf => inf.twitterHandle === twitterHandle);
        const isInTop30 = top30.some(inf => inf.twitterHandle === twitterHandle);
        
        const tokenIdLower = tokenId.toLowerCase();
        const isBTC = BITCOIN_COIN_IDS.some(btcId => tokenIdLower.includes(btcId.toLowerCase()));
        const isETH = ETHEREUM_COIN_IDS.some(ethId => tokenIdLower.includes(ethId.toLowerCase()));
        const isSOL = SOLANA_COIN_IDS.some(solId => tokenIdLower.includes(solId.toLowerCase()));
        
        const { shouldSend, reason } = await shouldSendToHyperliquid(twitterHandle, tokenId);
        
        return {
            twitterHandle,
            tokenId,
            isBTC,
            isETH,
            isSOL,
            isInTop10,
            isInTop30,
            shouldSend,
            reason,
            ranking: {
                top10Rank: isInTop10 ? top10.findIndex(inf => inf.twitterHandle === twitterHandle) + 1 : null,
                top30Rank: isInTop30 ? top30.findIndex(inf => inf.twitterHandle === twitterHandle) + 1 : null
            }
        };
    } catch (error) {
        console.error('Error checking influencer eligibility:', error);
        return { error: error.message };
    }
}

module.exports = { 
    processAndGenerateSignalsForTweets,
    isTop10Influencer,
    isTop30Influencer,
    getTop10Influencers,
    getTop30Influencers,
    getCurrentTopInfluencers,
    clearInfluencerCache,
    checkInfluencerEligibility,
    shouldSendToHyperliquid
};