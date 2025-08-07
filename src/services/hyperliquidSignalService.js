const axios = require('axios');
const { hyperliquid } = require('../config/config');

/**
 * Sends a trading signal to the Hyperliquid Python API for position creation
 * @param {Object} signalData - The signal data object
 * @returns {Promise<Object>} - API response
 */
async function sendSignalToHyperliquidAPI(signalData) {
    try {
        // Validate required fields
        if (!signalData.signal || !signalData.tokenMentioned) {
            throw new Error('Missing required fields: signal and tokenMentioned');
        }

        // Prepare the signal payload according to the Python API format
        const payload = {
            'Signal Message': signalData.signal.toLowerCase(),
            'Token Mentioned': signalData.tokenMentioned,
            'TP1': signalData.targets && signalData.targets.length > 0 ? signalData.targets[0] : null,
            'TP2': signalData.targets && signalData.targets.length > 1 ? signalData.targets[1] : null,
            'SL': signalData.stopLoss || null,
            'Current Price': signalData.currentPrice || null,
            'Max Exit Time': signalData.maxExitTime ? { '$date': new Date(signalData.maxExitTime).toISOString() } : null
        };

        console.log(`Sending signal to Hyperliquid API: ${JSON.stringify(payload, null, 2)}`);

        const response = await axios.post(hyperliquid.apiUrl, payload, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: hyperliquid.timeout
        });

        console.log(`Hyperliquid API response: ${JSON.stringify(response.data, null, 2)}`);
        return response.data;

    } catch (error) {
        console.error('Error sending signal to Hyperliquid API:', error.message);
        
        // Log detailed error information
        if (error.response) {
            console.error('API Error Response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        }
        
        // Return error object for handling by caller
        return {
            status: 'error',
            error: error.message,
            details: error.response?.data || null
        };
    }
}

/**
 * Validates signal data before sending to API
 * @param {Object} signalData - The signal data to validate
 * @returns {Object} - Validation result with isValid boolean and errors array
 */
function validateSignalData(signalData) {
    const errors = [];
    
    if (!signalData.signal) {
        errors.push('Signal type is required');
    }
    
    if (!signalData.tokenMentioned) {
        errors.push('Token mentioned is required');
    }
    
    if (!signalData.currentPrice || signalData.currentPrice <= 0) {
        errors.push('Valid current price is required');
    }
    
    if (!signalData.targets || signalData.targets.length === 0) {
        errors.push('At least one target price is required');
    }
    
    if (!signalData.stopLoss) {
        errors.push('Stop loss is required');
    }
    
    if (!signalData.maxExitTime) {
        errors.push('Max exit time is required');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Formats signal data for API consumption
 * @param {Object} rawSignalData - Raw signal data from the system
 * @returns {Object} - Formatted signal data ready for API
 */
function formatSignalData(rawSignalData) {
    return {
        signal: rawSignalData.signal,
        tokenMentioned: rawSignalData.tokenMentioned,
        targets: rawSignalData.targets || [],
        stopLoss: rawSignalData.stopLoss,
        currentPrice: rawSignalData.currentPrice,
        maxExitTime: rawSignalData.maxExitTime
    };
}

/**
 * Processes a signal and sends it to Hyperliquid API with validation
 * @param {Object} rawSignalData - Raw signal data
 * @returns {Promise<Object>} - Processing result
 */
async function processAndSendSignal(rawSignalData) {
    try {
        // Format the signal data
        const formattedData = formatSignalData(rawSignalData);
        
        // Validate the signal data
        const validation = validateSignalData(formattedData);
        if (!validation.isValid) {
            return {
                status: 'error',
                error: 'Signal validation failed',
                details: validation.errors
            };
        }
        
        // Send to API
        const result = await sendSignalToHyperliquidAPI(formattedData);
        return result;
        
    } catch (error) {
        console.error('Error processing and sending signal:', error);
        return {
            status: 'error',
            error: error.message
        };
    }
}

module.exports = {
    sendSignalToHyperliquidAPI,
    validateSignalData,
    formatSignalData,
    processAndSendSignal
}; 