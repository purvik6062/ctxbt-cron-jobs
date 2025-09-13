const axios = require("axios");
const dotenv = require("dotenv");
const fs = require("fs");
const { connect, closeConnection } = require("../db");
const {
  dbName,
  lunarcrushCollectionName,
  lunarcrushTokensCollectionName,
} = require("../config/config");
dotenv.config();

// --- Rate limiting helpers ---l
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;
const MIN_REQUEST_SPACING_MS = 6500; // ~9/min to stay under 10/minute

// Helper function to safely get numeric value, treating null/NaN as 0
function safeNumber(value) {
    if (value === null || value === undefined || isNaN(value) || !isFinite(value)) {
        return 0;
    }
    return Number(value);
}

// Function to calculate prediction based on token type and metrics
function calculatePrediction(type, metrics) {
    if (!metrics || typeof metrics !== 'object') {
        return 0;
    }

    // Safely extract all metrics
    const d_pct_mktvol_6h = safeNumber(metrics.d_pct_mktvol_6h);
    const d_pct_socvol_6h = safeNumber(metrics.d_pct_socvol_6h);
    const d_galaxy_6h = safeNumber(metrics.d_galaxy_6h);
    const neg_d_altrank_6h = safeNumber(metrics.neg_d_altrank_6h);
    const d_pct_sent_6h = safeNumber(metrics.d_pct_sent_6h);
    const r_last6h_pct = safeNumber(metrics.r_last6h_pct);
    const d_pct_users_6h = safeNumber(metrics.d_pct_users_6h);
    const d_pct_infl_6h = safeNumber(metrics.d_pct_infl_6h);

    let prediction;

    if (type === "major coin") {
        // Majors equation:
        // pred_next6h_% = 0 + 0.30*d%_mktvol_6h + 0.20*d%_socvol_6h + 0.15*d_galaxy_6h + 0.15*neg_d_altrank_6h + 0.10*d%_sent_6h + 0.30*r_last6h_%
        prediction =
            0.30 * d_pct_mktvol_6h +
            0.20 * d_pct_socvol_6h +
            0.15 * d_galaxy_6h +
            0.15 * neg_d_altrank_6h +
            0.10 * d_pct_sent_6h +
            0.30 * r_last6h_pct;
    } else if (type === "memecoin") {
        // Memecoins equation:
        // pred_next6h_% = 0 + 0.45*d%_socvol_6h + 0.35*d%_users_6h + 0.30*d%_infl_6h + 0.20*d%_sent_6h + 0.20*d%_mktvol_6h + 0.15*neg_d_altrank_6h + 0.20*r_last6h_%
        prediction =
            0.45 * d_pct_socvol_6h +
            0.35 * d_pct_users_6h +
            0.30 * d_pct_infl_6h +
            0.20 * d_pct_sent_6h +
            0.20 * d_pct_mktvol_6h +
            0.15 * neg_d_altrank_6h +
            0.20 * r_last6h_pct;
    } else {
        // Default fallback for unknown types - use a weighted average
        prediction =
            0.25 * d_pct_mktvol_6h +
            0.25 * d_pct_socvol_6h +
            0.15 * d_pct_sent_6h +
            0.20 * r_last6h_pct +
            0.15 * d_pct_users_6h;
    }

    return prediction;
}

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
      const resetEpochSec = Number(headersResp["x-rate-limit-minute-reset"]);
      const currentEpochSec = Math.floor(Date.now() / 1000);
      let waitMs = MIN_REQUEST_SPACING_MS;
      if (!Number.isNaN(resetEpochSec) && resetEpochSec > currentEpochSec) {
        waitMs = (resetEpochSec - currentEpochSec + 1) * 1000;
      }
      console.warn(
        `Rate limited (429). Waiting ${Math.ceil(waitMs / 1000)}s before retry...`,
      );
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

async function fetchLunarCrushData(coin = "btc", apiKey = "") {
  if (!apiKey) {
    throw new Error("API key is required for LunarCrush v4 API");
  }

  const now = Math.floor(Date.now() / 1000);
  const start = now - 12 * 3600; // 12 hours ago for 12 hourly points
  const url = `https://lunarcrush.com/api4/public/coins/${coin.toLowerCase()}/time-series/v2?bucket=hour&start=${start}&end=${now}`;

  try {
    const response = await rateLimitedGet(url, {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    });
    const json = response.data;

    const timeSeries = json.data;
    if (!Array.isArray(timeSeries) || timeSeries.length < 12) {
      throw new Error("Not enough data points returned from API");
    }

    // Previous 6h: first 6 points (indices 0-5)
    // Current 6h: last 6 points (indices 6-11)
    const previous6 = timeSeries.slice(0, 6);
    const current6 = timeSeries.slice(6);

    // Helper functions
    const sum = (arr, field) =>
      arr.reduce((acc, item) => acc + (item[field] || 0), 0);
    const avg = (arr, field) => sum(arr, field) / arr.length;

    // r_last6h_%: return over last 6h using average of last 3 hourly closes
    const close6hAgo = avg(timeSeries.slice(3, 6), "close");
    const currentClose = avg(timeSeries.slice(9, 12), "close");
    const r_last6h_pct = ((currentClose - close6hAgo) / close6hAgo) * 100;

    // d%_mktvol_6h: change in market volume sum over 6h vs previous 6h
    const previous_vol = sum(previous6, "volume_24h");
    const current_vol = sum(current6, "volume_24h");
    const d_pct_mktvol_6h =
      previous_vol !== 0
        ? ((current_vol - previous_vol) / previous_vol) * 100
        : 0;

    // d%_socvol_6h: change in social activity (using spam as proxy)
    const previous_socvol = sum(previous6, "spam");
    const current_socvol = sum(current6, "spam");
    const d_pct_socvol_6h =
      previous_socvol !== 0
        ? ((current_socvol - previous_socvol) / previous_socvol) * 100
        : 0;

    // Calculate additional metrics from available data
    // d_pct_sent_6h: Percent change in bullish Sentiment over 6h
    const previous_sentiment = avg(previous6, "sentiment");
    const current_sentiment = avg(current6, "sentiment");
    const d_pct_sent_6h = previous_sentiment !== 0
        ? ((current_sentiment - previous_sentiment) / previous_sentiment) * 100
        : 0;

    // d_pct_users_6h: Percent change in Unique Contributors over 6h
    const previous_users = sum(previous6, "contributors_active");
    const current_users = sum(current6, "contributors_active");
    const d_pct_users_6h = previous_users !== 0
        ? ((current_users - previous_users) / previous_users) * 100
        : 0;

    // d_pct_infl_6h: Percent change in Influencer Mentions over 6h
    // Using interactions as proxy for influencer mentions
    const previous_infl = sum(previous6, "interactions");
    const current_infl = sum(current6, "interactions");
    const d_pct_infl_6h = previous_infl !== 0
        ? ((current_infl - previous_infl) / previous_infl) * 100
        : 0;

    // d_galaxy_6h: GalaxyScore(t)-GalaxyScore(t-6h) (points)
    const previous_galaxy = avg(previous6, "galaxy_score");
    const current_galaxy = avg(current6, "galaxy_score");
    const d_galaxy_6h = current_galaxy - previous_galaxy;

    // neg_d_altrank_6h: Negative of (AltRank(t)-AltRank(t-6h))
    const previous_altrank = avg(previous6, "alt_rank");
    const current_altrank = avg(current6, "alt_rank");
    const neg_d_altrank_6h = previous_altrank !== null && current_altrank !== null
        ? -(current_altrank - previous_altrank)
        : 0;

    // Return all computed metrics
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
    console.error(
      "Error fetching data from LunarCrush API for " + coin + ":",
      error,
    );
    return null;
  }
}

async function processAllTokens() {
  const apiKey = process.env.LUNARCRUSH_API_KEY;
  if (!apiKey) {
    console.error("No API key provided");
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
    console.error(
      "Failed to connect to MongoDB for lunarcrush upserts:",
      e?.message || e,
    );
  }

  // Fetch token list from DB
  let tokens = [];
  try {
    const tokensCol = client
      ?.db(dbName)
      ?.collection(lunarcrushTokensCollectionName);
    tokens = await tokensCol.find({}).project({ _id: 0 }).toArray();
    if (!Array.isArray(tokens) || tokens.length === 0) {
      console.error("No tokens found in lunarcrush-tokens collection");
      return;
    }
  } catch (e) {
    console.error("Failed to load tokens from DB:", e?.message || e);
    return;
  }

  for (const token of tokens) {
    const symbol = token.symbol || token["Token Mentioned"]; // support old schema during transition
    const type = token.type;

    const data = await fetchLunarCrushData(symbol, apiKey);

    let pred_next6h_pct = 0;
    if (data) {
      // Use the comprehensive prediction calculation with proper null/NaN handling
      pred_next6h_pct = calculatePrediction(type, data);
      console.log(`Calculated prediction for ${symbol} (${type}): ${pred_next6h_pct.toFixed(2)}%`);
    } else {
      console.log(`No data retrieved for ${symbol}`);
    }

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
            $setOnInsert: { createdAt: nowIso },
          },
          { upsert: true },
        );
        console.log(`Upserted ${symbol} into ${lunarcrushCollectionName}`);
      } catch (e) {
        console.error(
          `Failed to upsert ${symbol} in MongoDB:`,
          e?.message || e,
        );
      }
    }
  }

  if (client) {
    await closeConnection(client);
  }
  console.log("Processing complete. Results stored in MongoDB");
}

// Export functions for reuse by API and scripts
module.exports = {
  fetchLunarCrushData,
  processAllTokens,
  calculatePrediction,
  safeNumber,
};

// Allow running directly from CLI without triggering on import
if (require.main === module) {
  processAllTokens();
}
