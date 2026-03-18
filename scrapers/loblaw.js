const puppeteer = require('puppeteer');

// -----------------------------------------------
// Banner config — maps store name → URLs + IDs
// -----------------------------------------------
const BANNERS = {
  nofrills: {
    banner: 'nofrills',
    origin: 'https://www.nofrills.ca',
    searchUrl: (term) => `https://www.nofrills.ca/search?search-bar=${encodeURIComponent(term)}`,
    defaultStoreId: process.env.NOFRILLS_STORE_ID || '3643',
  },
  loblaws: {
    banner: 'loblaw',
    origin: 'https://www.loblaws.ca',
    searchUrl: (term) => `https://www.loblaws.ca/search?search-bar=${encodeURIComponent(term)}`,
    defaultStoreId: process.env.LOBLAWS_STORE_ID || '1038',
  },
  superstore: {
    banner: 'superstore',
    origin: 'https://www.realcanadiansuperstore.ca',
    searchUrl: (term) => `https://www.realcanadiansuperstore.ca/search?search-bar=${encodeURIComponent(term)}`,
    defaultStoreId: process.env.SUPERSTORE_STORE_ID || '1057',
  },
};

// -----------------------------------------------
// Headers that Akamai/PCExpress expects
// Mirrors exactly what Chrome sends from nofrills.ca
// -----------------------------------------------
function buildHeaders(banner, apiKey) {
  const config = BANNERS[banner];
  return {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en',
    'Business-User-Agent': 'PCXWEB',
    'Content-Type': 'application/json',
    'Origin': config.origin,
    'Origin_Session_Header': 'B',
    'Referer': `${config.origin}/`,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Storage-Access': 'active',
    'Site-Banner': config.banner,
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36',
    'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'x-apikey': apiKey || process.env.LOBLAW_API_KEY,
    'x-application-type': 'Web',
    'x-loblaw-tenant-id': 'ONLINE_GROCERIES',
  };
}

// -----------------------------------------------
// Get today's date in the format PCExpress expects: DDMMYYYY
// -----------------------------------------------
function getApiDate() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

// -----------------------------------------------
// Launch browser (singleton — reuse across requests)
// -----------------------------------------------
let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  const launchOptions = {
    // 'new' headless mode is faster locally but not supported on all Heroku Chrome builds
    headless: isProduction ? true : 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',        // Critical on Heroku — /dev/shm is too small
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',               // Required on some Heroku dynos
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--mute-audio',
    ],
  };

  // On Heroku, use the installed Chrome binary
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  browserInstance = await puppeteer.launch(launchOptions);
  console.log('🌐 Puppeteer browser launched');

  // Clean up on crash
  browserInstance.on('disconnected', () => {
    browserInstance = null;
    console.log('⚠️  Puppeteer browser disconnected — will relaunch on next request');
  });

  return browserInstance;
}

// -----------------------------------------------
// SEARCH: find products by term
// Returns array of normalized product results
// -----------------------------------------------
async function searchProducts(term, bannerKey = 'nofrills', storeId = null) {
  const config = BANNERS[bannerKey];
  if (!config) throw new Error(`Unknown banner: ${bannerKey}`);

  const resolvedStoreId = storeId || config.defaultStoreId;
  const apiKey = process.env.LOBLAW_API_KEY;
  const date = getApiDate();

  // Build the search API URL
  const searchApiUrl = `https://api.pcexpress.ca/pcx-bff/api/v2/products/search?` +
    `lang=en&date=${date}&pickupType=SELF_SERVE_FULL` +
    `&storeId=${resolvedStoreId}&banner=${config.banner}` +
    `&term=${encodeURIComponent(term)}&from=0&size=5&sort=relevance`;

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Set headers to mimic a real browser session on the store site
    await page.setExtraHTTPHeaders(buildHeaders(bannerKey, apiKey));
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36'
    );

    // Intercept the API response directly — faster than waiting for page render
    let apiResponse = null;

    await page.setRequestInterception(true);

    page.on('request', (req) => {
      // Only allow the API call through — block images, fonts, etc.
      const url = req.url();
      if (url.includes('api.pcexpress.ca')) {
        req.continue();
      } else if (
        req.resourceType() === 'image' ||
        req.resourceType() === 'font' ||
        req.resourceType() === 'stylesheet'
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });

    page.on('response', async (response) => {
      if (response.url().includes('/products/search')) {
        try {
          apiResponse = await response.json();
        } catch (e) {
          // Response wasn't JSON — ignore
        }
      }
    });

    // Navigate to the store search page — this triggers the API call with
    // proper cookies/session that Akamai trusts
    await page.goto(config.searchUrl(term), {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });

    // If page navigation didn't trigger the API, call it directly now
    // (we have valid cookies from the page load)
    if (!apiResponse) {
      apiResponse = await page.evaluate(async (url, headers) => {
        const res = await fetch(url, { headers });
        return res.json();
      }, searchApiUrl, buildHeaders(bannerKey, apiKey));
    }

    if (!apiResponse || !apiResponse.results) {
      return [];
    }

    // Normalize results to a consistent shape
    return apiResponse.results.map(normalizeProduct);

  } finally {
    await page.close();
  }
}

// -----------------------------------------------
// GET PRODUCT: fetch full details by product code
// This is the endpoint confirmed working from your curl
// -----------------------------------------------
async function getProduct(productCode, bannerKey = 'nofrills', storeId = null) {
  const config = BANNERS[bannerKey];
  if (!config) throw new Error(`Unknown banner: ${bannerKey}`);

  const resolvedStoreId = storeId || config.defaultStoreId;
  const apiKey = process.env.LOBLAW_API_KEY;
  const date = getApiDate();

  const productUrl = `https://api.pcexpress.ca/pcx-bff/api/v1/products/${productCode}` +
    `?lang=en&date=${date}&pickupType=SELF_SERVE_FULL` +
    `&storeId=${resolvedStoreId}&banner=${config.banner}`;

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders(buildHeaders(bannerKey, apiKey));
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36'
    );

    // Navigate to the store first to get valid session cookies
    await page.goto(config.origin, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // Now call the product API with those cookies in place
    const data = await page.evaluate(async (url, headers) => {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      return res.json();
    }, productUrl, buildHeaders(bannerKey, apiKey));

    return normalizeProduct(data);

  } finally {
    await page.close();
  }
}

// -----------------------------------------------
// Normalize: map the raw API response to a clean shape
// Works for both search results and product detail responses
// -----------------------------------------------
function normalizeProduct(raw) {
  const offer = raw.offers?.[0] || {};
  const price = offer.price || {};
  const compPrices = offer.comparisonPrices || [];

  // Find per-kg and per-lb comparison prices
  const perKg = compPrices.find(p => p.unit === 'kg');
  const perLb = compPrices.find(p => p.unit === 'lb');

  return {
    code: raw.code,
    name: raw.name,
    brand: raw.brand || null,
    packageSize: raw.packageSize || '',
    imageUrl: raw.imageAssets?.[0]?.smallUrl || null,
    link: raw.link || null,

    // Pricing
    price: price.value || null,          // e.g. 1.75
    priceUnit: price.unit || 'ea',       // e.g. "ea"

    // Comparison prices — great for normalizing across Odd Bunch units
    pricePerKg: perKg?.value || null,    // e.g. 1.52
    pricePerLb: perLb?.value || null,    // e.g. 0.69

    // Availability
    inStock: offer.stockStatus === 'OK',

    // Promotions
    wasPrice: offer.wasPrice?.value || null,
    onSale: !!offer.wasPrice,
    promotions: offer.promotions || [],
  };
}

module.exports = { searchProducts, getProduct, BANNERS };