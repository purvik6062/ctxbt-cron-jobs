const { connect, closeConnection } = require('../db'); // Database connection module
const { dbName, tradingSignalsCollectionName } = require('../config/config'); // Configuration
const axios = require('axios'); // For making HTTP requests to Telegram API

async function processAndSendTradingSignalMessage() {
    const client = await connect();
    try {
        const db = client.db(dbName);
        const tradingSignalsCollection = db.collection(tradingSignalsCollectionName);

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Step 1: Fetch documents where at least one subscriber hasn't received the message
        const documents = await tradingSignalsCollection
            .find({
                $and: [
                    { generatedAt: { $gte: startOfToday } },
                    {
                        $or: [
                            { messageSent: { $exists: false } },
                            { messageSent: false },
                            { "subscribers.sent": { $ne: true } }
                        ]
                    }
                ]
            })
            .toArray();

        // Step 2: Process each document sequentially
        for (const doc of documents) {
            const { signal_message, subscribers, _id } = doc;

            // Initialize sent status for subscribers if not exists
            if (!doc.subscribers || !Array.isArray(doc.subscribers)) {
                console.error(`Invalid subscribers format for document ${_id}`);
                continue;
            }

            // Step 3: Send message to each subscriber who hasn't received it
            for (const subscriber of subscribers) {
                // Skip if this subscriber has already received the message
                if (subscriber.sent === true) {
                    continue;
                }

                const payload = {
                    username: subscriber.username || subscriber, // Handle both object and string formats
                    message: signal_message
                };

                try {
                    await axios.post('https://telegram-msg-sender.maxxit.ai/api/telegram/send', payload);
                    console.log(`Message sent to ${payload.username} for document ${_id}`);

                    // Update the sent status for this specific subscriber
                    await tradingSignalsCollection.updateOne(
                        { _id: _id, "subscribers.username": payload.username },
                        { $set: { "subscribers.$.sent": true } }
                    );
                } catch (error) {
                    console.error(`Failed to send message to ${payload.username} for document ${_id}:`, error.message);
                }
            }

            // Check if all subscribers have received the message
            const allSubscribersSent = subscribers.every(sub => sub.sent === true);
            if (allSubscribersSent) {
                try {
                    await tradingSignalsCollection.updateOne(
                        { _id: _id },
                        { $set: { messageSent: true } }
                    );
                    console.log(`All subscribers have received message for document ${_id}`);
                } catch (updateError) {
                    console.error(`Failed to update messageSent status for document ${_id}:`, updateError);
                }
            }
        }
    } catch (error) {
        console.error('Error in processAndSendTradingSignalMessage:', error);
    } finally {
        // Use the new closeConnection function instead of client.close()
        await closeConnection(client);
    }
}

module.exports = { processAndSendTradingSignalMessage };