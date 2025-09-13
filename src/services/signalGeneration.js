const { connect, closeConnection } = require('../db');
const { dbName, influencerCollectionName, perplexity, tradingSignalsCollectionName, lunarcrushCollectionName } = require('../config/config');
const CryptoService = require('./cryptoService');
const { processAndSendSignal } = require('./hyperliquidSignalService');
const axios = require('axios');

/**
 * Gets the safe address for a user from the safe-deployment-service database
 * @param {string} username - Subscriber identifier (telegramId from tradingSignalsCollection)
 * @returns {string|null} - The safe address for arbitrum (pref) or arbitrum_sepolia, or null if not found
 */
async function getSafeAddressForUser(username) {
    let client;
    try {
        client = await connect();

        // Resolve twitterId by looking up the user via telegramId (username from tradingSignalsCollection)
        const signalFlowDb = client.db("ctxbt-signal-flow");
        const usersCollection = signalFlowDb.collection("users");

        // Try multiple identifiers just in case: telegramId (primary), twitterUsername (fallback)
        const userDoc = await usersCollection.findOne({
            $or: [
                { telegramId: username },
                { twitterUsername: username }
            ]
        });

        if (!userDoc) {
            console.log(`No user found in users collection for identifier ${username}`);
            return null;
        }

        if (!userDoc.twitterId) {
            console.log(`No twitterId found for identifier ${username}`);
            return null;
        }

        const twitterId = userDoc.twitterId.toString();

        // Now get safe address from safe-deployment-service db using twitterId = safes.userInfo.userId
        const safeDeploymentDb = client.db("safe-deployment-service");
        const safesCollection = safeDeploymentDb.collection("safes");

        const safeDoc = await safesCollection.findOne({
            "userInfo.userId": twitterId
        });

        if (!safeDoc || !safeDoc.deployments) {
            console.log(`No safe deployments found for twitterId ${twitterId} (identifier ${username})`);
            return null;
        }

        // Prefer mainnet arbitrum, fall back to arbitrum_sepolia
        const arbMainnet = safeDoc.deployments.arbitrum && safeDoc.deployments.arbitrum.address;
        // const arbSepolia = safeDoc.deployments.arbitrum_sepolia && safeDoc.deployments.arbitrum_sepolia.address;

        const safeAddress = arbMainnet || null;
        if (!safeAddress) {
            console.log(`No arbitrum safe address found for twitterId ${twitterId} (identifier ${username})`);
            return null;
        }

        console.log(`Found safe address ${safeAddress} for identifier ${username} (twitterId ${twitterId})`);
        return safeAddress;

    } catch (error) {
        console.error(`Error getting safe address for user ${username}:`, error);
        return null;
    }
}

/**
 * Sends signal to the trading API for a subscriber
 * @param {Object} signalData - The signal data
 * @param {string} username - The subscriber's username
 * @param {string} safeAddress - The subscriber's safe address
 */
async function sendSignalToGMXAPI(signalData, username, safeAddress) {
    try {
        const payload = {
            "Signal Message": signalData.signal,
            "Token Mentioned": signalData.tokenMentioned,
            "TP1": signalData.targets && signalData.targets.length > 0 ? signalData.targets[0] : null,
            "TP2": signalData.targets && signalData.targets.length > 1 ? signalData.targets[1] : null,
            "SL": signalData.stopLoss || null,
            "Current Price": signalData.currentPrice,
            "Max Exit Time": signalData.maxExitTime ? { "$date": signalData.maxExitTime } : null,
            "username": username,
            "safeAddress": safeAddress,
            "autoExecute": true
        };

        console.log(`Sending signal to API for user ${username}:`, JSON.stringify(payload, null, 2));

        const response = await axios.post(process.env.GMX_API_URL + '/position/create-with-tp-sl', payload, {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 60000
        });

        console.log(`Successfully sent signal to API for user ${username}:`, response.data);
        return { success: true, response: response.data };

    } catch (error) {
        console.error(`Failed to send signal to API for user ${username}:`, error.response?.data || error.message);
        return { success: false, error: error.response?.data || error.message };
    }
}

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
 * Queries LunarCrush data from MongoDB for a given symbol
 * @param {string} symbol - The token symbol to query (case-insensitive)
 * @returns {Object|null} - LunarCrush data object or null if not found
 */
async function getLunarCrushData(symbol) {
    let client;
    try {
        client = await connect();
        const signalFlowDb = client.db("ctxbt-signal-flow");
        const lunarcrushCollection = signalFlowDb.collection(lunarcrushCollectionName);

        const lunarcrushData = await lunarcrushCollection.findOne({
            symbol: symbol.toUpperCase()
        });

        if (lunarcrushData && lunarcrushData.metrics) {
            console.log(`Found LunarCrush data for ${symbol}`);
            return lunarcrushData;
        } else {
            console.log(`No LunarCrush data found for ${symbol}`);
            return null;
        }
    } catch (error) {
        console.error(`Error fetching LunarCrush data for ${symbol}:`, error);
        return null;
    } finally {
        if (client) {
            await closeConnection(client);
        }
    }
}

/**
 * Checks if a signal meets the user's threshold configuration
 * @param {Object} userThresholds - User's customization options/thresholds
 * @param {Object} lunarCrushMetrics - LunarCrush metrics from the signal
 * @returns {Object} - Object with passesThreshold, failedMetrics, and reason properties
 */
function checkUserThresholds(userThresholds, lunarCrushMetrics) {
    if (!userThresholds || !lunarCrushMetrics) {
        return {
            passesThreshold: false,
            failedMetrics: ['missing_configuration'],
            reason: 'Missing user thresholds or LunarCrush metrics'
        };
    }

    const failedMetrics = [];
    const metrics = lunarCrushMetrics;

    // Helper function to safely compare metrics with thresholds
    const checkMetric = (metricName, threshold, operator = '>=') => {
        const metricValue = metrics[metricName];
        const thresholdValue = threshold;

        if (metricValue === null || metricValue === undefined || isNaN(metricValue)) {
            return false; // Treat missing/invalid metrics as failing
        }

        switch (operator) {
            case '>=':
                return metricValue >= thresholdValue;
            case '<=':
                return metricValue <= thresholdValue;
            case '>':
                return metricValue > thresholdValue;
            case '<':
                return metricValue < thresholdValue;
            default:
                return metricValue >= thresholdValue;
        }
    };

    // Check each metric against user thresholds
    // Note: For neg_d_altrank_6h, higher is better (negative of rank change)
    const checks = [
        { metric: 'r_last6h_pct', threshold: userThresholds.r_last6h_pct, operator: '>=' },
        { metric: 'd_pct_mktvol_6h', threshold: userThresholds.d_pct_mktvol_6h, operator: '>=' },
        { metric: 'd_pct_socvol_6h', threshold: userThresholds.d_pct_socvol_6h, operator: '>=' },
        { metric: 'd_pct_sent_6h', threshold: userThresholds.d_pct_sent_6h, operator: '>=' },
        { metric: 'd_pct_users_6h', threshold: userThresholds.d_pct_users_6h, operator: '>=' },
        { metric: 'd_pct_infl_6h', threshold: userThresholds.d_pct_infl_6h, operator: '>=' },
        { metric: 'd_galaxy_6h', threshold: userThresholds.d_galaxy_6h, operator: '>=' },
        { metric: 'neg_d_altrank_6h', threshold: userThresholds.neg_d_altrank_6h, operator: '>=' }
    ];

    for (const check of checks) {
        if (!checkMetric(check.metric, check.threshold, check.operator)) {
            failedMetrics.push({
                metric: check.metric,
                actual: metrics[check.metric],
                threshold: check.threshold,
                operator: check.operator
            });
        }
    }

    const passesThreshold = failedMetrics.length === 0;

    return {
        passesThreshold,
        failedMetrics,
        reason: passesThreshold ? 'All thresholds met' : `Failed ${failedMetrics.length} threshold(s)`
    };
}

/**
 * Gets user threshold configuration from database
 * @param {string} username - User's telegramId or twitterUsername
 * @returns {Object|null} - User's threshold configuration or null if not found
 */
async function getUserThresholds(username) {
    let client;
    try {
        client = await connect();
        const signalFlowDb = client.db("ctxbt-signal-flow");
        const usersCollection = signalFlowDb.collection("users");

        // Try to find user by telegramId or twitterUsername
        const userDoc = await usersCollection.findOne({
            $or: [
                { telegramId: username },
                { twitterUsername: username },
                { telegramUserId: parseInt(username) || username }
            ]
        });

        if (!userDoc || !userDoc.customizationOptions) {
            console.log(`No threshold configuration found for user ${username}`);
            return null;
        }

        console.log(`Found threshold configuration for user ${username}`);
        return userDoc.customizationOptions;
    } catch (error) {
        console.error(`Error fetching thresholds for user ${username}:`, error);
        return null;
    } finally {
        if (client) {
            await closeConnection(client);
        }
    }
}

/**
 * Creates a prompt for the Perplexity API to generate a JSON object with trading parameters.
 * @param {string} tweetContent - The tweet text.
 * @param {Object} marketData - Market data for the coin mentioned in the tweet.
 * @param {Object} lunarCrushData - LunarCrush metrics data (optional)
 * @returns {string} - The prompt string.
 */
function generatePrompt(tweetContent, marketData, lunarCrushData = null) {
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

    // Format LunarCrush metrics if available
    let lunarCrushStr = '';
    if (lunarCrushData && lunarCrushData.metrics) {
        const metrics = lunarCrushData.metrics;
        lunarCrushStr = `
     - ${marketData.token} LunarCrush Social & Market Metrics:
       - Return over last 6h: ${metrics.r_last6h_pct?.toFixed(2) || 'N/A'}%
       - Market volume change (6h vs previous 6h): ${metrics.d_pct_mktvol_6h?.toFixed(2) || 'N/A'}%
       - Social volume change (6h vs previous 6h): ${metrics.d_pct_socvol_6h?.toFixed(2) || 'N/A'}%
       - Sentiment change (6h): ${metrics.d_pct_sent_6h?.toFixed(2) || 'N/A'}%
       - Users engagement change (6h): ${metrics.d_pct_users_6h?.toFixed(2) || 'N/A'}%
       - Influencer mentions change (6h): ${metrics.d_pct_infl_6h?.toFixed(2) || 'N/A'}%
       - Predicted next 6h return: ${lunarCrushData.pred_next6h_pct?.toFixed(2) || 'N/A'}%
       - Token type: ${lunarCrushData.type || 'N/A'}
         `;
    }

    return `Analyze the following tweet about ${marketData.token} along with current market conditions to generate a trading signal. Consider price action, volume trends, market sentiment, and social engagement indicators. Your analysis should incorporate all available market intelligence to determine the optimal trading strategy.

--- INPUT DATA ---
### Tweet: "${tweetContent}"
### Market Conditions:
${marketDataStr}
${lunarCrushStr ? `### Social & Market Indicators:${lunarCrushStr}` : ''}

### Trading Signal Format - Complete the JSON structure below:

{
  "token": "${marketData.token}",
  "signal": "Buy/Put Options/Hold",
  "currentPrice": ${marketData.current_data.price_usd}.toFixed(4),
  "targets": [num1 (Target Price 1), num2 (Target Price 2)],
  "stopLoss": num,
  "timeline": "Text",
  "maxExitTime": "ISO 8601 Date/Time string representing the maximum exit time",
  "tradeTip": "Provide a concise trading recommendation with specific entry/exit strategy and risk management advice for ${marketData.token}. Keep it under 4 lines."
}

--- CRITICAL INSTRUCTIONS ---
1. Generate ONLY the completed JSON object - no additional text, explanations, or analysis
2. Do NOT mention data sources, APIs, or where information came from
3. Focus purely on trading strategy based on the market conditions presented
4. Use "Put Options" for bearish signals instead of "Sell"
5. Ensure all numeric values are realistic for current ${marketData.token} price levels
6. The tradeTip should contain actionable trading advice without referencing data sources

Output the JSON object and nothing else:
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

                            // Fetch LunarCrush data for the token symbol
                            const tokenSymbol = marketData.symbol || marketData.token || coinId;
                            const lunarCrushData = await getLunarCrushData(tokenSymbol);

                            const prompt = generatePrompt(tweet.content, marketData, lunarCrushData);
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
                                tokenId,
                                lunarCrushMetrics: lunarCrushData?.metrics || null,
                                lunarCrushPrediction: lunarCrushData?.pred_next6h_pct || null,
                                lunarCrushTokenType: lunarCrushData?.type || null
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
                                    sent: false,
                                    thresholdCheck: null,
                                    sentAt: null,
                                    error: null
                                })),
                                tweet_link: tweet.tweet_link,
                                messageSent: false
                            });

                            // Send signal to GMX API
                            console.log(`Sending signal to GMX API for ${twitterHandle}'s tweet ${tweet.tweet_id}`);

                            // Get users collection to check subscriptions
                            // const signalFlowDb = client.db("ctxbt-signal-flow");
                            // const usersCollection = signalFlowDb.collection("users");

                            // Get the stored document to access subscribers as objects
                            const storedSignal = await tradingSignalsCollection.findOne({
                                tweet_id: tweet.tweet_id,
                                twitterHandle
                            });

                            if (!storedSignal || !storedSignal.subscribers) {
                                console.log(`No stored signal found for tweet ${tweet.tweet_id}, skipping GMX API calls`);
                                return;
                            }

                            console.log(`Subscribers: ${storedSignal.subscribers.map(s => s.username).join(',')}`);

                            for (const subscriber of storedSignal.subscribers) {
                                try {
                                    const username = subscriber.username;
                                    console.log(`Sending signal to GMX API for ${username}`);

                                    // Check if user is subscribed to this twitter handle from tradingSignalsCollection
                                    const signalDoc = await tradingSignalsCollection.findOne({
                                        tweet_id: tweet.tweet_id,
                                        twitterHandle,
                                        "subscribers.username": username
                                    });

                                    if (!signalDoc) {
                                        console.log(`User ${username} is not found in tradingSignalsCollection for ${twitterHandle}, skipping API call`);
                                        continue;
                                    }

                                    // // Additional check: verify subscription is still active in users collection
                                    // const userDoc = await usersCollection.findOne({
                                    //     twitterUsername: username,
                                    //     "subscribedAccounts.twitterHandle": twitterHandle
                                    // });

                                    // if (!userDoc) {
                                    //     console.log(`User ${username} is not subscribed to ${twitterHandle} in users collection, skipping API call`);
                                    //     continue;
                                    // }

                                    console.log(`User ${username} is subscribed to ${twitterHandle} and found in tradingSignalsCollection`);

                                    // Check user thresholds before sending signal
                                    const userThresholds = await getUserThresholds(username);
                                    const thresholdCheck = userThresholds && lunarCrushData?.metrics
                                        ? checkUserThresholds(userThresholds, lunarCrushData.metrics)
                                        : { passesThreshold: false, reason: 'Missing thresholds or LunarCrush data' };

                                    if (!thresholdCheck.passesThreshold) {
                                        console.log(`User ${username} thresholds not met: ${thresholdCheck.reason}`);

                                        // Log detailed threshold failure information
                                        if (thresholdCheck.failedMetrics.length > 0) {
                                            console.log(`Failed metrics for ${username}:`);
                                            thresholdCheck.failedMetrics.forEach(failed => {
                                                console.log(`  - ${failed.metric}: ${failed.actual?.toFixed(2) || 'N/A'} ${failed.operator} ${failed.threshold}`);
                                            });
                                        }

                                        // Update subscriber status in database to show threshold failure
                                        await tradingSignalsCollection.updateOne(
                                            { tweet_id: tweet.tweet_id, twitterHandle, "subscribers.username": username },
                                            {
                                                $set: {
                                                    "subscribers.$.sent": false,
                                                    "subscribers.$.thresholdCheck": {
                                                        passed: false,
                                                        reason: thresholdCheck.reason,
                                                        failedMetrics: thresholdCheck.failedMetrics,
                                                        checkedAt: new Date()
                                                    }
                                                }
                                            }
                                        );
                                        continue;
                                    }

                                    console.log(`User ${username} thresholds met: ${thresholdCheck.reason}`);

                                    // Get safe address for the user
                                    const safeAddress = await getSafeAddressForUser(username);
                                    if (!safeAddress) {
                                        console.log(`No safe address found for user ${username}, skipping API call`);

                                        // Update subscriber status to show safe address failure
                                        await tradingSignalsCollection.updateOne(
                                            { tweet_id: tweet.tweet_id, twitterHandle, "subscribers.username": username },
                                            {
                                                $set: {
                                                    "subscribers.$.sent": false,
                                                    "subscribers.$.thresholdCheck": thresholdCheck,
                                                    "subscribers.$.error": "No safe address found"
                                                }
                                            }
                                        );
                                        continue;
                                    }

                                    // Send signal to GMX API
                                    const apiResult = await sendSignalToGMXAPI(enhancedSignalData, username, safeAddress);

                                    // Update subscriber status based on API result
                                    if (apiResult.success) {
                                        console.log(`Successfully sent signal to API for GMX ${username}`);

                                        await tradingSignalsCollection.updateOne(
                                            { tweet_id: tweet.tweet_id, twitterHandle, "subscribers.username": username },
                                            {
                                                $set: {
                                                    "subscribers.$.sent": true,
                                                    "subscribers.$.thresholdCheck": thresholdCheck,
                                                    "subscribers.$.sentAt": new Date(),
                                                    "subscribers.$.apiResponse": apiResult.response
                                                }
                                            }
                                        );
                                    } else {
                                        console.error(`Failed to send signal to API for GMX ${username}:`, apiResult.error);

                                        await tradingSignalsCollection.updateOne(
                                            { tweet_id: tweet.tweet_id, twitterHandle, "subscribers.username": username },
                                            {
                                                $set: {
                                                    "subscribers.$.sent": false,
                                                    "subscribers.$.thresholdCheck": thresholdCheck,
                                                    "subscribers.$.error": apiResult.error,
                                                    "subscribers.$.failedAt": new Date()
                                                }
                                            }
                                        );
                                    }

                                } catch (subscriberError) {
                                    console.error(`Error processing GMX ${subscriber.username}:`, subscriberError);
                                }
                            }

                            console.log(`Completed sending signals to all subscribers for ${twitterHandle}'s tweet ${tweet.tweet_id}`);

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
    shouldSendToHyperliquid,
    getLunarCrushData,
    generatePrompt,
    callPerplexityAPI,
    checkUserThresholds,
    getUserThresholds
};