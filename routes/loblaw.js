const express = require('express');
const router = express.Router();
const { searchProducts, getProduct, BANNERS } = require('../scrapers/loblaw');
const cache = require('../cache');

// -----------------------------------------------
// GET /api/loblaw/search
// Query params:
//   term     (required) — e.g. "avocado"
//   banner   (optional) — nofrills | loblaws | superstore  (default: nofrills)
//   storeId  (optional) — override default store ID
//
// Example: GET /api/loblaw/search?term=avocado&banner=nofrills
// -----------------------------------------------
router.get('/search', async (req, res) => {
  const { term, banner = 'nofrills', storeId } = req.query;

  if (!term || term.trim().length < 2) {
    return res.status(400).json({ error: 'term is required (min 2 characters)' });
  }

  if (!BANNERS[banner]) {
    return res.status(400).json({
      error: `Invalid banner. Must be one of: ${Object.keys(BANNERS).join(', ')}`
    });
  }

  const cacheKey = `search:${banner}:${storeId || 'default'}:${term.toLowerCase().trim()}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`✓ Cache hit: ${cacheKey}`);
    return res.json({ results: cached, fromCache: true });
  }

  try {
    console.log(`🔍 Searching [${banner}] for "${term}"...`);
    const results = await searchProducts(term.trim(), banner, storeId);
    cache.set(cacheKey, results);
    res.json({ results, fromCache: false });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Failed to fetch search results', detail: err.message });
  }
});

// -----------------------------------------------
// GET /api/loblaw/product/:code
// Path params:
//   code     (required) — e.g. "20175355001_KG"
// Query params:
//   banner   (optional) — default: nofrills
//   storeId  (optional)
//
// Example: GET /api/loblaw/product/20175355001_KG?banner=nofrills
// -----------------------------------------------
router.get('/product/:code', async (req, res) => {
  const { code } = req.params;
  const { banner = 'nofrills', storeId } = req.query;

  if (!BANNERS[banner]) {
    return res.status(400).json({
      error: `Invalid banner. Must be one of: ${Object.keys(BANNERS).join(', ')}`
    });
  }

  const cacheKey = `product:${banner}:${storeId || 'default'}:${code}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`✓ Cache hit: ${cacheKey}`);
    return res.json({ product: cached, fromCache: true });
  }

  try {
    console.log(`📦 Fetching product [${banner}] ${code}...`);
    const product = await getProduct(code, banner, storeId);
    cache.set(cacheKey, product);
    res.json({ product, fromCache: false });
  } catch (err) {
    console.error('Product fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch product', detail: err.message });
  }
});

// -----------------------------------------------
// GET /api/loblaw/stores
// Returns the configured store IDs for reference
// -----------------------------------------------
router.get('/stores', (req, res) => {
  res.json({
    stores: Object.entries(BANNERS).map(([key, config]) => ({
      key,
      banner: config.banner,
      defaultStoreId: config.defaultStoreId,
      url: config.origin,
    }))
  });
});

// -----------------------------------------------
// GET /api/loblaw/cache/status
// Dev utility — see what's cached
// -----------------------------------------------
router.get('/cache/status', (req, res) => {
  res.json({ cachedEntries: cache.size() });
});

// DELETE /api/loblaw/cache
router.delete('/cache', (req, res) => {
  cache.clear();
  res.json({ message: 'Cache cleared' });
});

module.exports = router;