const fs = require('fs');
const Papa = require('papaparse');
const { MongoClient } = require('mongodb');
const OpenAI = require('openai');
const dotenv = require('dotenv');

dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = 'backtesting_db';
const collectionName = 'backtesting_results_with_reasoning';

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

// Main function to process the CSV and store in MongoDB
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

        // Process each row
        for (const row of rows) {
            const tokenId = row["Token ID"];
            const tweetUrl = row["Tweet"];
            
            // Skip if no tweet URL is provided
            if (!tweetUrl) {
                console.warn(`Skipping row for token ${tokenId} as no Tweet URL is provided`);
                continue;
            }
            
            // Check if this tweet URL already exists in the database
            const existingRecord = await collection.findOne({ "Tweet": tweetUrl });
            
            if (existingRecord) {
                console.log(`Skipping row for token ${tokenId} as Tweet URL already exists in database: ${tweetUrl}`);
                continue;
            }
            
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

            // **Change 2: Parse Max Exit Time**
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

            // **Change 3: Process prices with Max Exit Time check**
            for (const [ts, price] of prices) {
                for (const [name, state] of Object.entries(strategyStates)) {
                    if (state.exitPrice !== null) continue;

                    // Exit at this price if timestamp >= Max Exit Time
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
                        // Update price window for SMA and EMA
                        if (config.type === 'sma' || config.type === 'ema') {
                            state.priceWindow.push(price);
                            if (state.priceWindow.length > config.params.period) {
                                state.priceWindow.shift();
                            }
                        }

                        // Calculate MA
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

                        // Check SL
                        if (price <= SL) {
                            state.exitPrice = SL;
                            continue;
                        }

                        // Check TP1
                        if (price >= TP1) {
                            state.tp1Hit = true;
                        }

                        // After TP1, apply strategy
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

            // **Change 4: Do not set exitPrice to last price if not exited**
            // Removed the previous code that set exitPrice to lastPrice

            // **Change 5: Skip document if no strategy exited**
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

            // Find best performing strategy among exited ones
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

            // Get reasoning from LLM
            const reasoning = await getReasoningFromLLM(tokenId, bestStrategy, strategyPnLs);
            document['Reasoning'] = reasoning;

            // Insert into MongoDB
            try {
                await collection.insertOne(document);
                console.log(`Inserted document for token: ${tokenId} with reasoning`);
            } catch (error) {
                console.error(`Error inserting document for token: ${tokenId}`, error);
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
// processCSV('backtesting_testing.csv')
//     .catch(error => console.error('Error:', error));

module.exports = { processCSV };