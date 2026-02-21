
# FitMunch Payment Setup Guide

## Setting Up Payments

To receive payments from FitMunch subscribers, follow these steps:

1. **Create a Stripe Account**
   - Sign up at [stripe.com](https://stripe.com)
   - Complete the verification process
   - Add your banking details to receive payouts

2. **Get Your API Keys**
   - Go to the Stripe Dashboard → Developers → API keys
   - Copy your Publishable Key and Secret Key

3. **Update the FitMunch Code**
   - Replace the placeholder keys in `payment-gateway.js` with your actual Stripe keys
   - Test the integration in Stripe's test mode before going live

4. **Configure Webhooks**
   - Create a webhook endpoint in your Stripe Dashboard
   - Point it to your deployed FitMunch app URL + `/api/stripe-webhook`
   - This allows real-time subscription updates

5. **Set Payout Schedule**
   - Configure how often you want to receive payments in your Stripe Dashboard
   - Default is typically every 2 business days

6. **Go Live**
   - Switch from Stripe test mode to live mode in your Stripe Dashboard
   - Update your API keys to the live versions

## Payment Methods Accepted

Users can pay via:
- Credit Cards (Visa, Mastercard, American Express, etc.)
- Apple Pay and Google Pay (requires additional configuration)
- ACH and SEPA direct debits (for US and EU customers, requires additional setup)

## Subscription Management

The FitMunch app allows users to:
- Subscribe to monthly or annual plans
- Apply promo codes for discounts
- Update their payment methods
- Cancel subscriptions at any time

Your Stripe Dashboard gives you complete visibility into active subscriptions, revenue, and churn metrics.
