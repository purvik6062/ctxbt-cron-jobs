const axios = require('axios');
const { connect, closeConnection } = require('../db');
const { dbName, influencerCollectionName, openAI } = require('../config/config');
const TweetTradingAnalyzer = require('./tweetAnalyzer');

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
        return null;
    }
}

async function processAndStoreRelevantTweets(twitterHandle, subscribers, tweetResult) {
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
            console.log(`Updated subscribers for ${twitterHandle}`);
        }

        let processedIds = doc.processedTweetIds || [];
        // Process each tweet from the scrape result
        for (const tweet of tweetResult.data) {
            if (processedIds.includes(tweet.tweet_id)) {
                console.log(`Tweet ${tweet.tweet_id} already processed for ${twitterHandle}. Skipping.`);
                continue;
            }
            const relevant = await isTweetRelevant(tweet.content);

            // If relevance could not be determined due to an error, skip marking the tweet as processed
            if (relevant === null) {
                console.log(`Could not determine relevance for tweet ${tweet.tweet_id} (likely due to a network or API error). Skipping for now.`);
                continue;
            }

            if (relevant) {
                const tweetDocument = {
                    tweet_id: tweet.tweet_id,
                    signalsGenerated: false,
                    content: tweet.content,
                    timestamp: tweet.timestamp,
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
                    // Analysis will be appended below
                };

                const analyzer = new TweetTradingAnalyzer(process.env.OPENAI_API_KEY);
                const coinsArray = await analyzer.analyzeTweet(tweet.content);
                console.log(`Coins array for tweet ${tweet.tweet_id}:`, coinsArray.coin_ids);
                tweetDocument.coins = coinsArray.coin_ids;

                // const tweetDate = new Date(tweetDocument.timestamp);
                // const yesterday = new Date();
                // yesterday.setDate(yesterday.getDate() - 1);

                // if (tweetDocument.coins.length > 0 && tweetDate >= yesterday) {
                //     await influencerCollection.updateOne(
                //         { twitterHandle },
                //         {
                //             $push: { tweets: tweetDocument },
                //             $addToSet: { processedTweetIds: tweet.tweet_id },
                //             $set: { updatedAt: new Date() }
                //         }
                //     );
                //     console.log(`Stored tweet ${tweet.tweet_id} for ${twitterHandle} with coin analysis.`);
                // }

                const tweetDate = new Date(tweetDocument.timestamp); // Convert ISO string to Date object

                const now = new Date();
                const yesterday = new Date();
                yesterday.setDate(now.getDate() - 1);

                // Ensure the date conversion is valid
                if (isNaN(tweetDate.getTime())) {
                    console.error(`Invalid date format for tweet ${tweetDocument.tweet_id}:`, tweetDocument.timestamp);
                } else {
                    if (tweetDocument.coins.length > 0 && tweetDate >= yesterday) {
                        await influencerCollection.updateOne(
                            { twitterHandle },
                            {
                                $push: { tweets: tweetDocument },
                                $addToSet: { processedTweetIds: tweet.tweet_id },
                                $set: { updatedAt: new Date() }
                            }
                        );
                        console.log(`Stored tweet ${tweet.tweet_id} for ${twitterHandle} with coin analysis.`);
                    } else {
                        console.log(`Tweet ${tweet.tweet_id} is older than yesterday (${tweetDocument.timestamp}). Or Tweet has no coinsArray. Skipping.`);
                    }
                }
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
        await closeConnection(client);
    }
}

async function doesTweetMentionPlatform(tweetContent) {
    const prompt = `Analyze the following tweet and return only "true" if it mentions, promotes, or discusses the platform 'ctxbt' or 'CTxbt' or 'CTXBT' or 'ctxbt.com' or 'app.ctxbt.com', otherwise return "false".\n\nTweet: "${tweetContent}"`;
    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    { role: "system", content: "You are an assistant that determines if a tweet mentions a specific platform." },
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
        console.error('Error in checking platform mention with OpenAI:', error.message);
        return null;
    }
}

async function processAndStorePlatformTweets(twitterHandle, subscribers, tweetResult) {
    const client = await connect();
    try {
        const db = client.db(dbName);
        const ctxbtCollection = db.collection('ctxbt_tweets');

        // Find or create document for the Twitter handle
        let doc = await ctxbtCollection.findOne({ twitterHandle });
        if (!doc) {
            const newDoc = {
                twitterHandle,
                tweets: [],
                subscribers: subscribers,
                processedTweetIds: [],
                createdAt: new Date(),
                updatedAt: new Date()
            };
            await ctxbtCollection.insertOne(newDoc);
            doc = newDoc;
            console.log(`Created new ctxbt_tweets document for twitterHandle ${twitterHandle}`);
        } else {
            // Merge new subscribers into the document, avoiding duplicates
            await ctxbtCollection.updateOne(
                { twitterHandle },
                { $addToSet: { subscribers: { $each: subscribers } }, $set: { updatedAt: new Date() } }
            );
            console.log(`Updated subscribers for ${twitterHandle} in ctxbt_tweets`);
        }

        let processedIds = doc.processedTweetIds || [];

        // Process each tweet from the scrape result
        for (const tweet of tweetResult.data) {
            if (processedIds.includes(tweet.tweet_id)) {
                console.log(`Tweet ${tweet.tweet_id} already processed for ${twitterHandle} in ctxbt_tweets. Skipping.`);
                continue;
            }

            // Analyze if the tweet mentions the platform
            const mentionsPlatform = await doesTweetMentionPlatform(tweet.content);
            if (mentionsPlatform === null) {
                console.log(`Could not determine if tweet ${tweet.tweet_id} mentions the platform. Skipping for now.`);
                continue;
            }

            if (mentionsPlatform) {
                // Construct tweet document with all metadata
                const tweetDocument = {
                    tweet_id: tweet.tweet_id,
                    content: tweet.content,
                    timestamp: tweet.timestamp,
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

                // Store the tweet and update processed IDs
                await ctxbtCollection.updateOne(
                    { twitterHandle },
                    {
                        $push: { tweets: tweetDocument },
                        $addToSet: { processedTweetIds: tweet.tweet_id },
                        $set: { updatedAt: new Date() }
                    }
                );
                console.log(`Stored tweet ${tweet.tweet_id} for ${twitterHandle} in ctxbt_tweets as it mentions the platform.`);
            } else {
                // Mark tweet as processed even if it doesn't mention the platform
                await ctxbtCollection.updateOne(
                    { twitterHandle },
                    {
                        $addToSet: { processedTweetIds: tweet.tweet_id },
                        $set: { updatedAt: new Date() }
                    }
                );
                console.log(`Tweet ${tweet.tweet_id} for ${twitterHandle} does not mention the platform. Marked as processed.`);
            }

            processedIds.push(tweet.tweet_id);
            // Add delay to avoid hitting rate limits
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    } catch (error) {
        console.error('Error processing platform tweets for', twitterHandle, error);
    } finally {
        await closeConnection(client);
    }
}

async function processAndStoreTweetsForHandle(twitterHandle, subscribers, tweetResult) {
    await processAndStoreRelevantTweets(twitterHandle, subscribers, tweetResult);
    await processAndStorePlatformTweets(twitterHandle, subscribers, tweetResult);
}


module.exports = { processAndStoreTweetsForHandle };