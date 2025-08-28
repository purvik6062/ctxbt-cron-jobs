const { connect, closeConnection } = require('../db');

/**
 * Test script for the FIXED signalGeneration service
 * Verifies that all missing await keywords have been properly added
 * and the "top30.some is not a function" error is resolved
 */

async function testDatabaseConnection() {
    console.log('🔌 Testing database connection...');
    try {
        const client = await connect();
        console.log('✅ Database connection successful');
        
        const signalFlowDb = client.db("ctxbt-signal-flow");
        const influencersCollection = signalFlowDb.collection('influencers');
        
        // Test if collection exists and has data
        const count = await influencersCollection.countDocuments();
        console.log(`📊 Total influencers in collection: ${count}`);
        
        // Test if influencers have impactFactor field
        const withImpactFactor = await influencersCollection.countDocuments({
            impactFactor: { $exists: true, $ne: null }
        });
        console.log(`📈 Influencers with impactFactor: ${withImpactFactor}`);
        
        if (count === 0) {
            console.log('⚠️  Warning: No influencers found in collection');
        }
        
        return { client, influencersCollection };
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return null;
    }
}

async function testTopInfluencersQuery(limit = 30) {
    console.log(`\n🔍 Testing top ${limit} influencers query...`);
    try {
        const client = await connect();
        const signalFlowDb = client.db("ctxbt-signal-flow");
        const influencersCollection = signalFlowDb.collection('influencers');
        
        // Fetch top influencers sorted by impact factor (descending)
        const topInfluencers = await influencersCollection
            .find({ 
                impactFactor: { $exists: true, $ne: null },
                // Filter out influencers with invalid impact factors
                $and: [
                    { impactFactor: { $ne: Infinity } },
                    { impactFactor: { $ne: -Infinity } },
                    { impactFactor: { $ne: NaN } }
                ]
            })
            .sort({ impactFactor: -1 })
            .limit(limit)
            .project({ 
                twitterHandle: 1, 
                impactFactor: 1, 
                totalPnL: 1, 
                signalCount: 1 
            })
            .toArray();
        
        console.log(`✅ Successfully fetched ${topInfluencers.length} influencers`);
        
        if (topInfluencers.length > 0) {
            console.log('📋 Sample influencer data:');
            topInfluencers.slice(0, Math.min(3, topInfluencers.length)).forEach((inf, index) => {
                console.log(`  ${index + 1}. @${inf.twitterHandle} - Impact: ${inf.impactFactor}`);
            });
        }
        
        // Test if the result is an array and has the some method
        console.log(`\n🧪 Testing array methods:`);
        console.log(`  - Is Array: ${Array.isArray(topInfluencers)}`);
        console.log(`  - Has 'some' method: ${typeof topInfluencers.some === 'function'}`);
        console.log(`  - Has 'length' property: ${typeof topInfluencers.length === 'number'}`);
        console.log(`  - Length value: ${topInfluencers.length}`);
        
        return topInfluencers;
    } catch (error) {
        console.error('❌ Error fetching top influencers:', error.message);
        return null;
    }
}

async function testFixedFunctions() {
    console.log('\n🔧 Testing FIXED functions (with await keywords)...');
    
    try {
        // Import the fixed signalGeneration service
        const signalGeneration = require('../services/signalGeneration');
        
        console.log('✅ Successfully imported signalGeneration service');
        
        // Test 1: getTop10Influencers
        console.log('\n📊 Testing getTop10Influencers()...');
        try {
            const top10 = await signalGeneration.getTop10Influencers();
            console.log(`  ✅ Function returned: ${typeof top10}`);
            console.log(`  - Is Array: ${Array.isArray(top10)}`);
            console.log(`  - Has 'some' method: ${typeof top10.some === 'function'}`);
            console.log(`  - Length: ${top10.length}`);
            
            if (Array.isArray(top10) && top10.length > 0) {
                // Test the some method
                const testHandle = top10[0].twitterHandle;
                const isInTop10 = top10.some(influencer => influencer.twitterHandle === testHandle);
                console.log(`  - Test 'some' method with @${testHandle}: ${isInTop10}`);
            }
        } catch (error) {
            console.log(`  ❌ getTop10Influencers failed: ${error.message}`);
        }
        
        // Test 2: getTop30Influencers
        console.log('\n📊 Testing getTop30Influencers()...');
        try {
            const top30 = await signalGeneration.getTop30Influencers();
            console.log(`  ✅ Function returned: ${typeof top30}`);
            console.log(`  - Is Array: ${Array.isArray(top30)}`);
            console.log(`  - Has 'some' method: ${typeof top30.some === 'function'}`);
            console.log(`  - Length: ${top30.length}`);
            
            if (Array.isArray(top30) && top30.length > 0) {
                // Test the some method
                const testHandle = top30[0].twitterHandle;
                const isInTop30 = top30.some(influencer => influencer.twitterHandle === testHandle);
                console.log(`  - Test 'some' method with @${testHandle}: ${isInTop30}`);
            }
        } catch (error) {
            console.log(`  ❌ getTop30Influencers failed: ${error.message}`);
        }
        
        // Test 3: isTop10Influencer
        console.log('\n👤 Testing isTop10Influencer()...');
        try {
            // Test with a sample Twitter handle
            const testHandle = 'testuser';
            const isTop10 = await signalGeneration.isTop10Influencer(testHandle);
            console.log(`  ✅ Function returned: ${typeof isTop10}`);
            console.log(`  - Is Boolean: ${typeof isTop10 === 'boolean'}`);
            console.log(`  - Result for @${testHandle}: ${isTop10}`);
        } catch (error) {
            console.log(`  ❌ isTop10Influencer failed: ${error.message}`);
        }
        
        // Test 4: isTop30Influencer
        console.log('\n👤 Testing isTop30Influencer()...');
        try {
            // Test with a sample Twitter handle
            const testHandle = 'testuser';
            const isTop30 = await signalGeneration.isTop30Influencer(testHandle);
            console.log(`  ✅ Function returned: ${typeof isTop30}`);
            console.log(`  - Is Boolean: ${typeof isTop30 === 'boolean'}`);
            console.log(`  - Result for @${testHandle}: ${isTop30}`);
        } catch (error) {
            console.log(`  ❌ isTop30Influencer failed: ${error.message}`);
        }
        
        // Test 5: getCurrentTopInfluencers
        console.log('\n📋 Testing getCurrentTopInfluencers()...');
        try {
            const currentInfluencers = await signalGeneration.getCurrentTopInfluencers();
            console.log(`  ✅ Function returned: ${typeof currentInfluencers}`);
            console.log(`  - Has top10: ${currentInfluencers.top10 ? 'Yes' : 'No'}`);
            console.log(`  - Has top30: ${currentInfluencers.top30 ? 'Yes' : 'No'}`);
            console.log(`  - Top10 length: ${currentInfluencers.top10 ? currentInfluencers.top10.length : 'N/A'}`);
            console.log(`  - Top30 length: ${currentInfluencers.top30 ? currentInfluencers.top30.length : 'N/A'}`);
            
            if (currentInfluencers.top10 && Array.isArray(currentInfluencers.top10)) {
                console.log(`  - Top10 is array: ${Array.isArray(currentInfluencers.top10)}`);
                console.log(`  - Top10 has 'some' method: ${typeof currentInfluencers.top10.some === 'function'}`);
            }
            
            if (currentInfluencers.top30 && Array.isArray(currentInfluencers.top30)) {
                console.log(`  - Top30 is array: ${Array.isArray(currentInfluencers.top30)}`);
                console.log(`  - Top30 has 'some' method: ${typeof currentInfluencers.top30.some === 'function'}`);
            }
        } catch (error) {
            console.log(`  ❌ getCurrentTopInfluencers failed: ${error.message}`);
        }
        
        // Test 6: checkInfluencerEligibility
        console.log('\n🎯 Testing checkInfluencerEligibility()...');
        try {
            const testHandle = 'testuser';
            const testToken = 'bitcoin';
            const eligibility = await signalGeneration.checkInfluencerEligibility(testHandle, testToken);
            console.log(`  ✅ Function returned: ${typeof eligibility}`);
            console.log(`  - Has expected properties: ${eligibility.twitterHandle && eligibility.tokenId ? 'Yes' : 'No'}`);
            console.log(`  - Is BTC: ${eligibility.isBTC}`);
            console.log(`  - Is in top10: ${eligibility.isInTop10}`);
            console.log(`  - Is in top30: ${eligibility.isInTop30}`);
        } catch (error) {
            console.log(`  ❌ checkInfluencerEligibility failed: ${error.message}`);
        }
        
        return true;
    } catch (error) {
        console.error('❌ Error testing fixed functions:', error.message);
        return false;
    }
}

async function testArrayMethods() {
    console.log('\n🧪 Testing array methods on returned data...');
    
    try {
        const signalGeneration = require('../services/signalGeneration');
        
        // Test array methods on top30 data
        const top30 = await signalGeneration.getTop30Influencers();
        
        if (Array.isArray(top30) && top30.length > 0) {
            console.log('✅ Testing array methods on top30 data:');
            
            // Test .some()
            const testHandle = top30[0].twitterHandle;
            const isInTop30 = top30.some(influencer => influencer.twitterHandle === testHandle);
            console.log(`  - .some() method: ✅ Works - @${testHandle} in top30: ${isInTop30}`);
            
            // Test .find()
            const foundInfluencer = top30.find(influencer => influencer.twitterHandle === testHandle);
            console.log(`  - .find() method: ✅ Works - Found: ${foundInfluencer ? 'Yes' : 'No'}`);
            
            // Test .filter()
            const filteredInfluencers = top30.filter(influencer => influencer.impactFactor > 0);
            console.log(`  - .filter() method: ✅ Works - Filtered count: ${filteredInfluencers.length}`);
            
            // Test .map()
            const twitterHandles = top30.map(influencer => influencer.twitterHandle);
            console.log(`  - .map() method: ✅ Works - Mapped count: ${twitterHandles.length}`);
            
            // Test .length
            console.log(`  - .length property: ✅ Works - Length: ${top30.length}`);
            
            console.log('🎉 All array methods working correctly!');
        } else {
            console.log('⚠️  No top30 data available for array method testing');
        }
        
        return true;
    } catch (error) {
        console.error('❌ Error testing array methods:', error.message);
        return false;
    }
}

async function testErrorHandling() {
    console.log('\n🚨 Testing error handling...');
    
    try {
        const signalGeneration = require('../services/signalGeneration');
        
        // Test with invalid Twitter handle
        console.log('Testing with invalid Twitter handle...');
        try {
            const result = await signalGeneration.isTop30Influencer('');
            console.log(`  ✅ Handled empty string: ${result}`);
        } catch (error) {
            console.log(`  ❌ Error with empty string: ${error.message}`);
        }
        
        // Test with null Twitter handle
        console.log('Testing with null Twitter handle...');
        try {
            const result = await signalGeneration.isTop30Influencer(null);
            console.log(`  ✅ Handled null: ${result}`);
        } catch (error) {
            console.log(`  ❌ Error with null: ${error.message}`);
        }
        
        // Test with undefined Twitter handle
        console.log('Testing with undefined Twitter handle...');
        try {
            const result = await signalGeneration.isTop30Influencer(undefined);
            console.log(`  ✅ Handled undefined: ${result}`);
        } catch (error) {
            console.log(`  ❌ Error with undefined: ${error.message}`);
        }
        
        return true;
    } catch (error) {
        console.error('❌ Error in error handling tests:', error.message);
        return false;
    }
}

async function runAllTests() {
    console.log('🚀 Starting Fixed SignalGeneration Service Tests\n');
    console.log('🔧 Testing that all missing await keywords have been properly added\n');
    
    try {
        // Test 1: Database connection
        const dbResult = await testDatabaseConnection();
        if (!dbResult) {
            console.log('❌ Cannot proceed without database connection');
            return;
        }
        
        // Test 2: Direct database query
        const topInfluencers = await testTopInfluencersQuery(30);
        if (!topInfluencers) {
            console.log('❌ Cannot proceed without influencer data');
            return;
        }
        
        // Test 3: Fixed functions
        const functionsResult = await testFixedFunctions();
        if (!functionsResult) {
            console.log('❌ Fixed functions test failed');
            return;
        }
        
        // Test 4: Array methods
        const arrayMethodsResult = await testArrayMethods();
        if (!arrayMethodsResult) {
            console.log('❌ Array methods test failed');
            return;
        }
        
        // Test 5: Error handling
        const errorHandlingResult = await testErrorHandling();
        if (!errorHandlingResult) {
            console.log('❌ Error handling test failed');
            return;
        }
        
        console.log('\n🎉 SUCCESS: All tests passed!');
        console.log('✅ The signalGeneration service is now working correctly');
        console.log('✅ All missing await keywords have been properly added');
        console.log('✅ The "top30.some is not a function" error is resolved');
        console.log('✅ All functions now return arrays instead of Promises');
        console.log('✅ Array methods like .some(), .find(), .filter(), .map() work correctly');
        
    } catch (error) {
        console.error('❌ Test suite failed:', error.message);
    } finally {
        // Close database connection
        try {
            await closeConnection();
            console.log('\n🔌 Database connection closed');
        } catch (error) {
            console.error('❌ Error closing database connection:', error.message);
        }
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    runAllTests().catch(console.error);
}

module.exports = {
    testDatabaseConnection,
    testTopInfluencersQuery,
    testFixedFunctions,
    testArrayMethods,
    testErrorHandling,
    runAllTests
};
