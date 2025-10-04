const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const cors = require('cors');
const { connect, closeConnection } = require('../db');
const { dbName, lunarcrushCollectionName } = require('../config/config');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
app.use(express.json());
// Enable CORS for local development and clients
// Allow all origins to avoid CORS issues from any client
app.use(cors());

// Services
const { processAndSendTradingSignalMessage } = require('../services/telegramService');
const { processSignals } = require('../services/process-signal-multi-strategies');
const { processTweets } = require('../services/tweetsService');
const { tradingSignalsCollectionName } = require('../config/config');

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Single endpoint: GET /lunarcrush -> returns all lunarcrush documents
app.get('/lunarcrush', async (req, res) => {
  let client;
  try {
    client = await connect();
    const db = client.db(dbName);
    const collection = db.collection(lunarcrushCollectionName);
    const docs = await collection.find({}).toArray();
    return res.json(docs);
  } catch (err) {
    return res.status(500).json({ error: 'Unexpected error', details: err?.message });
  } finally {
    if (client) await closeConnection(client);
  }
});

// 1) Create a mock trading signal (to avoid scraping)
app.post('/signals/mock', async (req, res) => {
  let client;
  try {
    const {
      twitterHandle = 'SomeHandle',
      personalizedFor = 'testuser',
      coin = 'bitcoin',
      signalMessage,
      tweetLink = 'https://twitter.com/example/status/1',
      // Optional overrides for signal data
      signal,
      currentPrice,
      tp1,
      tp2,
      sl,
      maxExitTime
    } = req.body || {};

    // Provide sensible defaults for ARB if caller did not provide overrides
    const isArb = String(coin).toUpperCase() === 'ARB' || String(coin).toLowerCase() === 'arbitrum';
    const defaultArb = {
      signal: 'Buy',
      currentPrice: 0.4085,
      tp1: 0.43,
      tp2: 0.45,
      sl: 0.388
    };

    const finalSignal = signal || (isArb ? defaultArb.signal : 'Buy');
    const finalCurrentPrice = (currentPrice ?? (isArb ? defaultArb.currentPrice : null));
    const finalTp1 = (tp1 ?? (isArb ? defaultArb.tp1 : null));
    const finalTp2 = (tp2 ?? (isArb ? defaultArb.tp2 : null));
    const finalSl = (sl ?? (isArb ? defaultArb.sl : null));

    const upperToken = String(coin).toUpperCase();
    const composedMessage = signalMessage || `${finalSignal} ${upperToken} with TP1 ${finalTp1 ?? ''}, TP2 ${finalTp2 ?? ''}, SL ${finalSl ?? ''}`.trim();

    client = await connect();
    const db = client.db(dbName);
    const tradingSignals = db.collection(tradingSignalsCollectionName);

    const doc = {
      tweet_id: `mock_${Date.now()}`,
      twitterHandle,
      coin,
      signal_message: composedMessage,
      signal_data: {
        signal: finalSignal,
        tokenMentioned: upperToken,
        targets: [finalTp1, finalTp2].filter(v => v != null),
        stopLoss: finalSl ?? null,
        currentPrice: finalCurrentPrice ?? null,
        maxExitTime: maxExitTime || null,
        personalizedFor
      },
      generatedAt: new Date(),
      personalizedFor,
      subscribers: [{ username: personalizedFor, sent: false, sentAt: null, error: null }],
      tweet_link: tweetLink,
      messageSent: false
    };

    const result = await tradingSignals.insertOne(doc);
    return res.status(201).json({ insertedId: result.insertedId, doc });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create mock signal', details: err?.message });
  } finally {
    if (client) await closeConnection(client);
  }
});

// 2) Trigger delivery of queued trading signals (optionally filter by handle)
app.post('/signals/deliver', async (req, res) => {
  try {
    const { handle } = req.body || {};
    const summary = await processAndSendTradingSignalMessage({ handleFilter: handle });
    return res.json(summary);
  } catch (err) {
    return res.status(500).json({ error: 'Delivery failed', details: err?.message });
  }
});

// 3) Run backtesting pipeline and send results to subscribers
app.post('/backtesting/run', async (_req, res) => {
  try {
    await processSignals();
    return res.json({ status: 'started' });
  } catch (err) {
    return res.status(500).json({ error: 'Backtesting failed', details: err?.message });
  }
});

// 4) Run full signal generation flow (scrape tweets → generate signals → deliver)
app.post('/signals/generate', async (_req, res) => {
  try {
    await processTweets();
    return res.json({ status: 'completed' });
  } catch (err) {
    return res.status(500).json({ error: 'Signal generation failed', details: err?.message });
  }
});

// 5) Test signal generation with mock tweets (bypasses scraping)
app.post('/signals/generate-mock', async (req, res) => {
  let client;
  try {
    const {
      twitterHandle = 'SomeHandle',
      mockTweet = {
        content: 'ARB is looking bullish! Target 0.45, stop at 0.388',
        timestamp: new Date(),
        tweet_id: `mock_${Date.now()}`,
        coins: ['arbitrum'],
        tweet_link: 'https://twitter.com/example/status/1'
      },
      subscribers = ['testuser']
    } = req.body || {};

    client = await connect();
    const db = client.db(dbName);
    const influencerCollection = db.collection('influencers');
    const tradingSignalsCollection = db.collection(tradingSignalsCollectionName);

    // Create or update influencer with mock tweet
    await influencerCollection.updateOne(
      { twitterHandle },
      {
        $set: {
          twitterHandle,
          subscribers,
          tweets: [{
            ...mockTweet,
            signalsGenerated: false,
            processedAt: null,
            analysisStatus: 'pending'
          }]
        }
      },
      { upsert: true }
    );

    // Import the signal generation function
    const { processAndGenerateSignalsForTweets } = require('../services/signalGeneration');

    // Generate signals for the mock tweet
    await processAndGenerateSignalsForTweets(twitterHandle);

    // Deliver the generated signals
    const deliveryResult = await processAndSendTradingSignalMessage({
      handleFilter: twitterHandle
    });

    return res.json({
      status: 'completed',
      twitterHandle,
      deliveryResult
    });
  } catch (err) {
    return res.status(500).json({ error: 'Mock signal generation failed', details: err?.message });
  } finally {
    if (client) await closeConnection(client);
  }
});

// 6) Upsert a user's SAFE mapping for trading (stored in ctxbt-signal-flow.users)
app.post('/users/upsert-safe', async (req, res) => {
  let client;
  try {
    const {
      // Primary username identifier you will use in flows (e.g., telegram username or id)
      username,
      // Optional additional identifiers for lookup convenience
      identifiers = {}, // { telegramId, twitterUsername, telegramUserId }
      // SAFE configuration
      safeAddress,
      networkKey = 'arbitrum',
      types = ['perpetuals', 'spot'] // which trading types to attach
    } = req.body || {};

    if (!username || !safeAddress) {
      return res.status(400).json({ error: 'Missing required fields: username, safeAddress' });
    }

    client = await connect();
    const signalFlowDb = client.db('ctxbt-signal-flow');
    const usersCollection = signalFlowDb.collection('users');

    // Build an identifier set for the user
    const idSet = {
      telegramId: identifiers.telegramId || undefined,
      twitterUsername: identifiers.twitterUsername || undefined,
      telegramUserId: identifiers.telegramUserId || undefined
    };

    // Remove undefined keys
    Object.keys(idSet).forEach((k) => idSet[k] === undefined && delete idSet[k]);

    // Upsert user doc with identifiers
    await usersCollection.updateOne(
      {
        $or: [
          { telegramId: username },
          { twitterUsername: username },
          { telegramUserId: parseInt(username) || username }
        ]
      },
      {
        $setOnInsert: { createdAt: new Date() },
        $set: {
          updatedAt: new Date(),
          // Ensure the primary username is recorded as twitterUsername for lookup convenience
          twitterUsername: username,
          ...idSet
        },
        $push: {
          // Ensure safeConfigs exists; use $push with $each+$position if array missing is not a problem
          safeConfigs: {
            $each: types.map((t) => ({ type: t, networkKey, safeAddress }))
          }
        }
      },
      { upsert: true }
    );

    // Optional: De-duplicate safeConfigs to avoid duplicates across multiple calls
    await usersCollection.updateOne(
      {
        $or: [
          { telegramId: username },
          { twitterUsername: username },
          { telegramUserId: parseInt(username) || username }
        ]
      },
      [
        {
          $set: {
            safeConfigs: {
              $reduce: {
                input: '$safeConfigs',
                initialValue: [],
                in: {
                  $cond: [
                    {
                      $in: [
                        {
                          type: '$$this.type',
                          networkKey: '$$this.networkKey',
                          safeAddress: '$$this.safeAddress'
                        },
                        '$$value'
                      ]
                    },
                    '$$value',
                    {
                      $concatArrays: ['$$value', [
                        { type: '$$this.type', networkKey: '$$this.networkKey', safeAddress: '$$this.safeAddress' }
                      ]]
                    }
                  ]
                }
              }
            }
          }
        }
      ]
    );

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Upsert SAFE mapping failed', details: err?.message });
  } finally {
    if (client) await closeConnection(client);
  }
});

const PORT = parseInt(process.env.PORT, 10) || 5001;
app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});

module.exports = app;