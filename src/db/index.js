// src/db/index.js
const { MongoClient } = require('mongodb');
const { mongoUri } = require('../config/config');

require('dotenv').config();

async function connect() {
    const client = new MongoClient(mongoUri);
    await client.connect();
    console.log('Connected to MongoDB');
    return client;
}

module.exports = { connect };
