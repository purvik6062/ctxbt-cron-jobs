# API Cron Job

This project is a modular Node.js application that uses cron jobs to manage multiple automated tasks and includes a Telegram bot service:

## Core Features

1. **Active Subscription Updater:**  
   Reads active subscriptions from the `user-data` collection and updates the `influencer-data` collection with the current list of active subscribers for each Twitter handle.

2. **Tweets Processing Job:**  
   Scrapes new tweets for each Twitter handle (influencer), filters them for actionable trading signals using the OpenAI API, and stores new tweets in the `influencer-data` collection. Duplicate processing is prevented via a persistent `processedTweetIds` array.

3. **Telegram Bot Listener:**  
   Continuously listens for incoming messages on the configured Telegram bot and automatically sends welcome messages to new users. The service tracks welcomed users in the database to prevent duplicate messages.

## Environment Variables

Make sure to set the following environment variables in your `.env` file:

- `TELEGRAM_BOT_TOKEN` - Your Telegram Bot API token
- `MONGODB_URI` - Your MongoDB connection string
- `OPENAI_API_KEY` - Your OpenAI API key
- `PERPLEXITY_API_KEY` - Your Perplexity API key
- `TWEETSCOUT_API_KEY` - Your TweetScout API key

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/purvik6062/ctxbt-cron-jobs)
