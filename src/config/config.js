// src/config/config.js
const dotenv = require('dotenv');
dotenv.config();

module.exports = {
    mongoUri: process.env.MONGODB_URI,
    dbName: 'tradingMinds',
    userCollectionName: 'user-data',
    influencerCollectionName: 'influencer-data',
    scrapeEndpoint: 'http://127.0.0.1:8000/scrape',
    scraperCredentials: {
        user: "",
        password: "",
        tweets: 10
    },
    openAI: {
        apiKey: process.env.OPENAI_API_KEY
    },
    coingeckoApiUrl: 'https://api.coingecko.com/api/v3'
};
