const { getDb } = require('../db/connection');
const { OpenAI } = require('openai');
const axios = require('axios');
const { telegramConfig, openAIConfig } = require('../config/config');

class TelegramService {
    constructor() {
        this.db = null;
        this.signalsCollection = 'trading_signals';
        this.qaCollection = 'signal_qa_review';
        this.telegramApiUrl = telegramConfig.apiUrl;
        this.telegramBotToken = telegramConfig.botToken;
        this.openai = new OpenAI({ apiKey: openAIConfig.apiKey });
    }

    async initialize() {
        this.db = await getDb();
    }

    async processAndSendTradingSignalMessage() {
        try {
            if (!this.db) {
                await this.initialize();
            }

            // Get all pending signals
            const signals = await this.db.collection(this.signalsCollection)
                .find({ status: 'PENDING' })
                .sort({ timestamp: 1 })
                .toArray();

            for (const signal of signals) {
                try {
                    // Perform AI-powered QA inspection
                    const qaResult = await this.inspectSignal(signal);

                    if (qaResult.passed) {
                        // If QA passed, send the signal
                        const sendResult = await this.sendSignal(signal);
                        
                        if (sendResult.success) {
                            // Update signal status to SENT
                            await this.db.collection(this.signalsCollection).updateOne(
                                { _id: signal._id },
                                { 
                                    $set: { 
                                        status: 'SENT',
                                        sentAt: new Date(),
                                        messageId: sendResult.messageId,
                                        qaAnalysis: qaResult
                                    }
                                }
                            );
                            console.log(`Signal ${signal._id} sent successfully`);
                        } else {
                            // Update signal status to SEND_FAILED
                            await this.db.collection(this.signalsCollection).updateOne(
                                { _id: signal._id },
                                { 
                                    $set: { 
                                        status: 'SEND_FAILED',
                                        error: sendResult.error,
                                        lastAttempt: new Date(),
                                        qaAnalysis: qaResult
                                    }
                                }
                            );
                            console.error(`Failed to send signal ${signal._id}:`, sendResult.error);
                        }
                    } else {
                        // If QA failed, store in QA review collection
                        await this.db.collection(this.qaCollection).insertOne({
                            signal,
                            issues: qaResult.issues,
                            timestamp: new Date(),
                            status: 'PENDING_REVIEW',
                            reviewedBy: null,
                            reviewNotes: null,
                            aiAnalysis: qaResult
                        });

                        // Update signal status to NEEDS_REVIEW
                        await this.db.collection(this.signalsCollection).updateOne(
                            { _id: signal._id },
                            { 
                                $set: { 
                                    status: 'NEEDS_REVIEW',
                                    qaIssues: qaResult.issues,
                                    lastUpdated: new Date(),
                                    qaAnalysis: qaResult
                                }
                            }
                        );

                        console.log('Signal failed QA inspection:', {
                            signalId: signal._id,
                            issues: qaResult.issues
                        });
                    }
                } catch (error) {
                    console.error(`Error processing signal ${signal._id}:`, error);
                    // Update signal status to ERROR
                    await this.db.collection(this.signalsCollection).updateOne(
                        { _id: signal._id },
                        { 
                            $set: { 
                                status: 'ERROR',
                                error: error.message,
                                lastUpdated: new Date()
                            }
                        }
                    );
                }
            }
        } catch (error) {
            console.error('Error in processAndSendTradingSignalMessage:', error);
            throw error;
        }
    }

    async inspectSignal(signal) {
        try {
            const systemPrompt = `You are an expert crypto trading signal analyst. Your task is to analyze trading signals for potential issues and inconsistencies.

Please check the following aspects:
1. Price levels (Entry, TP1, TP2, SL) for logical consistency
2. Signal parameters for completeness and validity
3. Trading tips for clarity and relevance
4. Overall signal quality and reliability

Respond in strict JSON format with the following structure:
{
    "passed": boolean,
    "issues": [
        {
            "type": string,
            "message": string,
            "severity": "HIGH" | "MEDIUM" | "LOW",
            "suggestion": string
        }
    ]
}`;

            const userPrompt = `Analyze this trading signal:

Coin: ${signal.coin}
Type: ${signal.type}
Entry: ${signal.entry}
TP1: ${signal.tp1}
TP2: ${signal.tp2}
SL: ${signal.sl}
Tip: ${signal.tip || 'No tip provided'}
Timestamp: ${new Date(signal.timestamp).toISOString()}

Please provide a detailed analysis of any issues found.`;

            const response = await this.openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user",
                        content: userPrompt
                    }
                ],
                response_format: { type: "json_object" }
            });

            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            console.error('Error in AI signal inspection:', error);
            // Fallback to basic validation if AI fails
            return this.performBasicValidation(signal);
        }
    }

    performBasicValidation(signal) {
        const issues = [];
        
        // Basic price level validation
        if (signal.tp1 && signal.tp2 && parseFloat(signal.tp1) <= parseFloat(signal.tp2)) {
            issues.push({
                type: 'INVALID_TP_ORDER',
                message: 'TP1 should be greater than TP2',
                severity: 'HIGH',
                suggestion: 'Review and correct the take profit levels'
            });
        }

        if (signal.sl && signal.tp1 && parseFloat(signal.tp1) <= parseFloat(signal.sl)) {
            issues.push({
                type: 'INVALID_TP1_SL',
                message: 'TP1 should be greater than SL',
                severity: 'HIGH',
                suggestion: 'Review and correct the take profit and stop loss levels'
            });
        }

        return {
            passed: issues.length === 0,
            issues
        };
    }

    async sendSignal(signal) {
        try {
            // Format the signal message
            const message = this.formatSignalMessage(signal);
            
            // Send to Telegram
            const response = await axios.post(
                `${this.telegramApiUrl}/bot${this.telegramBotToken}/sendMessage`,
                {
                    chat_id: signal.chatId,
                    text: message,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                }
            );

            if (response.data.ok) {
                return {
                    success: true,
                    messageId: response.data.result.message_id
                };
            } else {
                return {
                    success: false,
                    error: response.data.description
                };
            }
        } catch (error) {
            console.error('Error sending signal to Telegram:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    formatSignalMessage(signal) {
        const formatNumber = (num) => {
            if (!num) return 'N/A';
            return parseFloat(num).toFixed(2);
        };

        return `<b>🔔 New Trading Signal 🔔</b>

<b>Coin:</b> ${signal.coin}
<b>Type:</b> ${signal.type}
<b>Entry:</b> ${formatNumber(signal.entry)}
<b>TP1:</b> ${formatNumber(signal.tp1)}
<b>TP2:</b> ${formatNumber(signal.tp2)}
<b>SL:</b> ${formatNumber(signal.sl)}

${signal.tip ? `<i>${signal.tip}</i>` : ''}

<code>Signal ID: ${signal._id}</code>
<code>Time: ${new Date(signal.timestamp).toLocaleString()}</code>`;
    }

    async retryFailedSignals() {
        try {
            if (!this.db) {
                await this.initialize();
            }

            // Get all failed signals from the last 24 hours
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const failedSignals = await this.db.collection(this.signalsCollection)
                .find({
                    status: { $in: ['SEND_FAILED', 'ERROR'] },
                    lastUpdated: { $gte: oneDayAgo }
                })
                .toArray();

            for (const signal of failedSignals) {
                await this.processAndSendTradingSignalMessage(signal);
            }
        } catch (error) {
            console.error('Error retrying failed signals:', error);
            throw error;
        }
    }

    async getSignalStatus(signalId) {
        try {
            if (!this.db) {
                await this.initialize();
            }

            const signal = await this.db.collection(this.signalsCollection)
                .findOne({ _id: signalId });

            if (!signal) {
                throw new Error('Signal not found');
            }

            return {
                status: signal.status,
                timestamp: signal.timestamp,
                lastUpdated: signal.lastUpdated,
                error: signal.error,
                qaIssues: signal.qaIssues,
                qaAnalysis: signal.qaAnalysis
            };
        } catch (error) {
            console.error('Error getting signal status:', error);
            throw error;
        }
    }
}

module.exports = new TelegramService();