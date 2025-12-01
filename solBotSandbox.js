// solBotSandbox.js
// One-trade-at-a-time sandbox bot using Dexscreener prices only.

const { ApifyClient } = require('apify-client');

// ===== CONFIG =====
const APIFY_TOKEN = 'YOUR_KEY_HERE';

const CHAIN = 'solana';
const INVEST_USD = 500;            // pretend to invest $500
const TARGET_PROFIT = 20;          // take profit when we're up $20
const MAX_PAIR_AGE_HOURS = 1;      // consider pairs up to 1 hour old

const NEW_PAIR_POLL_MS = 60000;    // how often to look for a new pair (ms)
const PRICE_POLL_MS = 10000;       // how often to refresh value for the open trade (ms)
// ===================

const client = new ApifyClient({ token: APIFY_TOKEN });

// tracks all pair addresses we've ever seen (so we don't treat old ones as new)
const seenPairs = new Set();

// single current paper trade
let currentTrade = null;

// stats
let totalProfit = 0;
let tradeCount = 0;

// ---- Helper: fetch basic info from Dexscreener (tries /pairs THEN /tokens) ----
async function fetchPairInfo(pairAddress) {
  async function fetchFrom(kind) {
    const url = `https://api.dexscreener.com/latest/dex/${kind}/${CHAIN}/${pairAddress}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`${kind} HTTP ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (!data.pairs || data.pairs.length === 0) {
      throw new Error(`${kind} returned zero pairs`);
    }
    return data.pairs[0];
  }

  let pair;
  try {
    // primary: try as a "pair id"
    pair = await fetchFrom('pairs');
  } catch (errPairs) {
    console.warn(
      `Dexscreener /pairs lookup failed for ${pairAddress}: ${errPairs.message}. Trying /tokens...`,
        );
    // fallback: treat it as a token address
    pair = await fetchFrom('tokens'); // let this throw if it also fails
  }

  const price = parseFloat(pair.priceUsd);
  if (!Number.isFinite(price)) {
    throw new Error('Invalid priceUsd: ' + pair.priceUsd);
  }

  const baseName = pair.baseToken.symbol || pair.baseToken.name;
  const quoteName = pair.quoteToken.symbol || pair.quoteToken.name;
  const name = `${baseName}/${quoteName}`;

  // Optional extra info (just for logging)
  let liquidityUsd = 0;
  if (pair.liquidity && pair.liquidity.usd != null) {
    liquidityUsd = Number(pair.liquidity.usd) || 0;
  }
  let vol24 = 0;
  if (pair.volume && pair.volume.h24 != null) {
    vol24 = Number(pair.volume.h24) || 0;
  } else if (pair.volume24hUsd != null) {
    vol24 = Number(pair.volume24hUsd) || 0;
  }

  return {
    priceUsd: price,
    name,
    liquidityUsd,
    volumeH24Usd: vol24,
  };
}

function hasOpenTrade() {
  return currentTrade && currentTrade.open;
}

// ---- Warm-up: mark existing pairs as seen so we don't open trade on old stuff ----
async function warmupSeenPairs() {
  const input = {
    chain: CHAIN,
    pageCount: 1,
    limit: 50,
    sortRank: 'pairAge',
    sortOrder: 'asc',
    maxAge: MAX_PAIR_AGE_HOURS,
  };

  const run = await client.actor('muhammetakkurtt/dexscreener-scraper').call(input);
  const result = await client.dataset(run.defaultDatasetId).listItems();
  const items = result.items || [];

  items.forEach((item) => {
    if (item.pairAddress) {
      seenPairs.add(item.pairAddress);
    }
  });

  console.log(
    `🔥 Warm-up: marked ${seenPairs.size} recent pairs as seen (no trade opened on them).`,
  );
}

// ---- Poll Apify for the single newest Solana pair and open a trade ----
async function pollForNewestPair() {
  if (hasOpenTrade()) {
    // We already have $500 "in play" on one coin.
    return;
  }

  const input = {
    chain: CHAIN,
    pageCount: 1,
    limit: 1,             // ONLY the newest pair
    sortRank: 'pairAge',  // "how new" the pair is
    sortOrder: 'asc',     // youngest first
    maxAge: MAX_PAIR_AGE_HOURS,
  };

  const run = await client.actor('muhammetakkurtt/dexscreener-scraper').call(input);
  const result = await client.dataset(run.defaultDatasetId).listItems();
  const items = result.items || [];
  if (items.length === 0) {
    console.log('No pairs returned from scraper this round.');
    return;
  }

  const item = items[0];
  const pairAddress = item.pairAddress;
  if (!pairAddress) return;

  // if we've seen this address before, it's not "new" for us
  if (seenPairs.has(pairAddress)) {
    return;
  }
  seenPairs.add(pairAddress);

  try {
    const info = await fetchPairInfo(pairAddress);
    const {
      priceUsd,
      name,
      liquidityUsd,
      volumeH24Usd,
    } = info;

    const coins = INVEST_USD / priceUsd;
    const targetValue = INVEST_USD + TARGET_PROFIT;

    tradeCount += 1;
    currentTrade = {
      pairAddress,
      name,
      entryPrice: priceUsd,
      coins,
      targetValue,
      open: true,
    };

    console.log('------------------------------------------------------------');
    console.log(`🚀 OPEN PAPER TRADE on ${name}`);
    console.log(`Pair addr:    ${pairAddress}`);
    console.log(`Entry price:  $${priceUsd.toFixed(8)} USD`);
    console.log(`Liquidity:    ~$${liquidityUsd.toFixed(2)}`);
    console.log(`24h volume:   ~$${volumeH24Usd.toFixed(2)}`);
    console.log(`Invest (sim): $${INVEST_USD.toFixed(2)}`);
    console.log(`Coins:        ${coins.toFixed(6)}`);
    console.log(`Target value: $${targetValue.toFixed(2)} (+$${TARGET_PROFIT.toFixed(2)})`);
    console.log('------------------------------------------------------------');
  } catch (err) {
    console.error('Error starting trade for new pair:', err.message || err);
  }
}

// ---- Periodically update the single open trade (Dex price only) ----
async function updateTrade() {
  if (!hasOpenTrade()) return;

  const now = new Date().toISOString();
  const t = currentTrade;

  try {
    // Use Dexscreener mid-price as approximation (again via pairs/tokens helper)
    const info = await fetchPairInfo(t.pairAddress);
    const priceUsd = info.priceUsd;
    const value = priceUsd * t.coins;

    const profit = value - INVEST_USD;
    const pct = (profit / INVEST_USD) * 100;

    console.log(
      `[${now}] ${t.name} (${t.pairAddress.slice(0, 6)}...) ` +
        `price=$${priceUsd.toFixed(8)} | value≈$${value.toFixed(
          2,
        )} ` +
        `P/L=$${profit.toFixed(2)} (${pct.toFixed(2)}%) [Dexscreener]`,
    );

    if (profit >= TARGET_PROFIT) {
      t.open = false;
      totalProfit += profit;

      console.log('🎯 TAKE PROFIT HIT!');
      console.log(
        `   ${t.name} reached value $${value.toFixed(
          2,
        )} (+$${profit.toFixed(2)}). Paper trade closed.`,
      );
      console.log(
        `💰 Realized profit so far: $${totalProfit.toFixed(2)} across ${tradeCount} trades.`,
      );
      console.log('💵 $500 is free again. Waiting for the next brand-new pair...');
    }
  } catch (err) {
    console.error('Error updating trade (Dexscreener):', err.message || err);
  }
}

// ---- Main ----
async function main() {
  if (!APIFY_TOKEN || APIFY_TOKEN === 'apify_api_YOUR_REAL_TOKEN_HERE') {
    console.error('❌ Set your real Apify token in APIFY_TOKEN before running this script.');
    process.exit(1);
    }

  console.log('👀 SolBot sandbox starting (ONE trade at a time, Dexscreener-based value)...');
  console.log(`   Paper-investing $${INVEST_USD} in the newest Solana pair only.`);
  console.log(`   Take profit: +$${TARGET_PROFIT}.`);
  console.log(`   New pair poll: every ${NEW_PAIR_POLL_MS / 1000}s`);
  console.log(`   Price/value update (Dexscreener): every ${PRICE_POLL_MS / 1000}s\n`);

  await warmupSeenPairs();

  // TEST MODE: open a trade on the current newest pair immediately
  seenPairs.clear();
  console.log(
    '🧪 Test mode: clearing warm-up and opening a trade on the current newest pair...',
  );
  await pollForNewestPair();

  // Look for newest pair periodically (after current trade closes)
  setInterval(() => {
    pollForNewestPair().catch((err) => {
      console.error('pollForNewestPair error:', err.message || err);
    });
  }, NEW_PAIR_POLL_MS);

  // Update the single open trade periodically (Dexscreener prices)
  setInterval(() => {
    updateTrade().catch((err) => {
      console.error('updateTrade error:', err.message || err);
    });
  }, PRICE_POLL_MS);
}

main().catch((err) => {
  console.error('Fatal error in main:', err.message || err);
  process.exit(1);
});





