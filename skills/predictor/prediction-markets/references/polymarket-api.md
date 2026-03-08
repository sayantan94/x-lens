# Polymarket API Reference

## Base URLs
- CLOB API: `https://clob.polymarket.com`
- Gamma API: `https://gamma-api.polymarket.com`
- WebSocket: `wss://ws-subscriptions-clob.polymarket.com/ws/`

## Public Endpoints (No Auth Required)

### Markets
- `GET /markets` — List all markets
- `GET /markets/{condition_id}` — Get specific market
- `GET /book` — Order book for a market
- `GET /price` — Current price
- `GET /midpoint` — Mid price between bid/ask

## Data Structure

- **Conditions**: Overarching events (e.g., "Will BTC hit $150K?")
- **Markets**: Tradeable YES/NO outcome tokens within a condition
- **Tokens**: ERC-1155 tokens on Polygon, each with unique ID

## Order Types
- **GTC** (Good-Til-Cancelled): Stays open until filled or cancelled
- **GTD** (Good-Til-Date): Expires at specified time
- **FOK** (Fill-Or-Kill): Must fill entirely or cancel

## Fees
- Maker: ~0%
- Taker: ~1-2%

## Key Mechanics
- YES + NO tokens always = $1.00 USDC
- Prices range $0.00 to $1.00
- Price = implied probability (e.g., $0.65 YES = 65% implied probability)
- Settlement: USDC on Polygon (bridged to Solana via Sol CLI)

## Authentication
For write operations (placing orders):
- EIP-712 signatures
- Headers: wallet address, signature, timestamp, nonce

## Categories
crypto, sports, politics, esports, culture, economics, tech, finance, climate, science
