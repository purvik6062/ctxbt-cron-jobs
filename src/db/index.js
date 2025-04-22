// src/db/index.js
const { MongoClient } = require('mongodb');
const { mongoUri } = require('../config/config');

require('dotenv').config();

// Create a singleton client instance
let client = null;
let connectionsCounter = 0;

async function connect() {
    if (!client) {
        // Initialize the client only once
        client = new MongoClient(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            // Add poolSize to limit the number of connections
            maxPoolSize: 20,
            // Add connection timeout
            connectTimeoutMS: 30000,
            // Add socket timeout
            socketTimeoutMS: 45000
        });
        // Connect only once
        await client.connect();
        console.log('Connected to MongoDB (initial connection)');
    }

    // Track number of active connections for debugging
    connectionsCounter++;
    console.log(`MongoDB connection acquired. Active connections: ${connectionsCounter}`);

    return client;
}

// Add a proper close function that doesn't actually close the client
// but decrements the counter to track usage
async function closeConnection(client) {
    if (connectionsCounter > 0) {
        connectionsCounter--;
    }
    console.log(`MongoDB connection released. Active connections: ${connectionsCounter}`);
    // Don't actually close the connection, just track it
    // We'll keep the connection open for reuse
    return true;
}

// Only disconnect when the application is shutting down
async function disconnect() {
    if (client) {
        await client.close();
        client = null;
        connectionsCounter = 0;
        console.log('MongoDB connection closed completely');
    }
}

module.exports = { connect, closeConnection, disconnect };
