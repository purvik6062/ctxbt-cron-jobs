const { connect, closeConnection } = require('../db'); // Database connection module
const { dbName, tradingSignalsCollectionName } = require('../config/config'); // Configuration
const axios = require('axios'); // For making HTTP requests to Telegram API

// Configuration for progressive message delivery
const DELIVERY_CONFIG = {
    batchSize: 6,           // Number of signals to send per batch
    delayBetweenBatches: 1 * 60 * 1000,  // 1 minute between batches
    delayBetweenSignals: 10 * 1000,      // 10 seconds between individual signals
};

/**
 * Sends a single signal message to a subscriber with retry logic
 * @param {string} username - Subscriber username
 * @param {string} message - Signal message content
 * @param {string} documentId - Document ID for tracking
 * @returns {boolean} - Success status
 */
async function sendSingleMessage(username, message, documentId) {
    const payload = {
        username: username,
        message: message
    };

    try {
        await axios.post('https://telegram-msg-sender.maxxit.ai/api/telegram/send', payload);
        console.log(`✅ Message sent to ${username} for document ${documentId}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send message to ${username} for document ${documentId}:`, error.message);
        return false;
    }
}

/**
 * Processes a batch of signals with delays between individual messages
 * @param {Array} batch - Array of signal documents to process
 * @param {Object} tradingSignalsCollection - Database collection
 * @returns {Object} - Processing results
 */
async function processBatch(batch, tradingSignalsCollection) {
    const results = {
        total: batch.length,
        successful: 0,
        failed: 0,
        details: []
    };

    console.log(`📦 Processing batch of ${batch.length} signals...`);

    for (let i = 0; i < batch.length; i++) {
        const doc = batch[i];
        const { signal_message, subscribers, _id } = doc;

        console.log(`📤 Processing signal ${i + 1}/${batch.length} (ID: ${_id})`);

        // Process each subscriber for this signal
        for (const subscriber of subscribers) {
            if (subscriber.sent === true) {
                continue;
            }

            const success = await sendSingleMessage(
                subscriber.username || subscriber,
                signal_message,
                _id
            );

            if (success) {
                // Update sent status for this subscriber
                await tradingSignalsCollection.updateOne(
                    { _id: _id, "subscribers.username": subscriber.username || subscriber },
                    { $set: { "subscribers.$.sent": true } }
                );
                results.successful++;
            } else {
                results.failed++;
            }

            // Add delay between individual signals (except for the last one)
            if (i < batch.length - 1 || subscriber !== subscribers[subscribers.length - 1]) {
                console.log(`⏳ Waiting ${DELIVERY_CONFIG.delayBetweenSignals / 1000}s before next signal...`);
                await new Promise(resolve => setTimeout(resolve, DELIVERY_CONFIG.delayBetweenSignals));
            }
        }

        // Check if all subscribers have received this signal
        const allSubscribersSent = subscribers.every(sub => sub.sent === true);
        if (allSubscribersSent) {
            await tradingSignalsCollection.updateOne(
                { _id: _id },
                { $set: { messageSent: true } }
            );
            console.log(`✅ All subscribers received signal ${_id}`);
        }

        results.details.push({
            documentId: _id,
            subscribersCount: subscribers.length,
            completed: allSubscribersSent
        });
    }

    return results;
}

/**
 * Main function to process and send trading signal messages progressively
 * @param {Object} options - Configuration options
 * @param {string} options.handleFilter - Optional Twitter handle to filter signals by
 * @returns {Object} - Delivery summary
 */
async function processAndSendTradingSignalMessage(options = {}) {
    const { handleFilter } = options;
    const startTime = Date.now();
    const client = await connect();

    try {
        const db = client.db(dbName);
        const tradingSignalsCollection = db.collection(tradingSignalsCollectionName);

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Build query conditions
        const queryConditions = [
            { generatedAt: { $gte: startOfToday } },
            {
                $or: [
                    { messageSent: { $exists: false } },
                    { messageSent: false },
                    { "subscribers.sent": { $ne: true } }
                ]
            }
        ];

        // Add handle filter if provided
        if (handleFilter) {
            queryConditions.push({ twitterHandle: handleFilter });
        }

        // Step 1: Fetch documents where at least one subscriber hasn't received the message
        const documents = await tradingSignalsCollection
            .find({
                $and: queryConditions
            })
            .sort({ generatedAt: 1 }) // Process oldest signals first
            .toArray();

        if (documents.length === 0) {
            const filterMsg = handleFilter ? ` for handle @${handleFilter}` : '';
            console.log(`📭 No pending signals to send${filterMsg}`);
            return { total: 0, batches: 0, deliveryTime: 0 };
        }

        const filterMsg = handleFilter ? ` for handle @${handleFilter}` : '';
        console.log(`🚀 Starting progressive delivery of ${documents.length} signals${filterMsg}...`);
        console.log(`⚙️  Configuration: ${DELIVERY_CONFIG.batchSize} signals per batch, ${DELIVERY_CONFIG.delayBetweenBatches / 1000}s between batches`);

        // Step 2: Split documents into batches
        const batches = [];
        for (let i = 0; i < documents.length; i += DELIVERY_CONFIG.batchSize) {
            batches.push(documents.slice(i, i + DELIVERY_CONFIG.batchSize));
        }

        console.log(`📊 Split into ${batches.length} batches`);

        // Step 3: Process batches with delays
        const batchResults = [];
        let totalSuccessful = 0;
        let totalFailed = 0;

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            console.log(`\n🔄 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} signals)`);

            const batchResult = await processBatch(batch, tradingSignalsCollection);
            batchResults.push(batchResult);
            
            totalSuccessful += batchResult.successful;
            totalFailed += batchResult.failed;

            // Add delay between batches (except for the last batch)
            if (batchIndex < batches.length - 1) {
                console.log(`⏳ Waiting ${DELIVERY_CONFIG.delayBetweenBatches / 1000} minutes before next batch...`);
                await new Promise(resolve => setTimeout(resolve, DELIVERY_CONFIG.delayBetweenBatches));
            }
        }

        const totalDeliveryTime = Date.now() - startTime;
        
        // Step 4: Generate delivery summary
        const summary = {
            total: documents.length,
            batches: batches.length,
            successful: totalSuccessful,
            failed: totalFailed,
            deliveryTime: totalDeliveryTime,
            deliveryTimeMinutes: Math.round(totalDeliveryTime / 1000 / 60 * 100) / 100,
            batchResults: batchResults,
            configuration: DELIVERY_CONFIG
        };

        console.log('\n📈 DELIVERY SUMMARY:');
        console.log(`   Total signals: ${summary.total}`);
        console.log(`   Batches processed: ${summary.batches}`);
        console.log(`   Successful deliveries: ${summary.successful}`);
        console.log(`   Failed deliveries: ${summary.failed}`);
        console.log(`   Total delivery time: ${summary.deliveryTimeMinutes} minutes`);
        console.log(`   Average time per signal: ${Math.round(totalDeliveryTime / documents.length / 1000)} seconds`);

        return summary;

    } catch (error) {
        console.error('❌ Error in processAndSendTradingSignalMessage:', error);
        throw error;
    } finally {
        await closeConnection(client);
    }
}

/**
 * Utility function to get current delivery configuration
 * @returns {Object} - Current delivery configuration
 */
function getDeliveryConfig() {
    return { ...DELIVERY_CONFIG };
}

/**
 * Utility function to update delivery configuration
 * @param {Object} newConfig - New configuration object
 */
function updateDeliveryConfig(newConfig) {
    Object.assign(DELIVERY_CONFIG, newConfig);
    console.log('⚙️  Delivery configuration updated:', DELIVERY_CONFIG);
}

module.exports = { 
    processAndSendTradingSignalMessage,
    getDeliveryConfig,
    updateDeliveryConfig
};