const { updateDeliveryConfig, getDeliveryConfig } = require('../services/telegramService');

/**
 * Delivery Configuration Manager
 * Provides easy ways to configure the progressive signal delivery system
 */
class DeliveryConfigManager {
    constructor() {
        this.config = getDeliveryConfig();
    }

    /**
     * Get current delivery configuration
     * @returns {Object} Current configuration
     */
    getCurrentConfig() {
        return { ...this.config };
    }

    /**
     * Set delivery configuration for different scenarios
     * @param {string} scenario - Predefined scenario name
     */
    setScenario(scenario) {
        const scenarios = {
            // Fast delivery - for urgent signals
            'fast': {
                batchSize: 5,
                delayBetweenBatches: 1 * 60 * 1000,    // 1 minute
                delayBetweenSignals: 15 * 1000,         // 15 seconds
            },
            
            // Normal delivery - default balanced approach
            'normal': {
                batchSize: 3,
                delayBetweenBatches: 2 * 60 * 1000,    // 2 minutes
                delayBetweenSignals: 30 * 1000,         // 30 seconds
            },
            
            // Slow delivery - for high volume, spread out over time
            'slow': {
                batchSize: 2,
                delayBetweenBatches: 5 * 60 * 1000,    // 5 minutes
                delayBetweenSignals: 60 * 1000,         // 1 minute
            },
            
            // Ultra slow - for very high volume, maximum spread
            'ultra-slow': {
                batchSize: 1,
                delayBetweenBatches: 10 * 60 * 1000,   // 10 minutes
                delayBetweenSignals: 2 * 60 * 1000,     // 2 minutes
            }
        };

        if (scenarios[scenario]) {
            updateDeliveryConfig(scenarios[scenario]);
            this.config = getDeliveryConfig();
            console.log(`✅ Delivery configuration set to '${scenario}' scenario`);
            this.logCurrentConfig();
        } else {
            console.error(`❌ Unknown scenario: ${scenario}`);
            console.log('Available scenarios:', Object.keys(scenarios));
        }
    }

    /**
     * Set custom delivery configuration
     * @param {Object} customConfig - Custom configuration object
     */
    setCustomConfig(customConfig) {
        // Validate configuration
        const requiredFields = ['batchSize', 'delayBetweenBatches', 'delayBetweenSignals'];
        const missingFields = requiredFields.filter(field => !(field in customConfig));
        
        if (missingFields.length > 0) {
            console.error(`❌ Missing required fields: ${missingFields.join(', ')}`);
            return;
        }

        // Validate values
        if (customConfig.batchSize < 1) {
            console.error('❌ batchSize must be at least 1');
            return;
        }

        if (customConfig.delayBetweenBatches < 0 || customConfig.delayBetweenSignals < 0) {
            console.error('❌ Delays cannot be negative');
            return;
        }

        updateDeliveryConfig(customConfig);
        this.config = getDeliveryConfig();
        console.log('✅ Custom delivery configuration applied');
        this.logCurrentConfig();
    }

    /**
     * Calculate estimated delivery time for a given number of signals
     * @param {number} signalCount - Number of signals to deliver
     * @returns {Object} Estimated delivery information
     */
    calculateDeliveryTime(signalCount) {
        const batches = Math.ceil(signalCount / this.config.batchSize);
        const totalBatchDelays = (batches - 1) * this.config.delayBetweenBatches;
        const totalSignalDelays = signalCount * this.config.delayBetweenSignals;
        
        const estimatedTime = totalBatchDelays + totalSignalDelays;
        const estimatedMinutes = Math.round(estimatedTime / 1000 / 60 * 100) / 100;
        
        return {
            signalCount,
            batches,
            estimatedTime,
            estimatedMinutes,
            estimatedSeconds: Math.round(estimatedTime / 1000),
            configuration: this.config
        };
    }

    /**
     * Log current configuration in a readable format
     */
    logCurrentConfig() {
        console.log('\n⚙️  CURRENT DELIVERY CONFIGURATION:');
        console.log(`   Batch Size: ${this.config.batchSize} signals per batch`);
        console.log(`   Delay Between Batches: ${this.config.delayBetweenBatches / 1000 / 60} minutes`);
        console.log(`   Delay Between Signals: ${this.config.delayBetweenSignals / 1000} seconds`);
        
        // Calculate example delivery times
        const examples = [5, 10, 20, 50];
        console.log('\n📊 EXAMPLE DELIVERY TIMES:');
        examples.forEach(count => {
            const estimate = this.calculateDeliveryTime(count);
            console.log(`   ${count} signals: ~${estimate.estimatedMinutes} minutes (${estimate.batches} batches)`);
        });
    }

    /**
     * Get recommended configuration based on signal volume
     * @param {number} signalCount - Expected number of signals
     * @returns {string} Recommended scenario name
     */
    getRecommendedScenario(signalCount) {
        if (signalCount <= 5) return 'fast';
        if (signalCount <= 15) return 'normal';
        if (signalCount <= 30) return 'slow';
        return 'ultra-slow';
    }

    /**
     * Auto-configure based on signal volume
     * @param {number} signalCount - Expected number of signals
     */
    autoConfigure(signalCount) {
        const scenario = this.getRecommendedScenario(signalCount);
        console.log(`🤖 Auto-configuring for ${signalCount} signals using '${scenario}' scenario`);
        this.setScenario(scenario);
    }
}

// Create and export a singleton instance
const deliveryConfigManager = new DeliveryConfigManager();

// Allow direct execution for testing
if (require.main === module) {
    console.log('🧪 Testing Delivery Configuration Manager\n');
    
    // Test different scenarios
    deliveryConfigManager.logCurrentConfig();
    
    console.log('\n--- Testing Fast Scenario ---');
    deliveryConfigManager.setScenario('fast');
    
    console.log('\n--- Testing Slow Scenario ---');
    deliveryConfigManager.setScenario('slow');
    
    console.log('\n--- Testing Custom Configuration ---');
    deliveryConfigManager.setCustomConfig({
        batchSize: 4,
        delayBetweenBatches: 3 * 60 * 1000,
        delayBetweenSignals: 45 * 1000,             
    });
    
    console.log('\n--- Testing Auto-Configuration ---');
    deliveryConfigManager.autoConfigure(25);
}

module.exports = deliveryConfigManager;
