const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { connect, closeConnection } = require('../db');
const { dbName, lunarcrushTokensCollectionName } = require('../config/config');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  let client;
  try {
    client = await connect();
    const db = client.db(dbName);
    const col = db.collection(lunarcrushTokensCollectionName);

    // Load tokens from a local JSON file if present, else fall back to embedded array
    let tokens = [];
    const legacyFile = path.resolve(__dirname, '../../utils/abhi_sheet1_formatted.csv');
    if (fs.existsSync('backtesting_top_50_tokens.json')) {
      tokens = JSON.parse(fs.readFileSync('backtesting_top_50_tokens.json', 'utf8'));
    } else if (fs.existsSync('backtesting-top-50-divided.json')) {
      tokens = JSON.parse(fs.readFileSync('backtesting-top-50-divided.json', 'utf8'));
    } else {
      // Minimal seed to avoid empty collection if no external file available
      tokens = [
        { symbol: 'BTC', type: 'major coin' },
        { symbol: 'ETH', type: 'major coin' },
      ];
    }

    // Normalize shape
    const docs = tokens.map((t) => ({
      symbol: (t.symbol || t['Token Mentioned'] || '').toUpperCase(),
      type: t.type || 'major coin',
    })).filter((d) => d.symbol);

    if (docs.length === 0) {
      console.error('No tokens to seed');
      return;
    }

    // Upsert all tokens by symbol
    const ops = docs.map((d) => ({
      updateOne: {
        filter: { symbol: d.symbol },
        update: { $set: { symbol: d.symbol, type: d.type } },
        upsert: true,
      }
    }));

    const result = await col.bulkWrite(ops, { ordered: false });
    console.log('Seeded lunarcrush tokens:', result?.nUpserted || result?.upsertedCount || 0, 'upserted');
  } catch (e) {
    console.error('Failed seeding lunarcrush tokens:', e?.message || e);
  } finally {
    if (client) await closeConnection(client);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };


