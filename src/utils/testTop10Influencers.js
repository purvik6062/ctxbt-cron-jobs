const { isTop10Influencer, TOP_10_INFLUENCERS } = require('../services/signalGeneration');

/**
 * Test function to verify top 10 influencers functionality
 */
function testTop10Influencers() {
    console.log('Testing Top 10 Influencers Functionality...');
    console.log('\nTop 10 Influencers List:');
    TOP_10_INFLUENCERS.forEach((influencer, index) => {
        console.log(`${index + 1}. ${influencer}`);
    });

    console.log('\nTesting isTop10Influencer function:');
    
    // Test with top 10 influencers
    const testTop10 = [
        'RiddlerDeFi',
        'AltcoinLevi',
        'TradeMogulPro',
        'dippy_eth',
        'CryptoHeroTA',
        'CryptoEnact',
        'CryptoTraderRai',
        'Ashikur1589',
        'MuroCrypto',
        'BenjiGanar'
    ];

    console.log('\n✅ Testing top 10 influencers (should all return true):');
    testTop10.forEach(influencer => {
        const result = isTop10Influencer(influencer);
        console.log(`${influencer}: ${result ? '✅' : '❌'}`);
    });

    // Test with non-top 10 influencers
    const testNonTop10 = [
        'someOtherInfluencer',
        'randomUser',
        'testAccount',
        'CryptoDonAlt',
        'SmartContracter'
    ];

    console.log('\n❌ Testing non-top 10 influencers (should all return false):');
    testNonTop10.forEach(influencer => {
        const result = isTop10Influencer(influencer);
        console.log(`${influencer}: ${result ? '❌' : '✅'}`);
    });

    console.log('\n🎯 Summary:');
    console.log(`- Total top 10 influencers: ${TOP_10_INFLUENCERS.length}`);
    console.log(`- Function correctly identifies top 10: ${testTop10.every(influencer => isTop10Influencer(influencer))}`);
    console.log(`- Function correctly excludes non-top 10: ${testNonTop10.every(influencer => !isTop10Influencer(influencer))}`);
}

// Run test if this file is executed directly
if (require.main === module) {
    testTop10Influencers();
}

module.exports = { testTop10Influencers };
