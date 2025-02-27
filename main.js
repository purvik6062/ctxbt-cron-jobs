// combined-cron-jobs.js

const cron = require('node-cron');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

// Configuration
const mongoUri = process.env.MONGODB_URI;
const dbName = 'tradingMinds';
const userCollectionName = 'user-data';
const influencerCollectionName = 'influencer-data';
const scrapeEndpoint = 'http://127.0.0.1:8000/scrape';

// Scraper API credentials
const scraperCredentials = {
    user: "",
    password: "",
    tweets: 10
};

// Helper: Connect to MongoDB
async function connectToMongo() {
    const client = new MongoClient(mongoUri);
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        return client;
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        throw error;
    }
}

// ------------------ Active Subscription Updater ------------------
// This function updates the tweets collection with active subscribers.
async function updateSubscribers() {
    const client = await connectToMongo();
    try {
        const db = client.db(dbName);
        const userCollection = db.collection(userCollectionName);
        const influencerCollection = db.collection(influencerCollectionName);
        const currentDate = new Date();

        // Retrieve active subscriptions from user-data
        const users = await userCollection.find({
            creditBalance: { $gt: 0 },
            // creditExpiryDate: { $gt: currentDate },
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

        // Update the tweets collection for each twitter handle
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
        await client.close();
    }
}

// ------------------ Tweets Processing Job ------------------
// This function scrapes tweets and updates the tweets collection for each twitter handle.
async function scrapeTwitterAccount(subscription) {
    try {
        const requestBody = {
            ...scraperCredentials,
            username: subscription.twitterHandleUsername
        };
        console.log(`Calling scrape API for Twitter handle: ${subscription.twitterHandleUsername}`);
        const response = await axios.post(scrapeEndpoint, requestBody, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log(`API call for ${subscription.twitterHandleUsername} successful:`, response.status);
        return { subscription, success: true, data: response.data };
    } catch (error) {
        console.error(`Error calling API for ${subscription.twitterHandleUsername}:`, error.message);
        return { subscription, success: false, error: error.message };
    }
}

async function isTweetRelevant(tweetContent) {
    const prompt = `Analyze the following tweet and return only "true" if it contains actionable trading signals or market insights, otherwise return "false".\n\nTweet: "${tweetContent}"`;
    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    { role: "system", content: "You are a financial market expert who only classifies tweets for actionable trading insights." },
                    { role: "user", content: prompt }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                }
            }
        );
        const answer = response.data.choices[0].message.content.trim().toLowerCase();
        return answer === 'true';
    } catch (error) {
        console.error('Error in filtering tweet with OpenAI:', error.message);
        return false;
    }
}

async function processAndStoreTweetsForHandle(twitterHandle, subscribers, tweetResult) {
    const client = await connectToMongo();
    try {
        const db = client.db(dbName);
        const influencerCollection = db.collection(influencerCollectionName);

        // Find or create document for the twitter handle
        let doc = await influencerCollection.findOne({ twitterHandle });
        if (!doc) {
            const newDoc = {
                twitterHandle,
                tweets: [],
                subscribers: subscribers,
                processedTweetIds: [],
                createdAt: new Date(),
                updatedAt: new Date()
            };
            await influencerCollection.insertOne(newDoc);
            doc = newDoc;
            console.log(`Created new tweets document for twitterHandle ${twitterHandle}`);
        } else {
            // Merge new subscribers into the document
            await influencerCollection.updateOne(
                { twitterHandle },
                { $addToSet: { subscribers: { $each: subscribers } }, $set: { updatedAt: new Date() } }
            );
            console.log(`Updated subscribers for twitterHandle ${twitterHandle}`);
        }

        let processedIds = doc.processedTweetIds || [];
        // Process each tweet from the scrape result
        for (const tweet of tweetResult.data) {
            if (processedIds.includes(tweet.tweet_id)) {
                console.log(`Tweet ${tweet.tweet_id} already processed for ${twitterHandle}. Skipping.`);
                continue;
            }

            const relevant = await isTweetRelevant(tweet.content);
            if (relevant) {
                const tweetDocument = {
                    tweet_id: tweet.tweet_id,
                    signalsGenerated: false,
                    content: tweet.content,
                    timestamp: new Date(tweet.timestamp),
                    verified: tweet.verified,
                    comments: Number(tweet.comments) || tweet.comments,
                    retweets: Number(tweet.retweets) || tweet.retweets,
                    likes: Number(tweet.likes) || tweet.likes,
                    analytics: tweet.analytics,
                    tags: tweet.tags,
                    mentions: tweet.mentions,
                    emojis: tweet.emojis,
                    profile_image: tweet.profile_image,
                    tweet_link: tweet.tweet_link,
                };
                await influencerCollection.updateOne(
                    { twitterHandle },
                    {
                        $push: { tweets: tweetDocument },
                        $addToSet: { processedTweetIds: tweet.tweet_id },
                        $set: { updatedAt: new Date() }
                    }
                );
                console.log(`Stored tweet ${tweet.tweet_id} for ${twitterHandle}`);
            } else {
                await influencerCollection.updateOne(
                    { twitterHandle },
                    {
                        $addToSet: { processedTweetIds: tweet.tweet_id },
                        $set: { updatedAt: new Date() }
                    }
                );
                console.log(`Filtered out tweet ${tweet.tweet_id} for ${twitterHandle} as irrelevant`);
            }
            processedIds.push(tweet.tweet_id);
            await new Promise(resolve => setTimeout(resolve, 500)); // Optional delay
        }
    } catch (error) {
        console.error('Error processing tweets for', twitterHandle, error);
    } finally {
        await client.close();
    }
}

async function processTweets() {
    const client = await connectToMongo();
    try {
        const db = client.db(dbName);
        const influencerCollection = db.collection(influencerCollectionName);

        // Process only twitter handles with active subscribers
        const docs = await influencerCollection.find({ subscribers: { $exists: true, $ne: [] } }).toArray();
        for (const doc of docs) {
            const subscription = { twitterHandleUsername: doc.twitterHandle };
            const result = await scrapeTwitterAccount(subscription);
            if (result.success) {
                await processAndStoreTweetsForHandle(subscription.twitterHandleUsername, doc.subscribers, result.data);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (error) {
        console.error('Error processing tweets:', error);
    } finally {
        await client.close();
    }
}

// ------------------ Schedule Cron Jobs ------------------
// Active Subscription Updater - runs every 5 minutes
cron.schedule('*/1 * * * *', async () => {
    console.log('Starting active subscription updater at:', new Date().toISOString());
    await updateSubscribers();
});

// Tweets Processing Job - runs every 5 minutes
cron.schedule('*/3 * * * *', async () => {
    console.log('Starting tweets processing job at:', new Date().toISOString());
    await processTweets();
});

console.log('Both Cron Jobs are active. Press Ctrl+C to exit.');
