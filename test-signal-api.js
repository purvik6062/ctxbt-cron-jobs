const { getSafeAddressForSpot, sendSignalToSafeAPI } = require('./src/services/signalGeneration');

/**
 * Creates a dummy but valid personalizedSignalData object for testing
 * @returns {Object} - Dummy personalized signal data
 */
function createDummyPersonalizedSignalData() {
    return {
        token: "Uniswap (UNI)",
        signal: "buy",
        currentPrice: 8.10,
        targets: [9.10, 10.50],
        stopLoss: 7.80,
        timeline: "1-2 weeks",
        maxExitTime: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 2 weeks from now
        tradeTip: "UNI showing strong DeFi momentum with potential for 15-20% gains. Key resistance at $9.20, support at $7.80. Consider DCA strategy.",
        tweet_id: "dummy_tweet_123",
        tweet_link: "https://twitter.com/dummy/status/123456789",
        tweet_timestamp: new Date().toISOString(),
        priceAtTweet: 8.25,
        exitValue: null,
        twitterHandle: "CryptoReviewing",
        tokenMentioned: "UNI",
        tokenId: "uniswap",
        lunarCrushMetrics: {
            r_last6h_pct: 3.8,
            d_pct_mktvol_6h: 12.5,
            d_pct_socvol_6h: 18.2,
            d_pct_sent_6h: 6.4,
            d_pct_users_6h: 9.8,
            d_pct_infl_6h: 15.3,
            d_galaxy_6h: 2.8,
            neg_d_altrank_6h: -3.2
        },
        lunarCrushPrediction: 5.2,
        lunarCrushTokenType: "defi",
        userWeightages: {
            r_last6h_pct: 85,
            d_pct_mktvol_6h: 70,
            d_pct_socvol_6h: 60,
            d_pct_sent_6h: 75,
            d_pct_users_6h: 65,
            d_pct_infl_6h: 80,
            d_galaxy_6h: 55,
            neg_d_altrank_6h: 70
        },
        personalizedFor: "p_9899"
    };
}

/**
 * Test function to test getSafeAddressForSpot and sendSignalToSafeAPI
 */
async function testSignalAPI() {
    console.log('🧪 Starting Signal API Test...\n');

    // Create dummy data
    const personalizedSignalData = createDummyPersonalizedSignalData();
    console.log('📊 Created dummy personalized signal data:');
    console.log(JSON.stringify(personalizedSignalData, null, 2));
    console.log('\n' + '='.repeat(80) + '\n');

    // Test username - replace with a real username from your database
    const testUsername = "p_9899"; // Change this to a real username in your database

    try {
        console.log(`🔍 Testing getSafeAddressForSpot for username: ${testUsername}`);
        const spotResult = await getSafeAddressForSpot(testUsername);

        if (spotResult && spotResult.safeAddress) {
            console.log('✅ Successfully retrieved spot safe address:');
            console.log(`   Safe Address: ${spotResult.safeAddress}`);
            console.log(`   Twitter ID: ${spotResult.twitterId}`);
            console.log(`   Network: ${spotResult.networkKey || 'Unknown'}`);

            console.log('\n' + '='.repeat(80) + '\n');

            console.log(`📤 Testing sendSignalToSafeAPI for username: ${testUsername}`);
            const apiResult = await sendSignalToSafeAPI(
                personalizedSignalData,
                testUsername,
                spotResult.safeAddress,
                spotResult.twitterId
            );

            if (apiResult.success) {
                console.log('✅ Successfully sent signal to Safe API:');
                console.log(JSON.stringify(apiResult.response, null, 2));
            } else {
                console.log('❌ Failed to send signal to Safe API:');
                console.log(JSON.stringify(apiResult.error, null, 2));
            }
        } else {
            console.log('❌ No spot safe address found for user:', testUsername);
            console.log('   This could mean:');
            console.log('   - User does not exist in the database');
            console.log('   - User has no safeConfigs configured');
            console.log('   - User has no spot type safe configs');
            console.log('   - User has no safeAddress in their spot configs');
        }

    } catch (error) {
        console.error('❌ Error during testing:', error);
    }

    console.log('\n' + '='.repeat(80) + '\n');
    console.log('🏁 Test completed!');
}

/**
 * Test function with multiple usernames to find a valid one
 */
async function testWithMultipleUsernames() {
    console.log('🔍 Testing with multiple potential usernames...\n');

    // Common test usernames - replace with actual usernames from your database
    const testUsernames = [
        "p_9899",
    ];

    const personalizedSignalData = createDummyPersonalizedSignalData();

    for (const username of testUsernames) {
        console.log(`\n🧪 Testing username: ${username}`);
        console.log('-'.repeat(50));

        try {
            const spotResult = await getSafeAddressForSpot(username);

            if (spotResult && spotResult.safeAddress) {
                console.log(`✅ Found safe address for ${username}: ${spotResult.safeAddress}`);

                // Test sending signal
                const apiResult = await sendSignalToSafeAPI(
                    personalizedSignalData,
                    username,
                    spotResult.safeAddress,
                    spotResult.twitterId
                );

                console.log(`📤 API Result for ${username}:`, apiResult.success ? 'SUCCESS' : 'FAILED');
                if (!apiResult.success) {
                    console.log(`   Error: ${JSON.stringify(apiResult.error)}`);
                }

                // If we found a working user, we can stop here
                if (apiResult.success) {
                    console.log(`\n🎉 Successfully tested with user: ${username}`);
                    break;
                }
            } else {
                console.log(`❌ No safe address found for ${username}`);
            }
        } catch (error) {
            console.error(`❌ Error testing ${username}:`, error.message);
        }
    }
}

// Run the test
if (require.main === module) {
    console.log('🚀 Starting Signal API Test Suite...\n');

    // Test with single username
    testSignalAPI()
        .then(() => {
            console.log('\n' + '='.repeat(80) + '\n');
            console.log('🔄 Running multi-username test...\n');
            return testWithMultipleUsernames();
        })
        .then(() => {
            console.log('\n🏁 All tests completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Test suite failed:', error);
            process.exit(1);
        });
}

module.exports = {
    createDummyPersonalizedSignalData,
    testSignalAPI,
    testWithMultipleUsernames
};
