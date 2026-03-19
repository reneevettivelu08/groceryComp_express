const puppeteer = require('puppeteer');

const BANNERS = {
  nofrills: {
    banner: 'nofrills',
    origin: 'https://www.nofrills.ca',
    defaultStoreId: process.env.NOFRILLS_STORE_ID || '3643',
  },
  loblaws: {
    banner: 'loblaw',
    origin: 'https://www.loblaws.ca',
    defaultStoreId: process.env.LOBLAWS_STORE_ID || '1038',
  },
  superstore: {
    banner: 'superstore',
    origin: 'https://www.realcanadiansuperstore.ca',
    defaultStoreId: process.env.SUPERSTORE_STORE_ID || '1057',
  },
};

function getApiDate() {
  const d    = new Date();
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

// -----------------------------------------------
// Singleton browser
// -----------------------------------------------
let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  // Production (Heroku) needs different flags than local dev.
  // --single-process crashes on Heroku's container — remove it in prod.
  // --no-zygote also conflicts with Heroku — only use in dev.
  const productionArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--mute-audio',
    '--window-size=1280,720',
  ];

  const developmentArgs = [
    ...productionArgs,
    '--no-zygote',
    '--single-process',
  ];

  browserInstance = await puppeteer.launch({
    headless: isProduction ? true : 'new',
    args: isProduction ? productionArgs : developmentArgs,
    ...(process.env.PUPPETEER_EXECUTABLE_PATH && {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    }),
  });

  console.log('🌐 Browser launched');
  browserInstance.on('disconnected', () => {
    browserInstance = null;
    console.log('⚠️  Browser disconnected');
  });

  return browserInstance;
}

// -----------------------------------------------
// One persistent page per banner — loaded once,
// reused for all subsequent API calls
// -----------------------------------------------
const sessionPages = {};

async function getSessionPage(bannerKey) {
  const config = BANNERS[bannerKey];

  // Reuse existing page if still open
  if (sessionPages[bannerKey]) {
    try {
      // Quick check the page is still alive
      await sessionPages[bannerKey].title();
      return sessionPages[bannerKey];
    } catch (e) {
      delete sessionPages[bannerKey];
    }
  }

  const browser = await getBrowser();
  const page    = await browser.newPage();

  await page.setUserAgent(
    'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36'
  );

  // Block heavy resources — we only need cookies from the homepage
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  console.log(`🍪 Loading ${config.origin} to establish session...`);

  await page.goto(config.origin, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  console.log(`✓ Session established for ${bannerKey}`);
  sessionPages[bannerKey] = page;
  return page;
}

// -----------------------------------------------
// Make an API call from within the page context
// using XMLHttpRequest — bypasses CSP restrictions
// that block fetch() calls to cross-origin APIs
// -----------------------------------------------
async function callApiFromPage(page, url, apiKey, bannerKey) {
  const config = BANNERS[bannerKey];

  const result = await page.evaluate((apiUrl, key, origin, banner) => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', apiUrl, true);

      // Set all required headers
      xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
      xhr.setRequestHeader('Accept-Language', 'en');
      xhr.setRequestHeader('Business-User-Agent', 'PCXWEB');
      xhr.setRequestHeader('Origin_Session_Header', 'B');
      xhr.setRequestHeader('Site-Banner', banner);
      xhr.setRequestHeader('x-apikey', key);
      xhr.setRequestHeader('x-application-type', 'Web');
      xhr.setRequestHeader('x-loblaw-tenant-id', 'ONLINE_GROCERIES');

      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          resolve({ status: xhr.status, body: xhr.responseText });
        }
      };

      xhr.onerror = function () {
        resolve({ status: 0, body: 'XHR network error' });
      };

      xhr.send();
    });
  }, url, apiKey, config.origin, config.banner);

  return result;
}

// -----------------------------------------------
// GET PRODUCT BY CODE
// -----------------------------------------------
async function getProduct(productCode, bannerKey = 'nofrills', storeId = null) {
  const config          = BANNERS[bannerKey];
  if (!config) throw new Error('Unknown banner: ' + bannerKey);

  const resolvedStoreId = storeId || config.defaultStoreId;
  const date            = getApiDate();
  const apiKey          = process.env.LOBLAW_API_KEY;

  const apiUrl =
    `https://api.pcexpress.ca/pcx-bff/api/v1/products/${productCode}` +
    `?lang=en` +
    `&date=${date}` +
    `&pickupType=SELF_SERVE_FULL` +
    `&storeId=${resolvedStoreId}` +
    `&banner=${config.banner}`;

  console.log(`📦 Fetching [${bannerKey}] ${productCode}`);

  const page   = await getSessionPage(bannerKey);
  const result = await callApiFromPage(page, apiUrl, apiKey, bannerKey);

  console.log(`   HTTP ${result.status} — ${result.body.length} bytes`);

  if (result.status === 0) {
    throw new Error('XHR network error — page may have lost its session');
  }

  if (result.status === 403) {
    // Session expired — clear and retry once with fresh session
    console.warn(`   403 received — clearing session for ${bannerKey} and retrying`);
    try { await sessionPages[bannerKey].close(); } catch (e) {}
    delete sessionPages[bannerKey];
    const freshPage   = await getSessionPage(bannerKey);
    const retryResult = await callApiFromPage(freshPage, apiUrl, apiKey, bannerKey);
    if (retryResult.status !== 200) {
      throw new Error(`API returned HTTP ${retryResult.status} after retry: ${retryResult.body.slice(0, 200)}`);
    }
    return normalizeProduct(JSON.parse(retryResult.body));
  }

  if (result.status !== 200) {
    throw new Error(`API returned HTTP ${result.status}: ${result.body.slice(0, 300)}`);
  }

  let data;
  try {
    data = JSON.parse(result.body);
  } catch (e) {
    throw new Error('Could not parse JSON response: ' + result.body.slice(0, 200));
  }

  return normalizeProduct(data);
}

// -----------------------------------------------
// Fetch multiple product codes
// -----------------------------------------------
async function getProducts(productCodes, bannerKey = 'nofrills', storeId = null) {
  // Run sequentially to avoid hammering Akamai with parallel requests
  const results = [];
  for (const code of productCodes) {
    try {
      const product = await getProduct(code, bannerKey, storeId);
      results.push(product);
    } catch (err) {
      console.error(`Failed to fetch ${code}: ${err.message}`);
    }
  }
  return results;
}

// -----------------------------------------------
// Normalize — handles both API response shapes
// -----------------------------------------------
function normalizeProduct(raw) {
  let priceValue = null;
  let priceUnit  = 'ea';
  let perKgValue = null;
  let perLbValue = null;
  let inStock    = true;
  let wasPrice   = null;
  let onSale     = false;
  let promotions = [];

  if (raw.prices) {
    const p  = raw.prices.price || {};
    const cp = raw.prices.comparisonPrice || {};
    priceValue = p.value || null;
    priceUnit  = p.unit  || 'ea';
    if (cp.value && cp.unit) {
      const u = cp.unit.toLowerCase();
      if (u === 'kg')   { perKgValue = cp.value; perLbValue = cp.value / 2.20462; }
      if (u === '100g') { perKgValue = cp.value * 10; perLbValue = perKgValue / 2.20462; }
    }
    wasPrice = raw.prices.wasPrice ? raw.prices.wasPrice.value : null;
    onSale   = !!raw.prices.wasPrice;
    inStock  = raw.stockStatus !== 'OOS';

  } else if (raw.offers && raw.offers[0]) {
    const offer      = raw.offers[0];
    const price      = offer.price || {};
    const compPrices = offer.comparisonPrices || [];
    const kg = compPrices.find((p) => p.unit === 'kg');
    const lb = compPrices.find((p) => p.unit === 'lb');
    priceValue = price.value || null;
    priceUnit  = price.unit  || 'ea';
    perKgValue = kg ? kg.value : null;
    perLbValue = lb ? lb.value : null;
    inStock    = offer.stockStatus === 'OK';
    wasPrice   = offer.wasPrice ? offer.wasPrice.value : null;
    onSale     = !!offer.wasPrice;
    promotions = offer.promotions || [];
  }

  return {
    code:        raw.code,
    name:        raw.name,
    brand:       raw.brand       || null,
    packageSize: raw.packageSize || '',
    imageUrl:    raw.imageAssets?.[0]?.smallUrl || null,
    link:        raw.link        || null,
    price:       priceValue,
    priceUnit:   priceUnit,
    pricePerKg:  perKgValue ? parseFloat(perKgValue.toFixed(2)) : null,
    pricePerLb:  perLbValue ? parseFloat(perLbValue.toFixed(2)) : null,
    inStock,
    wasPrice,
    onSale,
    promotions,
  };
}

module.exports = { getProduct, getProducts, BANNERS };