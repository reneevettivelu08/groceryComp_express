const express = require('express');
const router  = express.Router();
const { getProduct, getProducts, BANNERS } = require('../scrapers/loblaw');
const cache   = require('../cache');
const fs      = require('fs');
const path    = require('path');

// -----------------------------------------------
// Product code store — persisted to a JSON file
// Maps a friendly item name → product code(s)
//
// Example:
// {
//   "bananas": ["20175355001_KG"],
//   "avocado": ["21066_EA"],
//   "apples":  ["20822174_EA", "21235627_EA"]
// }
// -----------------------------------------------
const CODES_FILE = path.join(__dirname, '..', 'productCodes.json');

function loadCodes() {
  try {
    if (fs.existsSync(CODES_FILE)) {
      return JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('Could not load productCodes.json:', e.message);
  }
  return {};
}

function saveCodes(codes) {
  try {
    fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2));
  } catch (e) {
    console.warn('Could not save productCodes.json:', e.message);
  }
}

let productCodes = loadCodes();

// -----------------------------------------------
// GET /api/loblaw/product/:code
// Fetch a single product by its PC Express code
// e.g. GET /api/loblaw/product/20175355001_KG?banner=nofrills
// -----------------------------------------------
router.get('/product/:code', async (req, res) => {
  const { code }                    = req.params;
  const { banner = 'nofrills', storeId } = req.query;

  if (!BANNERS[banner]) {
    return res.status(400).json({ error: `Invalid banner. Use: ${Object.keys(BANNERS).join(', ')}` });
  }

  const cacheKey = `product:${banner}:${storeId || 'default'}:${code}`;
  const cached   = cache.get(cacheKey);
  if (cached) {
    console.log(`✓ Cache hit: ${cacheKey}`);
    return res.json({ product: cached, fromCache: true });
  }

  try {
    const product = await getProduct(code, banner, storeId);
    cache.set(cacheKey, product);
    res.json({ product, fromCache: false });
  } catch (err) {
    console.error('Product fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch product', detail: err.message });
  }
});

// -----------------------------------------------
// GET /api/loblaw/search?term=bananas&banner=nofrills
// Looks up stored product codes for a term and fetches them.
// Falls back to a helpful error if no codes are stored yet.
// -----------------------------------------------
router.get('/search', async (req, res) => {
  const { term, banner = 'nofrills', storeId } = req.query;

  if (!term) {
    return res.status(400).json({ error: 'term is required' });
  }

  if (!BANNERS[banner]) {
    return res.status(400).json({ error: `Invalid banner. Use: ${Object.keys(BANNERS).join(', ')}` });
  }

  const normalizedTerm = term.toLowerCase().trim();

  // Check if we have stored codes for this term
  // Try exact match first, then partial match
  let codes = productCodes[normalizedTerm];

  if (!codes || codes.length === 0) {
    // Try partial match — "fresh kale slaw" might match stored key "kale"
    const partialKey = Object.keys(productCodes).find(
      (key) => normalizedTerm.includes(key) || key.includes(normalizedTerm)
    );
    if (partialKey) {
      codes = productCodes[partialKey];
      console.log(`Partial match: "${normalizedTerm}" → "${partialKey}"`);
    }
  }

  if (!codes || codes.length === 0) {
    return res.status(404).json({
      error:   'No product codes found for this item',
      detail:  `No codes stored for "${term}". Use POST /api/loblaw/codes to add them.`,
      howTo:   'Find the product on nofrills.ca, copy the code from the URL (e.g. /p/20175355001_KG), then POST to /api/loblaw/codes',
      term:    normalizedTerm,
    });
  }

  const cacheKey = `search:${banner}:${storeId || 'default'}:${normalizedTerm}`;
  const cached = cache.get(cacheKey);
  // Only serve from cache if it actually has results — never cache empty arrays
  if (cached && cached.length > 0) {
    return res.json({ results: cached, fromCache: true });
  }

  try {
    const results = await getProducts(codes, banner, storeId);
    // Only cache if we got actual results — prevents stale empty arrays
    if (results.length > 0) {
      cache.set(cacheKey, results);
    }
    res.json({ results, fromCache: false });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Failed to fetch search results', detail: err.message });
  }
});

// -----------------------------------------------
// GET /api/loblaw/codes
// Returns all stored product codes
// -----------------------------------------------
router.get('/codes', (req, res) => {
  res.json({ codes: productCodes });
});

// -----------------------------------------------
// POST /api/loblaw/codes
// Add or update product codes for a term
// Body: { "term": "bananas", "codes": ["20175355001_KG"] }
// -----------------------------------------------
router.post('/codes', (req, res) => {
  const { term, codes } = req.body;

  if (!term || !Array.isArray(codes) || codes.length === 0) {
    return res.status(400).json({ error: 'Body must be: { term: string, codes: string[] }' });
  }

  const key = term.toLowerCase().trim();
  productCodes[key] = codes;
  saveCodes(productCodes);

  console.log(`Saved codes for "${key}":`, codes);
  res.json({ message: `Saved ${codes.length} code(s) for "${key}"`, codes: productCodes[key] });
});

// -----------------------------------------------
// DELETE /api/loblaw/codes/:term
// Remove codes for a term
// -----------------------------------------------
router.delete('/codes/:term', (req, res) => {
  const key = req.params.term.toLowerCase().trim();
  if (productCodes[key]) {
    delete productCodes[key];
    saveCodes(productCodes);
    res.json({ message: `Deleted codes for "${key}"` });
  } else {
    res.status(404).json({ error: `No codes found for "${key}"` });
  }
});

// -----------------------------------------------
// GET /api/loblaw/stores
// -----------------------------------------------
router.get('/stores', (req, res) => {
  res.json({
    stores: Object.entries(BANNERS).map(([key, config]) => ({
      key,
      banner:         config.banner,
      defaultStoreId: config.defaultStoreId,
      url:            config.origin,
    })),
  });
});

// -----------------------------------------------
// DELETE /api/loblaw/cache
// -----------------------------------------------
router.delete('/cache', (req, res) => {
  cache.clear();
  res.json({ message: 'Cache cleared' });
});

module.exports = router;