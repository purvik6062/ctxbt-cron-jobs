// src/services/tweetsService.js
const axios = require('axios');
const { connect } = require('../db');
const { dbName, influencerCollectionName, scrapeEndpoint, scraperCredentials, openAI } = require('../config/config');

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
                    'Authorization': `Bearer ${openAI.apiKey}`
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
    const client = await connect();
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
        // Process each tweet from the scraper result
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
                    createdAt: new Date()
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
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    } catch (error) {
        console.error('Error processing tweets for', twitterHandle, error);
    } finally {
        await client.close();
    }
}

async function processTweets() {
    const client = await connect();
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

module.exports = { scrapeTwitterAccount, processTweets };
