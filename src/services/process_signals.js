const fs = require('fs');
const Papa = require('papaparse');

// Function to parse tweet date from "DD/MM/YYYY" or "D-M-YYYY" to UTC timestamp
function parseTweetDate(dateStr) {
    let delimiter;
    if (dateStr.includes('/')) {
        delimiter = '/';
    } else if (dateStr.includes('-')) {
        delimiter = '-';
    } else {
        throw new Error(`Invalid date format: ${dateStr}`);
    }
    const [day, month, year] = dateStr.split(delimiter).map(Number);
    return Date.UTC(year, month - 1, day); // Timestamp for 00:00:00 UTC
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

// Main function to process the CSV
async function processCSV(inputCSV, outputCSV) {
    // Read and parse the input CSV
    const fileContent = fs.readFileSync(inputCSV, 'utf8');
    const parsed = Papa.parse(fileContent, { header: true });
    const rows = parsed.data;

    // Get unique token IDs
    const uniqueTokenIds = [...new Set(rows.map(row => row["Token ID"]))];

    // Fetch price data for all unique token IDs concurrently
    const pricePromises = uniqueTokenIds.map(tokenId =>
        fetchPriceData(tokenId).then(data => [tokenId, data])
    );
    const priceResults = await Promise.all(pricePromises);

    // Populate price cache
    const priceCache = {};
    for (const [tokenId, data] of priceResults) {
        if (data) {
            priceCache[tokenId] = data;
        } else {
            console.warn(`No price data for ${tokenId}`);
        }
    }

    // Process each row
    for (const row of rows) {
        const tokenId = row["Token ID"];
        if (!priceCache[tokenId]) {
            console.log(tokenId);
            row["Exit Price"] = "N/A";
            row["P&L"] = "N/A";
            continue;
        }

        let tweetTimestamp;
        try {
            tweetTimestamp = parseTweetDate(row["Tweet Date"]);
        } catch (error) {
            console.error(`Error parsing date for row: ${row["Tweet Date"]}`, error);
            row["Exit Price"] = "N/A";
            row["P&L"] = "N/A";
            continue;
        }

        const prices = priceCache[tokenId].filter(([ts]) => ts >= tweetTimestamp);

        if (prices.length === 0) {
            console.log(tokenId);
            row["Exit Price"] = "N/A";
            row["P&L"] = "N/A";
            continue;
        }

        const priceAtTweet = parseFloat(row["Price at Tweet"]);
        const TP1 = parseFloat(row["TP1"]);
        const SL = parseFloat(row["SL"]);

        let exitPrice = null;
        let peakPrice = priceAtTweet; // Initialize peak as starting price
        let tp1Hit = false;

        // Iterate through price data
        for (const [ts, price] of prices) {
            // Check SL first
            if (price <= SL) {
                exitPrice = SL;
                break;
            }

            // Check if TP1 is hit
            if (price >= TP1) {
                tp1Hit = true;
            }

            // After TP1 is hit, implement trailing stop
            if (tp1Hit) {
                if (price > peakPrice) {
                    peakPrice = price; // Update peak if price increases
                } else if (price <= peakPrice * 0.99) { // Exit if price drops 1% from peak
                    exitPrice = price;
                    break;
                }
            }
        }

        // If no exit condition was met, use the last price
        if (exitPrice === null) {
            exitPrice = prices[prices.length - 1][1];
        }

        // Calculate P&L
        const pnl = ((exitPrice - priceAtTweet) / priceAtTweet) * 100;
        row["Exit Price"] = exitPrice;
        row["P&L"] = pnl.toFixed(2) + "%";
    }

    // Write the updated CSV
    const updatedCSV = Papa.unparse(rows);
    fs.writeFileSync(outputCSV, updatedCSV);
    console.log(`Processing complete. Output saved to ${outputCSV}`);
}

// Run the script
processCSV('./backtest.csv', './result.csv')
    .catch(error => console.error('Error:', error));