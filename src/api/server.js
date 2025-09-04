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


const PORT = parseInt(process.env.PORT, 10) || 5001;
app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});

module.exports = app;