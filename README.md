# SolBot MK1 Sandbox

Simple Solana meme-coin sandbox bot that:

- Uses the Apify **Dexscreener Scraper** actor to find the newest Solana pairs.
- Paper-invests **$500** into the newest pair.
- Tracks the position value using Dexscreener `priceUsd`.
- Takes profit when the value reaches **$500 + $20**.
- Only holds **one trade at a time**.

- Not real $

---

## Requirements

- Node.js (v18+ recommended)
- An Apify account + **API token** (for the Dexscreener actor)

---

## Setup

1. **Clone the repo**

   ```bash
   git clone https://github.com/<your-username>/<your-repo>.git
   cd <your-repo>
