// src/config/config.js
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

console.log("mongo uri", process.env.MONGODB_URI)

module.exports = {
    mongoUri: process.env.MONGODB_URI,
    dbName: 'ctxbt-signal-flow',
    userCollectionName: 'users',
    influencerCollectionName: 'influencers',
    tradingSignalsCollectionName: 'trading-signals',
    scrapeEndpoint: 'https://tweets-scraper.ctxbt.com/scrape',
    scraperCredentials: {
        user: "",
        password: "",
        tweets: 5
    },
    openAI: {
        apiKey: process.env.OPENAI_API_KEY
    },
    coingeckoApiUrl: 'https://api.coingecko.com/api/v3',
    perplexity: {
        apiKey: process.env.PERPLEXITY_API_KEY,
        endpoint: 'https://api.perplexity.ai/v1/completions',
    }
};
