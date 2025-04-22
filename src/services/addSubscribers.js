const { connect, closeConnection } = require('../db');
const { dbName, tradingSignalsCollectionName } = require('../config/config');

async function addSubscriber(twitterHandles, subscriber) {
    const client = await connect();
    try {
        const db = client.db(dbName);
        const tradingSignalsCollection = db.collection(tradingSignalsCollectionName);

        const updateResult = await tradingSignalsCollection.updateMany(
            { twitterHandle: { $in: twitterHandles } },
            { $addToSet: { subscribers: subscriber } }
        );

        console.log(
            `Matched ${updateResult.matchedCount} document(s) and modified ${updateResult.modifiedCount} document(s).`
        );
    } catch (error) {
        console.error("Error updating subscribers:", error);
    } finally {
        await closeConnection(client);
    }
}

module.exports = { addSubscriber };
