const { getDb } = require('../db/connection');
const { OpenAI } = require('openai');
const { openAIConfig } = require('../config/config');

class SignalQAService {
    constructor() {
        this.db = null;
        this.qaCollection = 'signal_qa_review';
        this.openai = new OpenAI({ apiKey: openAIConfig.apiKey });
    }

    async initialize() {
        this.db = await getDb();
    }

    async inspectSignal(signal) {
        try {
            if (!this.db) {
                await this.initialize();
            }

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

            const analysis = JSON.parse(response.choices[0].message.content);

            // If there are issues, store in QA review collection
            if (!analysis.passed) {
                await this.db.collection(this.qaCollection).insertOne({
                    signal,
                    issues: analysis.issues,
                    timestamp: new Date(),
                    status: 'PENDING_REVIEW',
                    reviewedBy: null,
                    reviewNotes: null,
                    aiAnalysis: analysis
                });
            }

            return analysis;
        } catch (error) {
            console.error('Error in signal QA inspection:', error);
            // In case of OpenAI error, perform basic validation
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

    async getPendingReviews() {
        try {
            if (!this.db) {
                await this.initialize();
            }
            return await this.db.collection(this.qaCollection)
                .find({ status: 'PENDING_REVIEW' })
                .sort({ timestamp: -1 })
                .toArray();
        } catch (error) {
            console.error('Error fetching pending reviews:', error);
            throw error;
        }
    }

    async updateReviewStatus(reviewId, status, reviewedBy, notes) {
        try {
            if (!this.db) {
                await this.initialize();
            }
            await this.db.collection(this.qaCollection).updateOne(
                { _id: reviewId },
                {
                    $set: {
                        status,
                        reviewedBy,
                        reviewNotes: notes,
                        reviewedAt: new Date()
                    }
                }
            );
        } catch (error) {
            console.error('Error updating review status:', error);
            throw error;
        }
    }

    async getSignalAnalysis(signalId) {
        try {
            if (!this.db) {
                await this.initialize();
            }
            const review = await this.db.collection(this.qaCollection)
                .findOne({ 'signal._id': signalId });
            
            return review ? review.aiAnalysis : null;
        } catch (error) {
            console.error('Error getting signal analysis:', error);
            throw error;
        }
    }
}

module.exports = new SignalQAService(); 