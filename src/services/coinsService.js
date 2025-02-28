// src/services/coinsService.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { coingeckoApiUrl } = require('../config/config');

const url = coingeckoApiUrl;
const options = { method: 'GET', headers: { accept: 'application/json' } };

async function fetchAndUpdateCoins() {
    try {
        const response = await axios.get(`${url}/coins/list`, options);
        const coinsList = response.data;
        // Save coins.json in the project root (adjust path as needed)
        // const filePath = path.join(__dirname, '../../coins.json');
        const filePath = path.join(__dirname, '../utils/coins.json');
        fs.writeFileSync(filePath, JSON.stringify(coinsList, null, 2), 'utf8');
        console.log(`Coins list updated successfully at ${new Date().toISOString()}`);
    } catch (error) {
        console.error('Error fetching coins list:', error.message);
    }
}

module.exports = { fetchAndUpdateCoins };
