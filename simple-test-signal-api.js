const { getSafeAddressForSpot, sendSignalToSafeAPI } = require('./src/services/signalGeneration');

/**
 * Simple test with minimal dummy data
 */
async function simpleTest() {
    console.log('🧪 Simple Signal API Test\n');

    // Replace with your actual test username
    const testUsername = "p_9899"; // CHANGE THIS TO A REAL USERNAME

    // Create minimal dummy signal data
    const dummySignalData = {
        token: "Uniswap (UNI)",
        signal: "Buy",
        currentPrice: 8.10,
        targets: [9.10, 10.50],
        stopLoss: 7.80,
        timeline: "1-2 weeks",
        maxExitTime: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        tradeTip: "Test signal for API testing",
        tweet_id: "test_tweet_123",
        tweet_link: "https://twitter.com/test/status/123456789",
        tweet_timestamp: new Date().toISOString(),
        priceAtTweet: 8.25,
        exitValue: null,
        twitterHandle: "CryptoReviewing",
        tokenMentioned: "UNI",
        tokenId: "uniswap",
        personalizedFor: testUsername
    };

    console.log('📊 Dummy Signal Data:');
    console.log(JSON.stringify(dummySignalData, null, 2));
    console.log('\n' + '='.repeat(60) + '\n');

    try {
        // Test 1: Get Safe Address
        console.log(`🔍 Step 1: Getting safe address for user: ${testUsername}`);
        const spotResult = await getSafeAddressForSpot(testUsername);

        if (!spotResult || !spotResult.safeAddress) {
            console.log('❌ No safe address found. Please check:');
            console.log('   - User exists in database');
            console.log('   - User has safeConfigs');
            console.log('   - User has spot type configs');
            console.log('   - User has safeAddress in spot configs');
            return;
        }

        console.log('✅ Safe address found:');
        console.log(`   Address: ${spotResult.safeAddress}`);
        console.log(`   Twitter ID: ${spotResult.twitterId}`);

        console.log('\n' + '='.repeat(60) + '\n');

        // Test 2: Send Signal to Safe API
        console.log(`📤 Step 2: Sending signal to Safe API`);
        const apiResult = await sendSignalToSafeAPI(
            dummySignalData,
            testUsername,
            spotResult.safeAddress,
            spotResult.twitterId
        );

        if (apiResult.success) {
            console.log('✅ Signal sent successfully!');
            console.log('Response:', JSON.stringify(apiResult.response, null, 2));
        } else {
            console.log('❌ Failed to send signal:');
            console.log('Error:', JSON.stringify(apiResult.error, null, 2));
        }

    } catch (error) {
        console.error('💥 Test failed with error:', error.message);
        console.error('Full error:', error);
    }

    console.log('\n🏁 Test completed!');
}

// Run the test
if (require.main === module) {
    simpleTest()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('💥 Test suite failed:', error);
            process.exit(1);
        });
}

module.exports = { simpleTest };
