// src/config/config.js
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

console.log(process.env.MONGODB_URI);

module.exports = {
    mongoUri: process.env.MONGODB_URI,
    dbName: 'ctxbt-signal-flow',
    userCollectionName: 'users',
    influencerCollectionName: 'influencers',
    tradingSignalsCollectionName: 'trading-signals',
    scrapeEndpoint: 'https://tweets-scraper.maxxit.ai/scrape',
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
    },
    tweetScoutApiKey: process.env.TWEETSCOUT_API_KEY,
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN
    },
    hyperliquid: {
        apiUrl: process.env.HYPERLIQUID_API_URL || 'http://localhost:5000/signal',
        timeout: parseInt(process.env.HYPERLIQUID_API_TIMEOUT) || 10000
    }
};
