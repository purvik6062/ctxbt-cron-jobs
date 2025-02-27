# API Cron Job

This project is a modular Node.js application that uses cron jobs to manage two primary tasks:

1. **Active Subscription Updater:**  
   Reads active subscriptions from the `user-data` collection and updates the `influencer-data` collection with the current list of active subscribers for each Twitter handle.

2. **Tweets Processing Job:**  
   Scrapes new tweets for each Twitter handle (influencer), filters them for actionable trading signals using the OpenAI API, and stores new tweets in the `influencer-data` collection. Duplicate processing is prevented via a persistent `processedTweetIds` array.
