// watchNewPairs.js
// Simple "new pairs watcher" for Dexscreener via Apify DexScreener Scraper

const { ApifyClient } = require('apify-client');

// TODO: put your real Apify API token here
const APIFY_TOKEN = 'YOUR_APIFY_TOKEN_HERE';

// How often to poll (milliseconds)
const POLL_INTERVAL_MS = 30_000; // 30 seconds

// How "new" a pair can be to be considered (in hours)
// 0.03 ≈ 1.8 minutes; 0.05 ≈ 3 minutes
const MAX_PAIR_AGE_HOURS = 0.05;

const client = new ApifyClient({ token: APIFY_TOKEN });

// Keep track of what we've already seen this session
const seenPairs = new Set();

async function pollNewPairs() {
  const input = {
    chain: 'solana',          // only Solana
    pageCount: 1,             // first page is enough for newest pairs
    limit: 50,                // up to 50 results per run
    sortRank: 'pairAge',      // sort by how new the pair is
    sortOrder: 'asc',         // youngest (newest) first
    maxAge: MAX_PAIR_AGE_HOURS,
    // you can also add filters like minLiq, min24HVol, etc. later
  };

  // Run the DexScreener scraper actor
  const run = await client.actor('muhammetakkurtt/dexscreener-scraper').call(input);

  // Get scraped items from the run's dataset
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const now = new Date().toISOString();

  for (const item of items) {
    const pairAddress = item.pairAddress;
    if (!pairAddress) continue;

    // Only show each pair once per script run (no spam)
    if (seenPairs.has(pairAddress)) continue;
    seenPairs.add(pairAddress);

    const baseSymbol =
      (item.baseToken && (item.baseToken.symbol || item.baseToken.name)) || 'UNKNOWN';
    const quoteSymbol =
      (item.quoteToken && (item.quoteToken.symbol || item.quoteToken.name)) || 'UNKNOWN';

    const liqUsd = item.liquidity && item.liquidity.usd;

    console.log('------------------------------------------------------------');
    console.log(`[${now}] NEW SOLANA PAIR DETECTED ON DEXSCREENER`);
    console.log(`Pair:       ${baseSymbol} / ${quoteSymbol}`);
    console.log(`Pair addr:  ${pairAddress}`);
    console.log(`DEX:        ${item.dexId}`);
    console.log(`Liquidity:  ${liqUsd != null ? `$${liqUsd.toLocaleString()}` : 'n/a'}`);
    console.log(`URL:        ${item.url}`);
  }
}

async function main() {
  if (!APIFY_TOKEN || APIFY_TOKEN === 'YOUR_APIFY_TOKEN_HERE') {
    console.error('❌ Set your Apify token in APIFY_TOKEN before running this script.');
    process.exit(1);
  }

  console.log('👀 Watching for NEW Solana pairs on Dexscreener (via Apify)...');
  console.log(
    `   Polling every ${(POLL_INTERVAL_MS / 1000).toFixed(
      0,
    )}s, max pair age ~${MAX_PAIR_AGE_HOURS} hours.`,
  );

  // Simple infinite loop with delay
  // (Ctrl+C to stop the script)
  while (true) {
    try {
      await pollNewPairs();
    } catch (err) {
      console.error('Error while polling new pairs:', err?.message || err);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('Fatal error:', err?.message || err);
  process.exit(1);
});
