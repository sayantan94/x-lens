# Kalshi Setup Guide

## What is Kalshi?
The only CFTC-regulated prediction market exchange in the US. Trades binary YES/NO event contracts on politics, economics, crypto, weather, and more.

## Account Setup
1. Sign up at https://kalshi.com
2. Complete identity verification (required, CFTC-regulated)
3. Fund account via bank transfer or wire

## API Access
1. Navigate to Settings > API
2. Generate API key pair (key ID + private key)
3. Store credentials securely

## Configuration
Add to `.env`:
```
KALSHI_API_KEY=your-key-id
KALSHI_API_SECRET=your-private-key
```

## API Base URL
- Production: `https://trading-api.kalshi.com/trade-api/v2`
- Demo: `https://demo-api.kalshi.com/trade-api/v2`

## Key Endpoints
- `GET /events` — List events
- `GET /events/{event_ticker}` — Event details
- `GET /markets` — List markets
- `GET /markets/{ticker}` — Market details
- `POST /portfolio/orders` — Place order
- `GET /portfolio/positions` — View positions
- `GET /portfolio/balance` — Check balance

## Fees
- Varies by contract type
- Generally 1-7% on winning contracts
- No fees on losing contracts

## Key Differences from Polymarket
- US-regulated (legal for US users)
- USD deposits (not crypto)
- Different event selection
- Generally lower liquidity than Polymarket
- Different resolution criteria (even for "same" events)
