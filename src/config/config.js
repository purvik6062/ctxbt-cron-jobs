// src/config/config.js
const dotenv = require('dotenv');
dotenv.config();

module.exports = {
    mongoUri: process.env.MONGODB_URI,
    dbName: 'ctxbt-signal-flow',
    userCollectionName: 'users',
    influencerCollectionName: 'influencers',
    tradingSignalsCollectionName: 'trading-signals',
    scrapeEndpoint: 'http://127.0.0.1:8000/scrape',
    scraperCredentials: {
        user: "",
        password: "",
        tweets: 20
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
