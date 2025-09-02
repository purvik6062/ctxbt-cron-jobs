#!/usr/bin/env node

/**
 * Test Script for Signal Flow Functionality
 *
 * This script tests the following functionality:
 * 1. Safe address lookup for users
 * 2. Sending signals to GMX API for subscribers
 * 3. End-to-end flow testing
 *
 * Usage:
 * node test-signal-flow.js [test-type] [options]
 *
 * Test Types:
 * - safe-address: Test safe address lookup
 * - gmx-api: Test GMX API signal sending
 * - full-flow: Test complete flow with real data
 * - mock-flow: Test with mock data
 *
 * Options:
 * --username=<username>: Specify username for testing
 * --twitter-handle=<handle>: Specify twitter handle for testing
 * --mock: Use mock data instead of real database
 */

const { connect, closeConnection } = require('../db');
const { MongoClient } = require('mongodb');
const axios = require('axios');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

/**
 * Mock data for testing when database is not available
 */
const MOCK_DATA = {
    users: [
        {
            twitterUsername: 'abhip05',
            twitterId: '1256784045121429505',
            subscribedAccounts: [
                { twitterHandle: 'IncomeSharks', subscriptionDate: new Date() },
                { twitterHandle: 'cryptostasher', subscriptionDate: new Date() }
            ]
        },
        {
            twitterUsername: 'testuser',
            twitterId: '1234567890123456789',
            subscribedAccounts: [
                { twitterHandle: 'TestTrader', subscriptionDate: new Date() }
            ]
        }
    ],
    safes: [
        {
            userInfo: { userId: '1256784045121429505' },
            deployments: {
                arbitrum_sepolia: {
                    address: '0x11AEB703d20D488f27e68d3fa2bC28B2d004433B'
                }
            }
        },
        {
            userInfo: { userId: '1234567890123456789' },
            deployments: {
                arbitrum_sepolia: {
                    address: '0x27497bf21acade3B832fcb2C108132812631346F'
                }
            }
        }
    ]
};

/**
 * Mock signal data for testing
 */
const MOCK_SIGNAL_DATA = {
    signal: 'buy',
    tokenMentioned: 'BTC',
    targets: [108000, 108200],
    stopLoss: 107200,
    currentPrice: 107640,
    maxExitTime: '2025-09-27T11:20:29.000Z',
    twitterHandle: 'IncomeSharks'
};

/**
 * Gets the safe address for a user from the safe-deployment-service database
 * @param {string} username - The username of the user
 * @param {boolean} useMock - Whether to use mock data
 * @returns {string|null} - The safe address for arbitrum network or null if not found
 */
async function getSafeAddressForUser(username, useMock = false) {
    if (useMock) {
        console.log(`🔍 [MOCK] Looking up safe address for user: ${username}`);
        const user = MOCK_DATA.users.find(u => u.twitterUsername === username);
        if (!user) {
            console.log(`❌ [MOCK] No user found for username: ${username}`);
            return null;
        }

        const safe = MOCK_DATA.safes.find(s => s.userInfo.userId === user.twitterId);
        if (!safe || !safe.deployments.arbitrum_sepolia) {
            console.log(`❌ [MOCK] No safe address found for user: ${username}`);
            return null;
        }

        const safeAddress = safe.deployments.arbitrum_sepolia.address;
        console.log(`✅ [MOCK] Found safe address for ${username}: ${safeAddress}`);
        return safeAddress;
    }

    let client;
    try {
        client = await connect();

        // First get twitterId from users collection in ctxbt-signal-flow db
        const signalFlowDb = client.db("ctxbt-signal-flow");
        const usersCollection = signalFlowDb.collection("users");

        const userDoc = await usersCollection.findOne({ twitterUsername: username });
        if (!userDoc || !userDoc.twitterId) {
            console.log(`❌ No twitterId found for user ${username}`);
            return null;
        }

        const twitterId = userDoc.twitterId;

        // Now get safe address from safe-deployment-service db
        const safeDeploymentDb = client.db("safe-deployment-service");
        const safesCollection = safeDeploymentDb.collection("safes");

        const safeDoc = await safesCollection.findOne({
            "userInfo.userId": twitterId.toString()
        });

        if (!safeDoc || !safeDoc.deployments || !safeDoc.deployments.arbitrum_sepolia) {
            console.log(`❌ No arbitrum safe address found for user ${username} with twitterId ${twitterId}`);
            return null;
        }

        const safeAddress = safeDoc.deployments.arbitrum_sepolia.address;
        console.log(`✅ Found safe address for ${username}: ${safeAddress}`);
        return safeAddress;

    } catch (error) {
        console.error(`❌ Error getting safe address for user ${username}:`, error);
        return null;
    } finally {
        if (client) await closeConnection(client);
    }
}

/**
 * Sends signal to the GMX API for a subscriber
 * @param {Object} signalData - The signal data
 * @param {string} username - The subscriber's username
 * @param {string} safeAddress - The subscriber's safe address
 * @param {boolean} dryRun - If true, don't actually send to API
 * @returns {Object} - Result object with success status and response/error
 */
async function sendSignalToGMXAPI(signalData, username, safeAddress, dryRun = false) {
    try {
        const payload = {
            "Signal Message": signalData.signal,
            "Token Mentioned": signalData.tokenMentioned,
            "TP1": signalData.targets && signalData.targets.length > 0 ? signalData.targets[0] : null,
            "TP2": signalData.targets && signalData.targets.length > 1 ? signalData.targets[1] : null,
            "SL": signalData.stopLoss || null,
            "Current Price": signalData.currentPrice,
            "Max Exit Time": signalData.maxExitTime ? { "$date": signalData.maxExitTime } : null,
            "username": username,
            "safeAddress": safeAddress,
            "autoExecute": true
        };

        console.log(`📤 Sending signal to GMX API for user ${username}:`);
        console.log(JSON.stringify(payload, null, 2));

        if (dryRun) {
            console.log(`🔍 [DRY RUN] Would send to: ${process.env.GMX_API_URL}/position/create-with-tp-sl`);
            return {
                success: true,
                response: { message: "Dry run - would send to API", dryRun: true }
            };
        }

        if (!process.env.GMX_API_URL) {
            console.error('❌ GMX_API_URL not configured');  
            return {
                success: false,
                error: 'Missing GMX_API_URL environment variables'
            };
        }

        const response = await axios.post(`${process.env.GMX_API_URL}/position/create-with-tp-sl`, payload, {
            headers: {
                'Content-Type': 'application/json',
            },      
            timeout: 10000
        });

        console.log(`✅ Successfully sent signal to GMX API for ${username}:`, response.data);
        return { success: true, response: response.data };

    } catch (error) {
        console.error(`❌ Failed to send signal to GMX API for ${username}:`, error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data || error.message
        };
    }
}

/**
 * Checks if a user is subscribed to a specific twitter handle
 * @param {string} username - The username to check
 * @param {string} twitterHandle - The twitter handle to check subscription for
 * @param {boolean} useMock - Whether to use mock data
 * @returns {boolean} - True if subscribed, false otherwise
 */
async function isUserSubscribedTo(username, twitterHandle, useMock = false) {
    if (useMock) {
        console.log(`🔍 [MOCK] Checking if ${username} is subscribed to ${twitterHandle}`);
        const user = MOCK_DATA.users.find(u => u.twitterUsername === username);
        if (!user) {
            console.log(`❌ [MOCK] User ${username} not found`);
            return false;
        }

        const isSubscribed = user.subscribedAccounts.some(acc => acc.twitterHandle === twitterHandle);
        console.log(`${isSubscribed ? '✅' : '❌'} [MOCK] User ${username} ${isSubscribed ? 'is' : 'is not'} subscribed to ${twitterHandle}`);
        return isSubscribed;
    }

    let client;
    try {
        client = await connect();
        const signalFlowDb = client.db("ctxbt-signal-flow");
        const usersCollection = signalFlowDb.collection("users");

        const userDoc = await usersCollection.findOne({
            twitterUsername: username,
            "subscribedAccounts.twitterHandle": twitterHandle
        });

        const isSubscribed = !!userDoc;
        console.log(`${isSubscribed ? '✅' : '❌'} User ${username} ${isSubscribed ? 'is' : 'is not'} subscribed to ${twitterHandle}`);
        return isSubscribed;

    } catch (error) {
        console.error(`❌ Error checking subscription for ${username}:`, error);
        return false;
    } finally {
        if (client) await closeConnection(client);
    }
}

/**
 * Test safe address lookup functionality
 */
async function testSafeAddressLookup(username, useMock = false) {
    console.log(`\n🧪 Testing Safe Address Lookup`);
    console.log(`=================================`);
    console.log(`Username: ${username}`);
    console.log(`Using: ${useMock ? 'Mock Data' : 'Real Database'}`);
    console.log(`=================================`);

    const safeAddress = await getSafeAddressForUser(username, useMock);

    if (safeAddress) {
        console.log(`✅ Test PASSED: Found safe address: ${safeAddress}`);
        return { success: true, safeAddress };
    } else {
        console.log(`❌ Test FAILED: No safe address found`);
        return { success: false, safeAddress: null };
    }
}

/**
 * Test GMX API signal sending functionality
 */
async function testGMXAPISending(username, useMock = false, dryRun = true) {
    console.log(`\n🧪 Testing GMX API Signal Sending`);
    console.log(`====================================`);
    console.log(`Username: ${username}`);
    console.log(`Using: ${useMock ? 'Mock Data' : 'Real Database'}`);
    console.log(`Mode: ${dryRun ? 'Dry Run' : 'Live API Call'}`);
    console.log(`====================================`);

    // First get safe address
    const safeAddress = await getSafeAddressForUser(username, useMock);
    if (!safeAddress) {
        console.log(`❌ Test FAILED: Cannot proceed without safe address`);
        return { success: false, error: 'No safe address found' };
    }

    // Send signal to API
    const result = await sendSignalToGMXAPI(MOCK_SIGNAL_DATA, username, safeAddress, dryRun);

    if (result.success) {
        console.log(`✅ Test PASSED: Signal sent successfully`);
        return { success: true, result };
    } else {
        console.log(`❌ Test FAILED: ${result.error}`);
        return { success: false, error: result.error };
    }
}

/**
 * Test complete flow with subscription check
 */
async function testFullFlow(username, twitterHandle, useMock = false, dryRun = true) {
    console.log(`\n🧪 Testing Complete Signal Flow`);
    console.log(`=================================`);
    console.log(`Username: ${username}`);
    console.log(`Twitter Handle: ${twitterHandle}`);
    console.log(`Using: ${useMock ? 'Mock Data' : 'Real Database'}`);
    console.log(`Mode: ${dryRun ? 'Dry Run' : 'Live API Call'}`);
    console.log(`=================================`);

    // Step 1: Check subscription
    console.log(`\n📋 Step 1: Checking subscription...`);
    const isSubscribed = await isUserSubscribedTo(username, twitterHandle, useMock);
    if (!isSubscribed) {
        console.log(`❌ Test FAILED: User is not subscribed to ${twitterHandle}`);
        return { success: false, error: 'User not subscribed' };
    }

    // Step 2: Get safe address
    console.log(`\n🔐 Step 2: Getting safe address...`);
    const safeAddress = await getSafeAddressForUser(username, useMock);
    if (!safeAddress) {
        console.log(`❌ Test FAILED: No safe address found`);
        return { success: false, error: 'No safe address found' };
    }

    // Step 3: Send signal to API
    console.log(`\n📤 Step 3: Sending signal to GMX API...`);
    const result = await sendSignalToGMXAPI(MOCK_SIGNAL_DATA, username, safeAddress, dryRun);

    if (result.success) {
        console.log(`\n🎉 Test PASSED: Complete flow successful!`);
        return { success: true, result };
    } else {
        console.log(`\n❌ Test FAILED: API call failed`);
        return { success: false, error: result.error };
    }
}

/**
 * Test with mock data only
 */
async function testMockFlow() {
    console.log(`\n🧪 Testing with Mock Data`);
    console.log(`==========================`);

    console.log(`Available mock users:`);
    MOCK_DATA.users.forEach(user => {
        console.log(`  - ${user.twitterUsername} (subscribed to: ${user.subscribedAccounts.map(acc => acc.twitterHandle).join(', ')})`);
    });

    // Test all combinations
    for (const user of MOCK_DATA.users) {
        for (const subscription of user.subscribedAccounts) {
            console.log(`\n--- Testing ${user.twitterUsername} -> ${subscription.twitterHandle} ---`);
            await testFullFlow(user.twitterUsername, subscription.twitterHandle, true, true);
        }
    }
}

/**
 * Display usage information
 */
function showUsage() {
    console.log(`
🧪 Signal Flow Test Script
==========================

Usage: node test-signal-flow.js [test-type] [options]

Test Types:
  safe-address    Test safe address lookup for a user
  gmx-api         Test GMX API signal sending
  full-flow       Test complete flow with subscription check
  mock-flow       Test with all available mock data combinations

Options:
  --username=<username>     Specify username (default: abhip05)
  --twitter-handle=<handle> Specify twitter handle (default: IncomeSharks)
  --mock                    Use mock data instead of real database
  --live                    Make actual API calls (dangerous!)
  --help                    Show this help

Examples:
  node test-signal-flow.js safe-address --username=abhip05
  node test-signal-flow.js gmx-api --username=abhip05 --mock
  node test-signal-flow.js full-flow --username=abhip05 --twitter-handle=IncomeSharks --live
  node test-signal-flow.js mock-flow

Environment Variables Required for Live Testing:
  GMX_API_URL    - GMX API endpoint URL
  MONGODB_URI    - MongoDB connection string
`);
}

/**
 * Parse command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        testType: args[0] || 'help',
        username: 'abhip05',
        twitterHandle: 'IncomeSharks',
        useMock: false,
        dryRun: true
    };

    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--username=')) {
            options.username = arg.split('=')[1];
        } else if (arg.startsWith('--twitter-handle=')) {
            options.twitterHandle = arg.split('=')[1];
        } else if (arg === '--mock') {
            options.useMock = true;
        } else if (arg === '--live') {
            options.dryRun = false;
        } else if (arg === '--help') {
            options.testType = 'help';
        }
    }

    return options;
}

/**
 * Main function
 */
async function main() {
    const options = parseArgs();

    console.log(`🚀 Signal Flow Test Script Starting...`);
    console.log(`======================================`);

    if (!process.env.MONGODB_URI && !options.useMock) {
        console.log(`⚠️  Warning: MONGODB_URI not set. Use --mock for mock data testing.`);
    }

    if ((!process.env.GMX_API_URL) && !options.dryRun) {
        console.log(`⚠️  Warning: GMX_API_URL not set. Use dry run mode or set environment variables.`);
    }

    try {
        switch (options.testType) {
            case 'safe-address':
                await testSafeAddressLookup(options.username, options.useMock);
                break;

            case 'gmx-api':
                await testGMXAPISending(options.username, options.useMock, options.dryRun);
                break;

            case 'full-flow':
                await testFullFlow(options.username, options.twitterHandle, options.useMock, options.dryRun);
                break;

            case 'mock-flow':
                await testMockFlow();
                break;

            case 'help':
            default:
                showUsage();
                break;
        }

        console.log(`\n✅ Test script completed successfully!`);
    } catch (error) {
        console.error(`\n❌ Test script failed:`, error);
        process.exit(1);
    }
}

// Run the script if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = {
    getSafeAddressForUser,
    sendSignalToGMXAPI,
    isUserSubscribedTo,
    testSafeAddressLookup,
    testGMXAPISending,
    testFullFlow
};
