const { connect } = require('../db'); // Database connection module
const { dbName, tradingSignalsCollectionName } = require('../config/config'); // Configuration
const axios = require('axios'); // For making HTTP requests to Telegram API

async function processAndSendTradingSignalMessage() {
    const client = await connect();
    try {
        const db = client.db(dbName);
        const tradingSignalsCollection = db.collection(tradingSignalsCollectionName);

        // Step 1: Fetch the top 10 documents where messageSent is false
        const documents = await tradingSignalsCollection
            .find({ messageSent: false })
            .limit(10)  // Fetch only the first 10 documents
            .toArray();

        // Step 2: Process each document sequentially
        for (const doc of documents) {
            const { signal_message, subscribers, _id } = doc;
            let allSentSuccessfully = true;

            // Step 3: Send message to each subscriber
            for (const subscriber of subscribers) {
                const payload = {
                    username: subscriber,
                    message: signal_message
                };
                try {
                    await axios.post('http://localhost:3001/api/telegram/send', payload);
                    console.log(`Message sent to ${subscriber} for document ${_id}`);
                } catch (error) {
                    console.error(`Failed to send message to ${subscriber} for document ${_id}:`, error.message);
                    allSentSuccessfully = false;
                }
            }

            // Step 4: Update messageSent only if all sends were successful
            if (allSentSuccessfully) {
                await tradingSignalsCollection.updateOne(
                    { _id: _id },
                    { $set: { messageSent: true } }
                );
                console.log(`Updated document ${_id} with messageSent: true`);
            } else {
                console.log(`Did not update document ${_id} due to send failures`);
            }
        }
    } catch (error) {
        console.error('Error in processAndSendTradingSignalMessage:', error);
    } finally {
        await client.close();
    }
}

module.exports = { processAndSendTradingSignalMessage };