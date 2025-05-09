const dotenv = require('dotenv');
const OpenAI = require('openai');
const lighthouse = require('@lighthouse-web3/sdk');
const stringify = require('json-stable-stringify');
const path = require('path');
const { connect, closeConnection } = require('../db/index');
const axios = require('axios'); // Import axios for HTTP requests
// Explicitly provide the path to the .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Configuration
const dbName = 'backtesting_db';
const sourceCollectionName = 'trading_signals_backtesting';
const collectionName = 'backtesting_results_with_reasoning';
const tradesCollectionName = 'trades';

// OpenAI API setup
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Function to parse tweet date or max exit time to UTC timestamp
function parseDateToTimestamp(dateStr) {
    if (!dateStr) return Infinity; // Default to no limit if absent
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
        throw new Error(`Invalid date format: ${dateStr}`);
    }
    return date.getTime();
}

// Function to fetch 365-day price data from CoinGecko
async function fetchPriceData(coinId) {
    const url = `https://www.coingecko.com/price_charts/${coinId}/usd/365_days.json`;
    try {
        const response = await fetch(url, { timeout: 60000 });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.stats; // Array of [timestamp, price]
    } catch (error) {
        console.error(`Error fetching price data for ${coinId}:`, error.message);
        return null;
    }
}

// Function to calculate EMA
function calculateEMA(prevEMA, price, period) {
    const alpha = 2 / (period + 1);
    return alpha * price + (1 - alpha) * prevEMA;
}

// Function to get reasoning from LLM
async function getReasoningFromLLM(tokenId, bestStrategy, strategyPnLs, signalType) {
    const prompt = `
        For the token "${tokenId}", the strategy "${bestStrategy}" achieved a P&L of ${strategyPnLs[bestStrategy]}.
        The signal type was "${signalType}" (${signalType === 'Put Options' ? 'bearish position where profit is made when price falls' : 'bullish position where profit is made when price rises'}).
        P&L values for all strategies:
        ${Object.entries(strategyPnLs).map(([strategy, pnl]) => `- ${strategy}: ${pnl}`).join('\n')}
        Provide a very brief explanation (1 sentence) of what the "${bestStrategy}" strategy did in this particular case, without suggesting it's superior to other strategies.
    `;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
        });
        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error(`Error getting reasoning for ${tokenId}:`, error.message);
        return 'Reasoning unavailable due to API error';
    }
}

// Format price values with appropriate precision
function formatCryptoPrice(price) {
    const numPrice = parseFloat(price);
    
    // For very small values (less than 0.00001), use scientific notation
    if (numPrice < 0.00001) {
        return numPrice.toExponential(6);
    }
    
    // For small values, use 8 decimal places
    return numPrice.toFixed(8);
}

// Format date for display
function formatDate(dateString) {
    if (!dateString) return "N/A";
    
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return "Invalid Date";
        
        // Format as: "Apr 21, 2025, 16:10"
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        console.error(`Error formatting date: ${dateString}`, error);
        return "Date Error";
    }
}

// Function to send backtested signal to subscribers
async function sendBacktestedSignalToSubscribers(twitterAccount, signal, bestPnL, exitPrice, reasoning, documentId) {
    try {
        // Connect to databases
        const client = await connect();
        const signalFlowDb = client.db('ctxbt-signal-flow');
        const backtestingDb = client.db(dbName);
        const influencersCollection = signalFlowDb.collection('influencers');
        const resultsCollection = backtestingDb.collection(collectionName);
        
        // Get the influencer document to fetch subscribers
        const influencer = await influencersCollection.findOne({ twitterHandle: twitterAccount });
        
        if (!influencer || !influencer.subscribers || influencer.subscribers.length === 0) {
            console.log(`No subscribers found for ${twitterAccount}`);
            await closeConnection(client);
            return;
        }
        
        // Create backtested signal message
        const signalType = signal["Signal Message"];
        const tokenId = signal["Token ID"];
        const entryPrice = parseFloat(signal["Price at Tweet"]);
        const formattedDate = formatDate(signal["Signal Generation Date"]);
        const backtestMessage = `
SIGNAL ANALYSIS & RESULT

Token: ${tokenId}
Signal Type: ${signalType}
Signal Date: ${formattedDate}
Entry Price: $${formatCryptoPrice(entryPrice)}
Exit Price: $${formatCryptoPrice(exitPrice)}
P&L: ${bestPnL}

Analysis: ${reasoning}
`;
        
        // Initialize or get existing document with message status
        const backtestResult = await resultsCollection.findOne({ _id: documentId });
        if (!backtestResult || !backtestResult.subscribers) {
            // Initialize subscribers array with sent status if it doesn't exist
            await resultsCollection.updateOne(
                { _id: documentId },
                { 
                    $set: { 
                        subscribers: influencer.subscribers.map(subscriber => ({
                            username: subscriber,
                            sent: false
                        })),
                        messageSent: false 
                    } 
                },
                { upsert: true } // Add upsert option to create document if it doesn't exist
            );
        }
        
        // Get updated document with subscribers
        const updatedDoc = await resultsCollection.findOne({ _id: documentId });
        const subscribers = updatedDoc.subscribers || [];
        
        // Send message to each subscriber who hasn't received it yet
        for (const subscriber of subscribers) {
            // Skip if this subscriber has already received the message
            if (subscriber.sent === true) {
                continue;
            }
            
            // Handle different subscriber formats (string or object)
            const username = typeof subscriber === 'string' ? subscriber : 
                           (subscriber.username ? subscriber.username : 
                           (typeof subscriber === 'object' ? JSON.stringify(subscriber) : 'unknown'));
            
            try {
                const payload = {
                    username: username,
                    message: backtestMessage
                };
                
                // Retry logic with timeout
                const maxRetries = 3;
                let retries = 0;
                let success = false;
                
                while (retries < maxRetries && !success) {
                    try {
                        await axios.post(
                            'https://telegram-msg-sender.maxxit.ai/api/telegram/send', 
                            payload,
                            { timeout: 10000 } // 10 second timeout
                        );
                        success = true;
                        console.log(`Backtested signal sent to ${username} for ${tokenId}`);
                        
                        // Update the sent status for this specific subscriber
                        await resultsCollection.updateOne(
                            { _id: documentId, "subscribers.username": username },
                            { $set: { "subscribers.$.sent": true } }
                        );
                    } catch (retryError) {
                        retries++;
                        if (retries >= maxRetries) {
                            throw retryError; // Rethrow if max retries reached
                        }
                        console.log(`Retry ${retries}/${maxRetries} for ${username}`);
                        // Exponential backoff
                        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
                    }
                }
            } catch (error) {
                console.error(`Failed to send backtested signal to ${username}:`, error.message);
            }
        }
        
        // Check if all subscribers have received the message
        const updatedSubscribers = (await resultsCollection.findOne({ _id: documentId })).subscribers || [];
        const allSubscribersSent = updatedSubscribers.every(sub => sub.sent === true);
        
        if (allSubscribersSent) {
            await resultsCollection.updateOne(
                { _id: documentId },
                { $set: { messageSent: true } }
            );
            console.log(`All subscribers have received backtested signal for ${tokenId}`);
        }
        
        await closeConnection(client);
    } catch (error) {
        console.error('Error sending backtested signal to subscribers:', error);
    }
}

// Main function to process signals from MongoDB
async function processSignals() {
    try {
        const client = await connect();
        console.log('Connected to MongoDB');
        const db = client.db(dbName);
        const sourceCollection = db.collection(sourceCollectionName);
        const collection = db.collection(collectionName);
        const tradesCollection = db.collection(tradesCollectionName);

        // Find all signals that haven't been processed yet
        const signals = await sourceCollection.find({ backtesting_done: false }).toArray();
        console.log(`Found ${signals.length} signals to process`);

        // Define strategies
        const strategies = {
            'Trailing Stop': { type: 'trailing', params: { trailPercent: 0.01 } },
            'SMA10': { type: 'sma', params: { period: 10 } },
            'SMA20': { type: 'sma', params: { period: 20 } },
            'EMA10': { type: 'ema', params: { period: 10 } },
            'EMA20': { type: 'ema', params: { period: 20 } },
            'Dynamic TP/SL': { type: 'dynamic_tp_sl' }
        };

        // Cache for price data
        const priceCache = {};

        // Process each signal
        for (const signal of signals) {
            const tokenId = signal["Token ID"];
            console.log(`Processing signal for token ${tokenId}`);

            if (signal["Final Exit Price"]) {
                console.log(`Signal for token ${tokenId} already has an exit price, skipping`);
                await sourceCollection.updateOne(
                    { _id: signal._id },
                    { $set: { backtesting_done: true } }
                );
                continue;
            }

            // Fetch price data if not in cache
            if (!priceCache[tokenId]) {
                const priceData = await fetchPriceData(tokenId);
                if (!priceData) {
                    console.warn(`No price data for ${tokenId}, skipping`);
                    continue;
                }
                priceCache[tokenId] = priceData;
            }

            const twitterAccount = signal["Twitter Account"];
            const signalType = signal["Signal Message"]; // Get the signal type (Buy, Put Options, Hold)

            let tweetTimestamp;
            try {
                tweetTimestamp = parseDateToTimestamp(signal["Tweet Date"]);
            } catch (error) {
                console.error(`Error parsing Tweet Date for token ${tokenId}: ${signal["Tweet Date"]}`, error);
                continue;
            }

            let maxExitTimestamp;
            try {
                maxExitTimestamp = parseDateToTimestamp(signal["Max Exit Time"]);
            } catch (error) {
                console.error(`Error parsing Max Exit Time for token ${tokenId}: ${signal["Max Exit Time"]}`, error);
                continue;
            }

            const prices = priceCache[tokenId].filter(([ts]) => ts >= tweetTimestamp);
            if (prices.length === 0) {
                console.warn(`No price data after tweet date for ${tokenId}`);
                continue;
            }

            const priceAtTweet = parseFloat(signal["Price at Tweet"]);
            const TP1 = parseFloat(signal["TP1"]);
            const SL = parseFloat(signal["SL"]);

            // For Put Options, our expectations are inverted - we want the price to drop
            const isPutOptions = signalType === "Put Options";
            
            if (!isPutOptions && (priceAtTweet > TP1 || priceAtTweet < SL)) {
                console.warn(`Invalid price conditions for ${tokenId}: Price at Tweet > TP1 or < SL`);
                continue;
            }

            // For put options, the validation logic is inverted (we want price to fall)
            if (isPutOptions && (priceAtTweet < TP1 || priceAtTweet > SL)) {
                console.warn(`Invalid price conditions for Put Options ${tokenId}: Price at Tweet < TP1 or > SL`);
                continue;
            }

            // Initialize strategy states
            const strategyStates = {};
            for (const [name, config] of Object.entries(strategies)) {
                strategyStates[name] = {
                    exitPrice: null,
                    tp1Hit: false,
                    peakPrice: priceAtTweet,
                    lowestPrice: priceAtTweet, // For put options - track the lowest price
                    priceWindow: [],
                    ma: null,
                    prevEMA: null,
                    isPutOptions: isPutOptions
                };
                if (config.type === 'dynamic_tp_sl') {
                    strategyStates[name].current_SL = SL;
                    strategyStates[name].current_TP = TP1;
                    const diff = Math.abs(TP1 - priceAtTweet);
                    strategyStates[name].increment = isPutOptions ? -diff : diff;
                }
            }

            // Process prices with Max Exit Time check
            for (const [ts, price] of prices) {
                for (const [name, state] of Object.entries(strategyStates)) {
                    if (state.exitPrice !== null) continue;

                    if (ts >= maxExitTimestamp) {
                        state.exitPrice = price;
                        continue;
                    }

                    const config = strategies[name];

                    if (config.type === 'dynamic_tp_sl') {
                        if (state.isPutOptions) {
                            // For Put Options, logic is reversed
                            if (price >= state.current_SL) {
                                state.exitPrice = state.current_SL;
                            } else if (price <= state.current_TP) {
                                state.current_SL = state.current_TP;
                                state.current_TP += state.increment; // Will be negative for put options
                            }
                        } else {
                            // Original Buy logic
                            if (price <= state.current_SL) {
                                state.exitPrice = state.current_SL;
                            } else if (price >= state.current_TP) {
                                state.current_SL = state.current_TP;
                                state.current_TP += state.increment;
                            }
                        }
                    } else {
                        if (config.type === 'sma' || config.type === 'ema') {
                            state.priceWindow.push(price);
                            if (state.priceWindow.length > config.params.period) {
                                state.priceWindow.shift();
                            }
                        }

                        if (config.type === 'sma' && state.priceWindow.length >= config.params.period) {
                            state.ma = state.priceWindow.reduce((a, b) => a + b, 0) / state.priceWindow.length;
                        } else if (config.type === 'ema') {
                            if (state.prevEMA === null) {
                                if (state.priceWindow.length >= config.params.period) {
                                    state.prevEMA = state.priceWindow.slice(0, config.params.period).reduce((a, b) => a + b, 0) / config.params.period;
                                } else {
                                    state.prevEMA = priceAtTweet;
                                }
                            }
                            state.ma = calculateEMA(state.prevEMA, price, config.params.period);
                            state.prevEMA = state.ma;
                        }

                        if (state.isPutOptions) {
                            // For Put Options
                            if (price >= SL) {
                                state.exitPrice = SL;
                                continue;
                            }

                            if (price <= TP1) {
                                state.tp1Hit = true;
                            }

                            if (price < state.lowestPrice) {
                                state.lowestPrice = price;
                            }
                        } else {
                            // For Buy
                            if (price <= SL) {
                                state.exitPrice = SL;
                                continue;
                            }

                            if (price >= TP1) {
                                state.tp1Hit = true;
                            }
                            
                            if (price > state.peakPrice) {
                                state.peakPrice = price;
                            }
                        }

                        if (state.tp1Hit) {
                            if (config.type === 'trailing') {
                                if (state.isPutOptions) {
                                    // For Put Options - we exit when price rises by trail percent from the lowest
                                    if (price >= state.lowestPrice * (1 + config.params.trailPercent)) {
                                        state.exitPrice = price;
                                    }
                                } else {
                                    // For Buy - we exit when price falls by trail percent from peak
                                    if (price <= state.peakPrice * (1 - config.params.trailPercent)) {
                                        state.exitPrice = price;
                                    }
                                }
                            } else if (config.type === 'sma' || config.type === 'ema') {
                                if (state.ma !== null) {
                                    if (state.isPutOptions) {
                                        // For Put Options - exit when price rises above MA
                                        if (price > state.ma) {
                                            state.exitPrice = price;
                                        }
                                    } else {
                                        // For Buy - exit when price falls below MA
                                        if (price < state.ma) {
                                            state.exitPrice = price;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            const exitedStrategies = Object.entries(strategyStates).filter(([_, state]) => state.exitPrice !== null);
            if (exitedStrategies.length === 0) {
                console.log(`No strategy exited for token ${tokenId}`);
                continue;
            }

            // Calculate P&L and prepare document
            const document = { ...signal };
            const strategyPnLs = {};
            for (const [name, state] of exitedStrategies) {
                let pnl;
                if (state.isPutOptions) {
                    // For Put Options - profit when price falls, loss when price rises
                    pnl = ((priceAtTweet - state.exitPrice) / priceAtTweet) * 100;
                } else {
                    // For Buy - profit when price rises, loss when price falls
                    pnl = ((state.exitPrice - priceAtTweet) / priceAtTweet) * 100;
                }
                document[`Exit Price (${name})`] = state.exitPrice;
                document[`P&L (${name})`] = pnl.toFixed(2) + "%";
                strategyPnLs[name] = pnl.toFixed(2) + "%";
            }

            let bestPnL = -Infinity;
            let bestExitPrice = null;
            let bestStrategy = null;
            for (const [name, state] of exitedStrategies) {
                let pnl;
                if (state.isPutOptions) {
                    pnl = ((priceAtTweet - state.exitPrice) / priceAtTweet) * 100;
                } else {
                    pnl = ((state.exitPrice - priceAtTweet) / priceAtTweet) * 100;
                }
                if (pnl > bestPnL) {
                    bestPnL = pnl;
                    bestExitPrice = state.exitPrice;
                    bestStrategy = name;
                }
            }
            document['Final Exit Price'] = bestExitPrice;
            document['Final P&L'] = bestPnL.toFixed(2) + "%";
            document['Best Strategy'] = bestStrategy;
            document['backtesting_done'] = true;

            const reasoning = await getReasoningFromLLM(tokenId, bestStrategy, strategyPnLs, signalType);
            document['Reasoning'] = reasoning;

            // Store in MongoDB (results collection)
            const insertResult = await collection.insertOne(document);
            console.log(`Inserted backtesting result for token: ${tokenId} into MongoDB`);

            // Update the source document as processed
            await sourceCollection.updateOne(
                { _id: signal._id },
                { $set: { 
                    backtesting_done: true,
                    'Final Exit Price': bestExitPrice,
                    'Final P&L': bestPnL.toFixed(2) + "%",
                    'Best Strategy': bestStrategy,
                    'Reasoning': reasoning
                } }
            );

            // Send backtested signal to subscribers
            await sendBacktestedSignalToSubscribers(
                twitterAccount, 
                signal, 
                bestPnL.toFixed(2) + "%", 
                bestExitPrice,
                reasoning,
                insertResult.insertedId
            );

            // Prepare minimal object for IPFS
            const ipfsDoc = {
                "Signal Generation Date": signal["Signal Generation Date"],
                "Signal Type": signalType,
                "Entry Price": signal["Price at Tweet"],
                "Coin ID": tokenId,
                "TP1": signal["TP1"],
                "TP2": signal["TP2"],
                "SL": signal["SL"],
                "Exit Price": bestExitPrice,
                "P&L": bestPnL.toFixed(2) + "%",
                "Reasoning": reasoning
            };

            // Upload to Lighthouse (IPFS)
            try {
                const documentJson = stringify(ipfsDoc);
                const buffer = Buffer.from(documentJson);
                const cidObj = await lighthouse.uploadBuffer(buffer, process.env.LIGHTHOUSE_API_KEY);
                console.log(`IPFS CID for ${tokenId}: ${cidObj?.data?.Hash}`);

                if (cidObj?.data?.Hash) {
                    // Store trade metadata in MongoDB
                    const tradeId = `${twitterAccount}_${signal["Tweet Date"]}`; // Unique trade identifier
                    await tradesCollection.insertOne({
                        tradeId,
                        cid: cidObj.data.Hash,
                        timestamp: Date.now(),
                        backtesting_done: true
                    });
                    console.log(`Stored trade metadata for ${tradeId} with CID: ${cidObj.data.Hash}`);

                    // Update the results document with the IPFS link
                    await collection.updateOne(
                        { _id: insertResult.insertedId },
                        { $set: { "IPFS Link": `https://gateway.lighthouse.storage/ipfs/${cidObj.data.Hash}` } }
                    );
                    console.log(`Updated document for token: ${tokenId} with IPFS Link`);
                }
            } catch (error) {
                console.error(`Error uploading to Lighthouse for ${tokenId}: ${error.message}`);
            }
        }

        console.log('All signals processed');
        await closeConnection(client);
    } catch (error) {
        console.error('Error processing signals:', error);
        const client = await connect();
        if (client) {
            await closeConnection(client);
        }
    }
}

module.exports = { processSignals }