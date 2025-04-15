require('dotenv').config();
const fs = require('fs');
const Papa = require('papaparse');
const { MongoClient } = require('mongodb');
const OpenAI = require('openai');
const lighthouse = require('@lighthouse-web3/sdk');
const stringify = require('json-stable-stringify');
const path = require('path');

// Explicitly provide the path to the .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Configuration
const uri = process.env.MONGODB_URI;
const dbName = 'backtesting_db';
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
async function getReasoningFromLLM(tokenId, bestStrategy, strategyPnLs) {
    const prompt = `
        For the token "${tokenId}", the best strategy was "${bestStrategy}" with a P&L of ${strategyPnLs[bestStrategy]}.
        P&L values for all strategies:
        ${Object.entries(strategyPnLs).map(([strategy, pnl]) => `- ${strategy}: ${pnl}`).join('\n')}
        Provide a brief reasoning (1-2 sentences) why "${bestStrategy}" might have been the best choice.
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

// Main function to process the CSV and store in MongoDB and Lighthouse
async function processCSV(inputCSV) {
    const fileContent = fs.readFileSync(inputCSV, 'utf8');
    const parsed = Papa.parse(fileContent, { header: true });
    const rows = parsed.data;

    const uniqueTokenIds = [...new Set(rows.map(row => row["Token ID"]))];
    const pricePromises = uniqueTokenIds.map(tokenId =>
        fetchPriceData(tokenId).then(data => [tokenId, data])
    );
    const priceResults = await Promise.all(pricePromises);

    const priceCache = {};
    for (const [tokenId, data] of priceResults) {
        if (data) {
            priceCache[tokenId] = data;
        } else {
            console.warn(`No price data for ${tokenId}`);
        }
    }

    // Define strategies
    const strategies = {
        'Trailing Stop': { type: 'trailing', params: { trailPercent: 0.01 } },
        'SMA10': { type: 'sma', params: { period: 10 } },
        'SMA20': { type: 'sma', params: { period: 20 } },
        'EMA10': { type: 'ema', params: { period: 10 } },
        'EMA20': { type: 'ema', params: { period: 20 } },
        'Dynamic TP/SL': { type: 'dynamic_tp_sl' }
    };

    // Connect to MongoDB
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        const tradesCollection = db.collection(tradesCollectionName);

        // Process each row
        for (const row of rows) {
            if (row["Final Exit Price"] && row["Final Exit Price"].trim() !== "") {
                console.log(`Skipping row for token ${row["Token ID"]} as Exit Price is already calculated: ${row["Final Exit Price"]}`);
                continue;
            }

            const tokenId = row["Token ID"];
            const twitterAccount = row["Twitter Account"];
            if (!priceCache[tokenId]) {
                console.warn(`Skipping row due to no price data for ${tokenId}`);
                continue;
            }

            let tweetTimestamp;
            try {
                tweetTimestamp = parseDateToTimestamp(row["Tweet Date"]);
            } catch (error) {
                console.error(`Error parsing Tweet Date for row: ${row["Tweet Date"]}`, error);
                continue;
            }

            let maxExitTimestamp;
            try {
                maxExitTimestamp = parseDateToTimestamp(row["Max Exit Time"]);
            } catch (error) {
                console.error(`Error parsing Max Exit Time for row: ${row["Max Exit Time"]}`, error);
                continue;
            }

            const prices = priceCache[tokenId].filter(([ts]) => ts >= tweetTimestamp);
            if (prices.length === 0) {
                console.warn(`No price data after tweet date for ${tokenId}`);
                continue;
            }

            const priceAtTweet = parseFloat(row["Price at Tweet"]);
            const TP1 = parseFloat(row["TP1"]);
            const SL = parseFloat(row["SL"]);

            if (priceAtTweet > TP1 || priceAtTweet < SL) {
                console.warn(`Invalid price conditions for ${tokenId}: Price at Tweet > TP1 or < SL`);
                continue;
            }

            // Initialize strategy states
            const strategyStates = {};
            for (const [name, config] of Object.entries(strategies)) {
                strategyStates[name] = {
                    exitPrice: null,
                    tp1Hit: false,
                    peakPrice: priceAtTweet,
                    priceWindow: [],
                    ma: null,
                    prevEMA: null
                };
                if (config.type === 'dynamic_tp_sl') {
                    strategyStates[name].current_SL = SL;
                    strategyStates[name].current_TP = TP1;
                    strategyStates[name].increment = TP1 - priceAtTweet;
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
                        if (price <= state.current_SL) {
                            state.exitPrice = state.current_SL;
                        } else if (price >= state.current_TP) {
                            state.current_SL = state.current_TP;
                            state.current_TP += state.increment;
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

                        if (price <= SL) {
                            state.exitPrice = SL;
                            continue;
                        }

                        if (price >= TP1) {
                            state.tp1Hit = true;
                        }

                        if (state.tp1Hit) {
                            if (config.type === 'trailing') {
                                if (price > state.peakPrice) {
                                    state.peakPrice = price;
                                }
                                if (price <= state.peakPrice * (1 - config.params.trailPercent)) {
                                    state.exitPrice = price;
                                }
                            } else if (config.type === 'sma' || config.type === 'ema') {
                                if (state.ma !== null && price < state.ma) {
                                    state.exitPrice = price;
                                }
                            }
                        }
                    }
                }
            }

            const exitedStrategies = Object.entries(strategyStates).filter(([_, state]) => state.exitPrice !== null);
            if (exitedStrategies.length === 0) {
                console.log(`Skipping row for token ${tokenId} as no strategy exited by Max Exit Time`);
                continue;
            }

            // Calculate P&L and prepare document
            const document = { ...row };
            const strategyPnLs = {};
            for (const [name, state] of exitedStrategies) {
                const pnl = ((state.exitPrice - priceAtTweet) / priceAtTweet) * 100;
                document[`Exit Price (${name})`] = state.exitPrice;
                document[`P&L (${name})`] = pnl.toFixed(2) + "%";
                strategyPnLs[name] = pnl.toFixed(2) + "%";
            }

            let bestPnL = -Infinity;
            let bestExitPrice = null;
            let bestStrategy = null;
            for (const [name, state] of exitedStrategies) {
                const pnl = ((state.exitPrice - priceAtTweet) / priceAtTweet) * 100;
                if (pnl > bestPnL) {
                    bestPnL = pnl;
                    bestExitPrice = state.exitPrice;
                    bestStrategy = name;
                }
            }
            document['Final Exit Price'] = bestExitPrice;
            document['Final P&L'] = bestPnL.toFixed(2) + "%";
            document['Best Strategy'] = bestStrategy;

            const reasoning = await getReasoningFromLLM(tokenId, bestStrategy, strategyPnLs);
            document['Reasoning'] = reasoning;

            // Store in MongoDB (original collection)
            const insertResult = await collection.insertOne(document);
            console.log(`Inserted document for token: ${tokenId} into MongoDB`);

            // Prepare minimal object for IPFS
            const ipfsDoc = {
                "Signal Generation Date": row["Signal Generation Date"],
                "Entry Price": row["Price at Tweet"],
                "Coin ID": row["Token ID"],
                "TP1": row["TP1"],
                "TP2": row["TP2"],
                "SL": row["SL"],
                "Exit Price": document['Final Exit Price'],
                "P&L": document['Final P&L'],
                "Reasoning": document['Reasoning']
            };

            // Upload to Lighthouse (IPFS)
            const documentJson = stringify(ipfsDoc);
            const buffer = Buffer.from(documentJson);
            console.log("API Key: ", process.env.LIGHTHOUSE_API_KEY);
            console.log("Buffer length: ", buffer.length);
            
            try {
                const cidObj = await lighthouse.uploadBuffer(buffer, process.env.LIGHTHOUSE_API_KEY);
                console.log("CID: ", cidObj);
                
                if (cidObj?.data?.Hash) {
                    // Store trade metadata in MongoDB
                    const tradeId = `${twitterAccount}_${row["Tweet Date"]}`; // Unique trade identifier
                    await tradesCollection.insertOne({
                        tradeId,
                        cid: cidObj.data.Hash,
                        timestamp: Date.now()
                    });
                    console.log(`Stored trade metadata for ${tradeId} with CID: ${cidObj.data.Hash}`);

                    // Update the original trade document with the IPFS link
                    await collection.updateOne(
                        { _id: insertResult.insertedId },
                        { $set: { "IPFS Link": `https://gateway.lighthouse.storage/ipfs/${cidObj.data.Hash}` } }
                    );
                    console.log(`Updated document for token: ${tokenId} with IPFS Link`);
                }
            } catch (error) {
                console.error(`Error uploading to Lighthouse: ${error.message}`);
            }
        }
    } catch (error) {
        console.error('Error processing CSV:', error);
    } finally {
        await client.close();
        console.log('MongoDB connection closed');
    }
}

// Run the script
processCSV('backtesting_10_4_2025_1.csv')
    .catch(error => console.error('Error:', error));