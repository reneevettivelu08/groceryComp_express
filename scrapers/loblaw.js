// No Puppeteer — uses native https to call the PC Express API directly.
// Akamai session cookies are seeded by hitting the store homepage first,
// then reused for all subsequent product lookups.
const https = require('https');
const http  = require('http');

const BANNERS = {
  nofrills: {
    banner:         'nofrills',
    origin:         'https://www.nofrills.ca',
    defaultStoreId: process.env.NOFRILLS_STORE_ID || '3643',
  },
  loblaws: {
    banner:         'loblaw',
    origin:         'https://www.loblaws.ca',
    defaultStoreId: process.env.LOBLAWS_STORE_ID  || '1038',
  },
  superstore: {
    banner:         'superstore',
    origin:         'https://www.realcanadiansuperstore.ca',
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
// Simple cookie jar — stores cookies per domain
// -----------------------------------------------
const cookieJar = {};

function storeCookies(domain, setCookieHeaders) {
  if (!setCookieHeaders) return;
  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : [setCookieHeaders];
  if (!cookieJar[domain]) cookieJar[domain] = {};
  headers.forEach((header) => {
    const [pair] = header.split(';');
    const [name, ...rest] = pair.split('=');
    cookieJar[domain][name.trim()] = rest.join('=').trim();
  });
}

function getCookieHeader(domain) {
  if (!cookieJar[domain]) return '';
  return Object.entries(cookieJar[domain])
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// -----------------------------------------------
// Generic HTTP request helper
// -----------------------------------------------
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const lib      = parsed.protocol === 'https:' ? https : http;
    const domain   = parsed.hostname;
    const cookies  = getCookieHeader(domain);

    const reqOptions = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers: {
        'User-Agent':      'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'en-CA,en;q=0.9',
        'Connection':      'keep-alive',
        ...(cookies ? { 'Cookie': cookies } : {}),
        ...(options.headers || {}),
      },
    };

    const req = lib.request(reqOptions, (res) => {
      // Store any cookies the server sets
      storeCookies(domain, res.headers['set-cookie']);

      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
        return resolve(request(redirectUrl, options));
      }

      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end',  () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });

    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error('Request timed out after 20s'));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

// -----------------------------------------------
// Seed session cookies by hitting the store homepage.
// Only done once per banner per server run.
// -----------------------------------------------
const seededBanners = new Set();

async function seedSession(bannerKey) {
  if (seededBanners.has(bannerKey)) return;

  const config = BANNERS[bannerKey];
  console.log(`Seeding session for ${bannerKey}...`);

  try {
    await request(config.origin, {
      headers: {
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Sec-Fetch-Dest':  'document',
        'Sec-Fetch-Mode':  'navigate',
        'Sec-Fetch-Site':  'none',
        'Referer':         config.origin + '/',
      },
    });
    seededBanners.add(bannerKey);
    console.log(`Session seeded for ${bannerKey}`);
  } catch (err) {
    console.warn(`Session seed failed for ${bannerKey}: ${err.message} — will try anyway`);
    seededBanners.add(bannerKey); // don't retry on every call
  }
}

// -----------------------------------------------
// Build API request headers
// -----------------------------------------------
function apiHeaders(bannerKey) {
  const config = BANNERS[bannerKey];
  const domain = new URL(config.origin).hostname;
  const cookies = getCookieHeader(domain);

  return {
    'Accept':                   'application/json, text/plain, */*',
    'Accept-Language':          'en',
    'Business-User-Agent':      'PCXWEB',
    'Content-Type':             'application/json',
    'Origin':                   config.origin,
    'Origin_Session_Header':    'B',
    'Referer':                  config.origin + '/',
    'Sec-Fetch-Dest':           'empty',
    'Sec-Fetch-Mode':           'cors',
    'Sec-Fetch-Site':           'cross-site',
    'Sec-Fetch-Storage-Access': 'active',
    'Site-Banner':              config.banner,
    'x-apikey':                 process.env.LOBLAW_API_KEY,
    'x-application-type':       'Web',
    'x-loblaw-tenant-id':       'ONLINE_GROCERIES',
    ...(cookies ? { 'Cookie': cookies } : {}),
  };
}

// -----------------------------------------------
// GET PRODUCT BY CODE
// -----------------------------------------------
async function getProduct(productCode, bannerKey = 'nofrills', storeId = null) {
  const config          = BANNERS[bannerKey];
  if (!config) throw new Error('Unknown banner: ' + bannerKey);

  const resolvedStoreId = storeId || config.defaultStoreId;
  const date            = getApiDate();

  await seedSession(bannerKey);

  const url =
    `https://api.pcexpress.ca/pcx-bff/api/v1/products/${productCode}` +
    `?lang=en&date=${date}&pickupType=SELF_SERVE_FULL` +
    `&storeId=${resolvedStoreId}&banner=${config.banner}`;

  console.log(`Fetching [${bannerKey}] ${productCode}`);

  const result = await request(url, { headers: apiHeaders(bannerKey) });

  console.log(`  HTTP ${result.status} — ${result.body.length} bytes`);

  if (result.status === 403) {
    // Clear seeded flag and retry once with a fresh session
    seededBanners.delete(bannerKey);
    await seedSession(bannerKey);
    const retry = await request(url, { headers: apiHeaders(bannerKey) });
    if (retry.status !== 200) {
      throw new Error(`API returned ${retry.status} after retry: ${retry.body.slice(0, 200)}`);
    }
    return normalizeProduct(JSON.parse(retry.body));
  }

  if (result.status !== 200) {
    throw new Error(`API returned HTTP ${result.status}: ${result.body.slice(0, 300)}`);
  }

  let data;
  try {
    data = JSON.parse(result.body);
  } catch (e) {
    throw new Error('Could not parse JSON: ' + result.body.slice(0, 200));
  }

  return normalizeProduct(data);
}

// -----------------------------------------------
// Fetch multiple product codes sequentially
// -----------------------------------------------
async function getProducts(productCodes, bannerKey = 'nofrills', storeId = null) {
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