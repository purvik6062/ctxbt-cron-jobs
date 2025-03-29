const fs = require('fs');
const Papa = require('papaparse');

// Function to parse tweet date from "DD/MM/YYYY" or "D-M-YYYY" to UTC timestamp
function parseTweetDate(dateStr) {
    if (dateStr.includes('T') && dateStr.endsWith('Z')) {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
            throw new Error(`Invalid ISO date format: ${dateStr}`);
        }
        return date.getTime();
    }

    let delimiter;
    if (dateStr.includes('/')) {
        delimiter = '/';
    } else if (dateStr.includes('-')) {
        delimiter = '-';
    } else {
        throw new Error(`Invalid date format: ${dateStr}`);
    }
    const [day, month, year] = dateStr.split(delimiter).map(Number);
    return Date.UTC(year, month - 1, day);
}

// Function to fetch 365-day price data from CoinGecko
async function fetchPriceData(coinId) {
    const url = `https://www.coingecko.com/price_charts/${coinId}/usd/365_days.json`;
    try {
        const response = await fetch(url);
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

// Main function to process the CSV
async function processCSV(inputCSV, outputCSV) {
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
        'EMA20': { type: 'ema', params: { period: 20 } }
    };

    // Process each row
    for (const row of rows) {
        const tokenId = row["Token ID"];
        if (!priceCache[tokenId]) {
            for (const strategy of Object.keys(strategies)) {
                row[`Exit Price (${strategy})`] = "N/A";
                row[`P&L (${strategy})`] = "N/A";
            }
            continue;
        }

        let tweetTimestamp;
        try {
            tweetTimestamp = parseTweetDate(row["Tweet Date"]);
        } catch (error) {
            console.error(`Error parsing date for row: ${row["Tweet Date"]}`, error);
            for (const strategy of Object.keys(strategies)) {
                row[`Exit Price (${strategy})`] = "N/A";
                row[`P&L (${strategy})`] = "N/A";
            }
            continue;
        }

        const prices = priceCache[tokenId].filter(([ts]) => ts >= tweetTimestamp);
        if (prices.length === 0) {
            for (const strategy of Object.keys(strategies)) {
                row[`Exit Price (${strategy})`] = "N/A";
                row[`P&L (${strategy})`] = "N/A";
            }
            continue;
        }

        const priceAtTweet = parseFloat(row["Price at Tweet"]);
        const TP1 = parseFloat(row["TP1"]);
        const SL = parseFloat(row["SL"]);

        if (priceAtTweet > TP1 || priceAtTweet < SL) {
            for (const strategy of Object.keys(strategies)) {
                row[`Exit Price (${strategy})`] = "N/A";
                row[`P&L (${strategy})`] = "N/A";
            }
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
        }

        // Iterate through price data
        for (const [ts, price] of prices) {
            for (const [name, state] of Object.entries(strategyStates)) {
                if (state.exitPrice !== null) continue;

                const config = strategies[name];

                // Update price window for SMA and EMA
                if (config.type === 'sma' || config.type === 'ema') {
                    state.priceWindow.push(price);
                    if (state.priceWindow.length > config.params.period) {
                        state.priceWindow.shift();
                    }
                }

                // Calculate MA
                if (config.type === 'sma' && state.priceWindow.length >= 1) {
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

                // After TP1, apply trailing stop
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

        // Use last price if no exit condition met
        const lastPrice = prices[prices.length - 1][1];
        for (const state of Object.values(strategyStates)) {
            if (state.exitPrice === null) {
                state.exitPrice = lastPrice;
            }
        }

        // Calculate P&L
        for (const [name, state] of Object.entries(strategyStates)) {
            const pnl = ((state.exitPrice - priceAtTweet) / priceAtTweet) * 100;
            row[`Exit Price (${name})`] = state.exitPrice;
            row[`P&L (${name})`] = pnl.toFixed(2) + "%";
        }
    }

    // Filter out rows with N/A before writing
    const validRows = rows.filter(row => {
        return !Object.entries(strategies).some(([name]) => 
            row[`Exit Price (${name})`] === "N/A" || 
            row[`P&L (${name})`] === "N/A"
        );
    });

    // Write the updated CSV with filtered rows
    const updatedCSV = Papa.unparse(validRows);
    fs.writeFileSync(outputCSV, updatedCSV);
    console.log(`Processing complete. Output saved to ${outputCSV}`);
    console.log(`Filtered out ${rows.length - validRows.length} rows with N/A values`);
}

// Run the script
processCSV('Updated_Sheet_28_3_2025.csv', 'Updated_Sheet_28_3_2025_multi_strat.csv')
    .catch(error => console.error('Error:', error));