const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const { connect, closeConnection } = require('../db');
const { dbName, lunarcrushCollectionName, lunarcrushTokensCollectionName } = require('../config/config');
dotenv.config();


// --- Rate limiting helpers ---
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;
const MIN_REQUEST_SPACING_MS = 6500; // ~9/min to stay under 10/minute

async function rateLimitedGet(url, headers, attempt = 1) {
  const now = Date.now();
  const sinceLast = now - lastRequestAt;
  if (sinceLast < MIN_REQUEST_SPACING_MS) {
    await sleep(MIN_REQUEST_SPACING_MS - sinceLast);
  }

  try {
    const response = await axios.get(url, { headers });
    lastRequestAt = Date.now();
    return response;
  } catch (error) {
    const status = error?.response?.status;
    const headersResp = error?.response?.headers || {};

    // Handle 429 with respect to minute reset header
    if (status === 429) {
      const resetEpochSec = Number(headersResp['x-rate-limit-minute-reset']);
      const currentEpochSec = Math.floor(Date.now() / 1000);
      let waitMs = MIN_REQUEST_SPACING_MS;
      if (!Number.isNaN(resetEpochSec) && resetEpochSec > currentEpochSec) {
        waitMs = (resetEpochSec - currentEpochSec + 1) * 1000;
      }
      console.warn(`Rate limited (429). Waiting ${Math.ceil(waitMs / 1000)}s before retry...`);
      await sleep(waitMs);
      if (attempt <= 5) {
        return rateLimitedGet(url, headers, attempt + 1);
      }
    }

    // Transient network errors: backoff and retry a few times
    if (!status && attempt <= 3) {
      const backoffMs = Math.min(30000, 2000 * attempt);
      await sleep(backoffMs);
      return rateLimitedGet(url, headers, attempt + 1);
    }

    throw error;
  }
}

async function fetchLunarCrushData(coin = 'btc', apiKey = '') {
  if (!apiKey) {
    throw new Error('API key is required for LunarCrush v4 API');
  }

  const now = Math.floor(Date.now() / 1000);
  const start = now - (12 * 3600); // 12 hours ago for 12 hourly points
  const url = `https://lunarcrush.com/api4/public/coins/${coin.toLowerCase()}/time-series/v2?bucket=hour&start=${start}&end=${now}`;

  try {
    const response = await rateLimitedGet(url, {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    });
    const json = response.data;

    const timeSeries = json.data;
    if (!Array.isArray(timeSeries) || timeSeries.length < 12) {
      throw new Error('Not enough data points returned from API');
    }

    // Previous 6h: first 6 points (indices 0-5)
    // Current 6h: last 6 points (indices 6-11)
    const previous6 = timeSeries.slice(0, 6);
    const current6 = timeSeries.slice(6);

    // Helper functions
    const sum = (arr, field) => arr.reduce((acc, item) => acc + (item[field] || 0), 0);
    const avg = (arr, field) => sum(arr, field) / arr.length;

    // r_last6h_%: return over last 6h using average of last 3 hourly closes
    const close6hAgo = avg(timeSeries.slice(3, 6), 'close');
    const currentClose = avg(timeSeries.slice(9, 12), 'close');
    const r_last6h_pct = ((currentClose - close6hAgo) / close6hAgo) * 100;

    // d%_mktvol_6h: change in market volume sum over 6h vs previous 6h
    const previous_vol = sum(previous6, 'market_volume') || sum(previous6, 'volume_24h') || sum(previous6, 'volume');
    const current_vol = sum(current6, 'market_volume') || sum(current6, 'volume_24h') || sum(current6, 'volume');
    const d_pct_mktvol_6h = previous_vol !== 0 ? ((current_vol - previous_vol) / previous_vol) * 100 : 0;

    // d%_socvol_6h: change in social volume sum
    const previous_socvol = sum(previous6, 'social_volume') || sum(previous6, 'posts_created') || sum(previous6, 'interactions');
    const current_socvol = sum(current6, 'social_volume') || sum(current6, 'posts_created') || sum(current6, 'interactions');
    const d_pct_socvol_6h = previous_socvol !== 0 ? ((current_socvol - previous_socvol) / previous_socvol) * 100 : 0;

    // d%_sent_6h: change in average sentiment
    const previous_sent = avg(previous6, 'sentiment') || avg(previous6, 'average_sentiment');
    const current_sent = avg(current6, 'sentiment') || avg(current6, 'average_sentiment');
    const d_pct_sent_6h = previous_sent !== 0 ? ((current_sent - previous_sent) / previous_sent) * 100 : 0;

    // d%_users_6h: change in sum of unique contributors
    const previous_users = sum(previous6, 'contributors_active') || sum(previous6, 'social_contributors');
    const current_users = sum(current6, 'contributors_active') || sum(current6, 'social_contributors');
    const d_pct_users_6h = previous_users !== 0 ? ((current_users - previous_users) / previous_users) * 100 : 0;

    // d%_infl_6h: change in sum of influencer mentions
    const previous_infl = sum(previous6, 'influencers_count') || sum(previous6, 'contributors_created');
    const current_infl = sum(current6, 'influencers_count') || sum(current6, 'contributors_created');
    const d_pct_infl_6h = previous_infl !== 0 ? ((current_infl - previous_infl) / previous_infl) * 100 : 0;

    // d_galaxy_6h: level change in galaxy_score over 6h
    const galaxy6hAgo = timeSeries[5].galaxy_score;
    const current_galaxy = timeSeries[11].galaxy_score;
    const d_galaxy_6h = current_galaxy - galaxy6hAgo;

    // neg_d_altrank_6h: negated level change in alt_rank over 6h
    const alt6hAgo = timeSeries[5].alt_rank;
    const current_alt = timeSeries[11].alt_rank;
    const neg_d_altrank_6h = - (current_alt - alt6hAgo);

    // Return computed metrics
    return {
      r_last6h_pct,
      d_pct_mktvol_6h,
      d_pct_socvol_6h,
      d_pct_sent_6h,
      d_pct_users_6h,
      d_pct_infl_6h,
      d_galaxy_6h,
      neg_d_altrank_6h
    };
  } catch (error) {
    console.error('Error fetching data from LunarCrush API for ' + coin + ':', error);
    return null;
  }
}

async function processAllTokens() {
  const apiKey = process.env.LUNARCRUSH_API_KEY;
  if (!apiKey) {
    console.error('No API key provided');
    return;
  }

  // Store only in DB; no local results file
  let client = null;
  let collection = null;
  try {
    client = await connect();
    const db = client.db(dbName);
    collection = db.collection(lunarcrushCollectionName);
  } catch (e) {
    console.error('Failed to connect to MongoDB for lunarcrush upserts:', e?.message || e);
  }

  // Fetch token list from DB
  let tokens = [];
  try {
    const tokensCol = client?.db(dbName)?.collection(lunarcrushTokensCollectionName);
    tokens = await tokensCol.find({}).project({ _id: 0 }).toArray();
    if (!Array.isArray(tokens) || tokens.length === 0) {
      console.error('No tokens found in lunarcrush-tokens collection');
      return;
    }
  } catch (e) {
    console.error('Failed to load tokens from DB:', e?.message || e);
    return;
  }

  for (const token of tokens) {
    const symbol = token.symbol || token["Token Mentioned"]; // support old schema during transition
    const type = token.type;

    const data = await fetchLunarCrushData(symbol, apiKey);

    let pred_next6h_pct = 0;
    if (data) {
      const {
        r_last6h_pct,
        d_pct_mktvol_6h,
        d_pct_socvol_6h,
        d_pct_sent_6h,
        d_pct_users_6h,
        d_pct_infl_6h,
        d_galaxy_6h,
        neg_d_altrank_6h
      } = data;

      if (type === "major coin") {
        pred_next6h_pct = 0 + 0.30 * d_pct_mktvol_6h + 0.20 * d_pct_socvol_6h + 0.15 * d_galaxy_6h + 0.15 * neg_d_altrank_6h + 0.10 * d_pct_sent_6h + 0.30 * r_last6h_pct;
      } else if (type === "memecoin") {
        pred_next6h_pct = 0 + 0.45 * d_pct_socvol_6h + 0.35 * d_pct_users_6h + 0.30 * d_pct_infl_6h + 0.20 * d_pct_sent_6h + 0.20 * d_pct_mktvol_6h + 0.15 * neg_d_altrank_6h + 0.20 * r_last6h_pct;
      }
    } else {
      console.log(`No data retrieved for ${symbol}`);
    }

    const row = { symbol: symbol?.toUpperCase(), type, metrics: data || null, pred_next6h_pct };

    // Persist to MongoDB: upsert by symbol with timestamps
    if (collection) {
      try {
        const nowIso = new Date().toISOString();
        await collection.updateOne(
          { symbol: symbol.toUpperCase() },
          {
            $set: {
              symbol: symbol.toUpperCase(),
              type,
              metrics: data || null,
              pred_next6h_pct,
              updatedAt: nowIso,
            },
            $setOnInsert: { createdAt: nowIso }
          },
          { upsert: true }
        );
        console.log(`Upserted ${symbol} into ${lunarcrushCollectionName}`);
      } catch (e) {
        console.error(`Failed to upsert ${symbol} in MongoDB:`, e?.message || e);
      }
    }

    // No local file writes; DB is the source of truth
  }

  if (client) {
    await closeConnection(client);
  }
  console.log('Processing complete. Results stored in MongoDB');
}

// Export functions for reuse by API and scripts
module.exports = {
  fetchLunarCrushData,
  processAllTokens,
};

// Allow running directly from CLI without triggering on import
if (require.main === module) {
  processAllTokens();
}