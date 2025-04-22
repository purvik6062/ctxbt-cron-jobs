// src/services/subscriptionService.js
const { connect, closeConnection } = require('../db');
const { dbName, userCollectionName, influencerCollectionName } = require('../config/config');

async function updateSubscribers() {
    const client = await connect();
    try {
        const db = client.db(dbName);
        const userCollection = db.collection(userCollectionName);
        const influencerCollection = db.collection(influencerCollectionName);
        const currentDate = new Date();

        // Retrieve active subscriptions from user-data
        const users = await userCollection.find({
            creditBalance: { $gt: 0 },
            "subscribedAccounts.expiryDate": { $gt: currentDate }
        }).toArray();

        console.log(`Retrieved ${users.length} users with active subscriptions`);

        // Group active subscriptions by twitter handle
        const subscriptionMap = {};
        users.forEach(user => {
            user.subscribedAccounts.forEach(subscription => {
                if (subscription.expiryDate > currentDate) {
                    if (!subscriptionMap[subscription.twitterHandle]) {
                        subscriptionMap[subscription.twitterHandle] = new Set();
                    }
                    subscriptionMap[subscription.twitterHandle].add(user.userName);
                }
            });
        });

        // Update the influencer collection for each twitter handle
        for (const twitterHandle in subscriptionMap) {
            const subscribersArray = Array.from(subscriptionMap[twitterHandle]);
            await influencerCollection.updateOne(
                { twitterHandle },
                { $set: { subscribers: subscribersArray, updatedAt: new Date() } },
                { upsert: true }
            );
            console.log(`Updated subscribers for ${twitterHandle}:`, subscribersArray);
        }
    } catch (error) {
        console.error('Error updating subscribers:', error);
    } finally {
        await closeConnection(client);
    }
}

module.exports = { updateSubscribers };
