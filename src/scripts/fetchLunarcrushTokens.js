const axios = require("axios");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const { connect, closeConnection } = require("../db");
const { dbName, lunarcrushTokensCollectionName } = require("../config/config");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

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

function classifyToken(tokenData) {
  // Check if token is explicitly categorized as meme
  if (
    tokenData.categories &&
    tokenData.categories.toLowerCase().includes("meme")
  ) {
    return "memecoin";
  }

  // Major coins criteria:
  // - Top 100 by market cap rank
  // - High market cap (> $1B)
  // - Established categories (layer-1, defi, stablecoin, etc.)
  const majorCategories = [
    "layer-1",
    "stablecoin",
    "defi",
    "exchange-tokens",
    "liquid-staking-tokens",
    "bitcoin-ecosystem",
    "ethereum-ecosystem",
  ];

  const categories = (tokenData.categories || "").toLowerCase();
  const marketCapRank = tokenData.market_cap_rank || 999999;
  const marketCap = tokenData.market_cap || 0;

  // Top 100 tokens by market cap are likely major coins
  if (marketCapRank <= 100) {
    return "major coin";
  }

  // High market cap tokens (> $1B) are likely major coins
  if (marketCap > 1000000000) {
    return "major coin";
  }

  // Check if token has major categories
  const hasMajorCategory = majorCategories.some((cat) =>
    categories.includes(cat),
  );
  if (hasMajorCategory) {
    return "major coin";
  }

  // Default to memecoin for smaller/newer tokens
  return "memecoin";
}

async function fetchAllTokens(apiKey) {
  const allTokens = [];
  let page = 0;
  const limit = 1000; // Max tokens per page
  let hasMore = true;

  console.log("Starting to fetch all tokens from LunarCrush...");

  while (hasMore) {
    const url = `https://lunarcrush.com/api4/public/coins/list/v1?limit=${limit}&page=${page}&sort=market_cap_rank&desc=false`;

    try {
      console.log(`Fetching page ${page + 1}...`);

      const response = await rateLimitedGet(url, {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      });

      const data = response.data;

      if (!data || !data.data || !Array.isArray(data.data)) {
        console.error("Invalid response structure from API");
        break;
      }

      const tokens = data.data;
      console.log(`Received ${tokens.length} tokens on page ${page + 1}`);

      if (tokens.length === 0) {
        hasMore = false;
        break;
      }

      // Process and classify tokens
      const processedTokens = tokens
        .map((token) => ({
          symbol: token.symbol?.toUpperCase(),
          name: token.name,
          type: classifyToken(token),
          market_cap_rank: token.market_cap_rank,
          market_cap: token.market_cap,
          categories: token.categories,
        }))
        .filter((token) => token.symbol); // Filter out tokens without symbols

      allTokens.push(...processedTokens);

      // Save current page to JSON file
      const pageFileName = `lunarcrush-tokens-page-${page + 1}.json`;
      const pageFilePath = path.resolve(__dirname, "../../", pageFileName);
      try {
        fs.writeFileSync(
          pageFilePath,
          JSON.stringify(
            {
              page: page + 1,
              total_tokens: processedTokens.length,
              timestamp: new Date().toISOString(),
              tokens: processedTokens,
            },
            null,
            2,
          ),
        );
        console.log(`Saved page ${page + 1} tokens to ${pageFileName}`);
      } catch (fileError) {
        console.error(
          `Failed to save page ${page + 1} to file:`,
          fileError.message,
        );
      }

      // Check if we've reached the end
      const config = data.config;
      const totalRows = config?.total_rows || 0;
      const currentTotal = (page + 1) * limit;

      if (tokens.length < limit || currentTotal >= totalRows) {
        hasMore = false;
      } else {
        page++;
      }
    } catch (error) {
      console.error(`Error fetching page ${page + 1}:`, error);

      // If it's a rate limit or temporary error, we might want to continue
      if (error?.response?.status === 429) {
        console.log("Rate limited, but continuing...");
        continue;
      } else {
        // For other errors, stop the process
        break;
      }
    }
  }

  console.log(`Total tokens fetched: ${allTokens.length}`);

  // Save comprehensive summary file
  await saveComprehensiveSummary(allTokens);

  return allTokens;
}

async function saveComprehensiveSummary(allTokens) {
  try {
    const majorCoins = allTokens.filter((t) => t.type === "major coin");
    const memeCoins = allTokens.filter((t) => t.type === "memecoin");

    const summaryData = {
      metadata: {
        total_tokens: allTokens.length,
        major_coins_count: majorCoins.length,
        meme_coins_count: memeCoins.length,
        timestamp: new Date().toISOString(),
        api_source: "LunarCrush API v4",
      },
      summary: {
        by_type: {
          "major coin": majorCoins.length,
          memecoin: memeCoins.length,
        },
        top_10_by_market_cap: allTokens
          .filter((t) => t.market_cap_rank && t.market_cap_rank <= 10)
          .sort(
            (a, b) =>
              (a.market_cap_rank || 999999) - (b.market_cap_rank || 999999),
          ),
      },
      all_tokens: allTokens,
    };

    const summaryFileName = `lunarcrush-tokens-comprehensive-${new Date().toISOString().split("T")[0]}.json`;
    const summaryFilePath = path.resolve(__dirname, "../../", summaryFileName);

    fs.writeFileSync(summaryFilePath, JSON.stringify(summaryData, null, 2));
    console.log(`Saved comprehensive summary to ${summaryFileName}`);
    console.log(
      `Summary: ${majorCoins.length} major coins, ${memeCoins.length} meme coins`,
    );

    // Also save a simple tokens-only file for easy import
    const tokensOnlyFileName = `lunarcrush-tokens-simple-${new Date().toISOString().split("T")[0]}.json`;
    const tokensOnlyFilePath = path.resolve(
      __dirname,
      "../../",
      tokensOnlyFileName,
    );

    fs.writeFileSync(tokensOnlyFilePath, JSON.stringify(allTokens, null, 2));
    console.log(`Saved simple tokens list to ${tokensOnlyFileName}`);
  } catch (error) {
    console.error("Error saving comprehensive summary:", error.message);
  }
}

async function loadTokensFromJsonFiles() {
  const baseDir = path.resolve(__dirname, "../../");
  const files = fs.readdirSync(baseDir);
  const pageFiles = files
    .filter(
      (file) =>
        file.startsWith("lunarcrush-tokens-page-") && file.endsWith(".json"),
    )
    .sort((a, b) => {
      const pageA = parseInt(a.match(/page-(\d+)/)[1]);
      const pageB = parseInt(b.match(/page-(\d+)/)[1]);
      return pageA - pageB;
    });

  if (pageFiles.length === 0) {
    console.log("No existing page files found");
    return [];
  }

  console.log(`Found ${pageFiles.length} existing page files, loading...`);

  const allTokens = [];
  for (const file of pageFiles) {
    try {
      const filePath = path.resolve(baseDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (data.tokens && Array.isArray(data.tokens)) {
        allTokens.push(...data.tokens);
        console.log(`Loaded ${data.tokens.length} tokens from ${file}`);
      }
    } catch (error) {
      console.error(`Error loading ${file}:`, error.message);
    }
  }

  console.log(`Total tokens loaded from files: ${allTokens.length}`);
  return allTokens;
}

async function storeTokensInDB(tokens) {
  let client = null;
  try {
    client = await connect();
    const db = client.db(dbName);
    const collection = db.collection(lunarcrushTokensCollectionName);

    console.log(`Storing ${tokens.length} tokens in database...`);

    // Clear existing tokens to ensure fresh data
    await collection.deleteMany({});
    console.log("Cleared existing tokens from database");

    // Prepare bulk operations for efficient insertion
    const operations = tokens.map((token) => ({
      insertOne: {
        document: {
          symbol: token.symbol,
          name: token.name,
          type: token.type,
          market_cap_rank: token.market_cap_rank,
          market_cap: token.market_cap,
          categories: token.categories,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    }));

    // Execute bulk insert
    const result = await collection.bulkWrite(operations, { ordered: false });
    console.log(
      `Successfully stored ${result.insertedCount} tokens in database`,
    );

    // Log classification summary
    const majorCoins = tokens.filter((t) => t.type === "major coin").length;
    const memeCoins = tokens.filter((t) => t.type === "memecoin").length;
    console.log(
      `Classification summary: ${majorCoins} major coins, ${memeCoins} meme coins`,
    );

    return result;
  } catch (error) {
    console.error("Error storing tokens in database:", error);
    throw error;
  } finally {
    if (client) {
      await closeConnection(client);
    }
  }
}

async function main(useExistingFiles = false) {
  try {
    console.log("=== LunarCrush Token Fetcher ===");

    let tokens = [];

    if (useExistingFiles) {
      // Load from existing JSON files
      tokens = await loadTokensFromJsonFiles();

      if (tokens.length === 0) {
        console.log("No tokens found in existing files, fetching from API...");
        useExistingFiles = false;
      }
    }

    if (!useExistingFiles) {
      // Fetch from API
      const apiKey = process.env.LUNARCRUSH_API_KEY;

      if (!apiKey) {
        console.error("LUNARCRUSH_API_KEY environment variable is required");
        process.exit(1);
      }

      // Fetch all tokens from LunarCrush API
      tokens = await fetchAllTokens(apiKey);

      if (tokens.length === 0) {
        console.error("No tokens were fetched from the API");
        return;
      }
    }

    // Store tokens in database
    await storeTokensInDB(tokens);

    console.log("✅ Token fetching and storage completed successfully!");
  } catch (error) {
    console.error("❌ Error in main process:", error.message);
    process.exit(1);
  }
}

// Allow running directly from CLI
if (require.main === module) {
  const useExistingFiles = process.argv.includes("--use-existing");
  main(useExistingFiles);
}
