// src/services/messageSender.js
const { processAndSendTradingSignalMessage } = require('./telegramService');

async function messageSender() {
    try {
        await processAndSendTradingSignalMessage();
        await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
        console.error('Error in messageSender:', error);
    }
}

module.exports = { messageSender };
