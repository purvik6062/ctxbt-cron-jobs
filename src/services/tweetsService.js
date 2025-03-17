// src/services/tweetsService.js
const axios = require('axios');
const { connect } = require('../db');
const { dbName, influencerCollectionName, scrapeEndpoint, scraperCredentials, openAI } = require('../config/config');
const TweetTradingAnalyzer = require('../services/tweetAnalyzer');
const { processAndGenerateSignalsForTweets } = require('./signalGeneration');
const { processAndSendTradingSignalMessage } = require('./telegramService');

const responseData = {
    "status": "success",
    "tweet_count": 10,
    "data": [
        {
            "name": "DonaXbτ",
            "handle": "@CryptoDona7",
            "timestamp": "2025-02-08T22:36:50.000Z",
            "verified": true,
            "content": "$ETH \n\nLoading ...",
            "comments": "16",
            "retweets": "21",
            "likes": "193",
            "analytics": "48K",
            "tags": [],
            "mentions": [],
            "emojis": [],
            "profile_image": "https://pbs.twimg.com/profile_images/1887132592048115712/iJtOrbjh_normal.jpg",
            "tweet_link": "https://x.com/CryptoDona7/status/1888356340696764733",
            "tweet_id": "1888356340696764733"
        },
        {
            "name": "DonaXbτ",
            "handle": "@CryptoDona7",
            "timestamp": "2025-02-27T23:15:16.000Z",
            "verified": true,
            "content": "Found a very interesting  pattern for $TAO, if that repeats bottom should be around $280-$290 and a cycle top @ $4,090",
            "comments": "14",
            "retweets": "5",
            "likes": "149",
            "analytics": "8.4K",
            "tags": [],
            "mentions": [],
            "emojis": [],
            "profile_image": "https://pbs.twimg.com/profile_images/1887132592048115712/iJtOrbjh_normal.jpg",
            "tweet_link": "https://x.com/CryptoDona7/status/1895251385287057866",
            "tweet_id": "1895251385287057866"
        },
        {
            "name": "DonaXbτ",
            "handle": "@CryptoDona7",
            "timestamp": "2025-02-27T15:32:05.000Z",
            "verified": true,
            "content": "nobody wanted $VIRAL too @ $450K market cap before it pulled 40x #Repolyze is giving me a deja vu here @ $400K market cap.\n\nur crypto Guru will wait for it to 10x to start shilling it and use u as Exit liquidity ",
            "comments": "12",
            "retweets": "11",
            "likes": "41",
            "analytics": "4.9K",
            "tags": ["#Repolyze"],
            "mentions": [],
            "emojis": ["\\U0001fae1"],
            "profile_image": "https://pbs.twimg.com/profile_images/1887132592048115712/iJtOrbjh_normal.jpg",
            "tweet_link": "https://x.com/CryptoDona7/status/1895134821107564630",
            "tweet_id": "1895134821107564630"
        },
        {
            "name": "DonaXbτ",
            "handle": "@CryptoDona7",
            "timestamp": "2025-02-27T15:04:13.000Z",
            "verified": true,
            "content": "2025 will be the year for #RWA to shine the most these are my plays \n\nHigh cap : $INJ \nMid cap : $CPOOL \nLow cap : $RIO \nMicro cap : $BST",
            "comments": "41",
            "retweets": "20",
            "likes": "241",
            "analytics": "15K",
            "tags": ["#RWA"],
            "mentions": [],
            "emojis": [],
            "profile_image": "https://pbs.twimg.com/profile_images/1887132592048115712/iJtOrbjh_normal.jpg",
            "tweet_link": "https://x.com/CryptoDona7/status/1895127804775408089",
            "tweet_id": "1895127804775408089"
        },
        {
            "name": "DonaXbτ",
            "handle": "@CryptoDona7",
            "timestamp": "2025-02-27T15:01:27.000Z",
            "verified": true,
            "content": "Why would anyone wants to make babies when the world is going on a down trend \n\nInflation is rising like hell \n\nDisease and viruses  are been developed and released from these corrupted corporations to profit billions from developing and selling drugs & vaccines \n\nMan only",
            "comments": "3",
            "retweets": "0",
            "likes": "20",
            "analytics": "4.4K",
            "tags": [],
            "mentions": [],
            "emojis": ["\\U0001f9a0"],
            "profile_image": "https://pbs.twimg.com/profile_images/1887132592048115712/iJtOrbjh_normal.jpg",
            "tweet_link": "https://x.com/CryptoDona7/status/1895127109766389975",
            "tweet_id": "1895127109766389975"
        },
        {
            "name": "DonaXbτ",
            "handle": "@CryptoDona7",
            "timestamp": "2025-02-27T14:54:05.000Z",
            "verified": true,
            "content": "Study $CPOOL ",
            "comments": "2",
            "retweets": "1",
            "likes": "11",
            "analytics": "3.6K",
            "tags": [],
            "mentions": [],
            "emojis": ["\\u270d\\ufe0f"],
            "profile_image": "https://pbs.twimg.com/profile_images/1887132592048115712/iJtOrbjh_normal.jpg",
            "tweet_link": "https://x.com/CryptoDona7/status/1895125254705439121",
            "tweet_id": "1895125254705439121"
        },
        {
            "name": "DonaXbτ",
            "handle": "@CryptoDona7",
            "timestamp": "2025-02-27T14:22:58.000Z",
            "verified": true,
            "content": "you have been so wrong on the market , so funny to watch... meanwhile $SOL nuked 20% after warning post ",
            "comments": "7",
            "retweets": "1",
            "likes": "32",
            "analytics": "6.6K",
            "tags": [],
            "mentions": [],
            "emojis": ["\\U0001f480"],
            "profile_image": "https://pbs.twimg.com/profile_images/1887132592048115712/iJtOrbjh_normal.jpg",
            "tweet_link": "https://x.com/CryptoDona7/status/1895117425554698550",
            "tweet_id": "1895117425554698550"
        },
        {
            "name": "TgMetrics - AI Insights & Analytics",
            "handle": "@tgmetrics",
            "timestamp": "2025-02-27T13:37:55.000Z",
            "verified": true,
            "content": " Another Step Towards the Future! We’re thrilled to announce that #TgMetrics is now listed on  ! This is one more step in our journey to develop the best AI Agents for Telegram and X, empowering communities with real-time insights, AI-driven analytics, and",
            "comments": "19",
            "retweets": "23",
            "likes": "51",
            "analytics": "2.6K",
            "tags": ["#TgMetrics"],
            "mentions": ["@cookiedotfun"],
            "emojis": ["\\U0001f680", "\\U0001f525", "\\U0001f389"],
            "profile_image": "https://pbs.twimg.com/profile_images/1879984300449316864/5Hd_wV-f_normal.jpg",
            "tweet_link": "https://x.com/tgmetrics/status/1895106087436664860",
            "tweet_id": "1895106087436664860"
        },
        {
            "name": "DonaXbτ",
            "handle": "@CryptoDona7",
            "timestamp": "2025-02-27T14:18:49.000Z",
            "verified": true,
            "content": "It's def not looking good for Solana.$SOL",
            "comments": "17",
            "retweets": "1",
            "likes": "38",
            "analytics": "10K",
            "tags": [],
            "mentions": [],
            "emojis": [],
            "profile_image": "https://pbs.twimg.com/profile_images/1887132592048115712/iJtOrbjh_normal.jpg",
            "tweet_link": "https://x.com/CryptoDona7/status/1895116383069053372",
            "tweet_id": "1895116383069053372"
        },
        {
            "name": "DonaXbτ",
            "handle": "@CryptoDona7",
            "timestamp": "2025-02-27T13:08:48.000Z",
            "verified": true,
            "content": "Nature is healing ",
            "comments": "2",
            "retweets": "5",
            "likes": "72",
            "analytics": "5.6K",
            "tags": [],
            "mentions": [],
            "emojis": ["\\U0001f91d"],
            "profile_image": "https://pbs.twimg.com/profile_images/1887132592048115712/iJtOrbjh_normal.jpg",
            "tweet_link": "https://x.com/CryptoDona7/status/1895098761573195971",
            "tweet_id": "1895098761573195971"
        }
    ],
    "error": null
}

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
        console.log(`API call for ${subscription.twitterHandleUsername} successful`);
        return { subscription, success: true, data: response.data };

        // console.log(`API call for ${subscription.twitterHandleUsername} successful:`, responseData.status);
        // return { subscription, success: true, data: responseData };
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
                // await processAndGenerateSignalsForTweets(subscription.twitterHandleUsername);
                // await processAndSendTradingSignalMessage();
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
