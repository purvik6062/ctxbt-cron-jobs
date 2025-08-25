// src/services/messageSender.js
const { processAndSendTradingSignalMessage, getDeliveryConfig } = require('./telegramService');

async function messageSender() {
    const startTime = Date.now();
    
    try {
        console.log('🚀 Starting message sender service...');
        
        // Log current delivery configuration
        const config = getDeliveryConfig();
        console.log('⚙️  Current delivery configuration:', {
            batchSize: config.batchSize,
            delayBetweenBatches: `${config.delayBetweenBatches / 1000 / 60} minutes`,
            delayBetweenSignals: `${config.delayBetweenSignals / 1000} seconds`,
            maxDeliveryTime: `${config.maxDeliveryTime / 1000 / 60} minutes`
        });

        // Process and send messages with progressive delivery
        const deliverySummary = await processAndSendTradingSignalMessage();
        
        const totalTime = Date.now() - startTime;
        
        console.log('\n🎯 MESSAGE SENDER SERVICE COMPLETED');
        console.log(`⏱️  Total service time: ${Math.round(totalTime / 1000)} seconds`);
        console.log(`📊 Delivery summary:`, deliverySummary);
        
        // Add a small delay before completing
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return deliverySummary;
        
    } catch (error) {
        console.error('❌ Error in messageSender:', error);
        throw error;
    }
}

module.exports = { messageSender };
