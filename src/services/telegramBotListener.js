const axios = require('axios');
const { connect, closeConnection } = require('../db');
const { dbName } = require('../config/config');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const WELCOME_MESSAGE = `Welcome to Maxxit AI 🎉

We're excited to have you join our community of traders. Here's what you can expect:

📈 Real-time trading signals from top influencers
💰 Proven strategies with track records
🔔 Instant notifications for new opportunities
📊 Performance analytics and insights

To get started, make sure you're subscribed to our premium signals service. 

Happy trading! 💪`;

class TelegramBotListener {
    constructor() {
        this.isListening = false;
        this.lastUpdateId = 0;
        this.welcomedUsers = new Set();
        this.pollInterval = 2000; // Poll every 2 seconds
        this.initializeWelcomedUsers();
    }

    async initializeWelcomedUsers() {
        try {
            const client = await connect();
            const db = client.db(dbName);
            const welcomedUsersCollection = db.collection('welcomed_users');
            
            const welcomedUsersData = await welcomedUsersCollection.find({}).toArray();
            welcomedUsersData.forEach(user => {
                this.welcomedUsers.add(user.user_id.toString());
            });
            
            await closeConnection(client);
            console.log(`Loaded ${this.welcomedUsers.size} previously welcomed users`);
        } catch (error) {
            console.error('Error initializing welcomed users:', error);
        }
    }

    async markUserAsWelcomed(userId, username) {
        try {
            const client = await connect();
            const db = client.db(dbName);
            const welcomedUsersCollection = db.collection('welcomed_users');
            
            await welcomedUsersCollection.updateOne(
                { user_id: userId },
                { 
                    $set: { 
                        user_id: userId,
                        username: username,
                        welcomed_at: new Date()
                    }
                },
                { upsert: true }
            );
            
            this.welcomedUsers.add(userId.toString());
            await closeConnection(client);
        } catch (error) {
            console.error('Error marking user as welcomed:', error);
        }
    }

    async sendWelcomeMessage(userId, firstName) {
        try {
            const personalizedMessage = `Hey ${firstName}!\n${WELCOME_MESSAGE}`;
            
            const response = await axios.post(`${TELEGRAM_API_BASE_URL}/sendMessage`, {
                chat_id: userId,
                text: personalizedMessage,
                parse_mode: 'HTML'
            });

            if (response.data.ok) {
                console.log(`Welcome message sent successfully to user ${userId} (${firstName})`);
                return true;
            } else {
                console.error('Failed to send welcome message:', response.data);
                return false;
            }
        } catch (error) {
            console.error(`Error sending welcome message to user ${userId}:`, error.message);
            return false;
        }
    }

    async getUpdates() {
        try {
            const response = await axios.get(`${TELEGRAM_API_BASE_URL}/getUpdates`, {
                params: {
                    offset: this.lastUpdateId + 1,
                    timeout: 30
                }
            });

            if (response.data.ok) {
                return response.data.result;
            } else {
                console.error('Error getting updates:', response.data);
                return [];
            }
        } catch (error) {
            console.error('Error fetching Telegram updates:', error.message);
            return [];
        }
    }

    async processMessage(message) {
        const userId = message.from.id;
        const firstName = message.from.first_name || 'there';
        const username = message.from.username || null;

        // Check if user has already been welcomed
        if (this.welcomedUsers.has(userId.toString())) {
            console.log(`User ${userId} (${firstName}) already welcomed, skipping.`);
            return;
        }

        console.log(`New user detected: ${userId} (${firstName}), sending welcome message...`);
        
        const messageSent = await this.sendWelcomeMessage(userId, firstName);
        if (messageSent) {
            await this.markUserAsWelcomed(userId, username);
        }
    }

    async startListening() {
        if (this.isListening) {
            console.log('Telegram bot listener is already running');
            return;
        }

        if (!TELEGRAM_BOT_TOKEN) {
            console.error('TELEGRAM_BOT_TOKEN environment variable is not set');
            return;
        }

        this.isListening = true;
        console.log('Starting Telegram bot listener...');

        while (this.isListening) {
            try {
                const updates = await this.getUpdates();
                
                for (const update of updates) {
                    this.lastUpdateId = update.update_id;
                    
                    if (update.message && update.message.from) {
                        await this.processMessage(update.message);
                    }
                }

                // Short delay before next poll
                await new Promise(resolve => setTimeout(resolve, this.pollInterval));
            } catch (error) {
                console.error('Error in Telegram bot listener loop:', error);
                // Wait longer before retrying on error
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    stopListening() {
        this.isListening = false;
        console.log('Stopping Telegram bot listener...');
    }
}

const telegramBotListener = new TelegramBotListener();

module.exports = { telegramBotListener }; 