# groceryComp_express

Express.js backend API for the groceryComp price comparison tool. Scrapes real-time produce prices from No Frills, Loblaws, and Real Canadian Superstore via Puppeteer and serves them to the React frontend.

---

## What it does

- Launches a headless Chromium browser (Puppeteer) to establish an authenticated session on Loblaw banner store websites
- Makes authenticated XHR calls to the PC Express internal API (`api.pcexpress.ca`) from within that browser session, bypassing Akamai bot protection
- Returns normalized product data (price, price/kg, price/lb, sale status) for any product code
- Caches results in memory for 1 hour to avoid redundant scraping
- Persists product code mappings to `productCodes.json` so you don't have to look them up repeatedly

---

## Tech stack

| Package | Purpose |
|---|---|
| `express` | HTTP server and routing |
| `puppeteer` | Headless Chromium — establishes Akamai-trusted browser sessions |
| `dotenv` | Loads environment variables from `.env` |
| `cors` | Allows requests from the React frontend origin |
| `nodemon` | Auto-restarts server on file changes in development |

---

## Project structure

```
groceryComp_express/
├── index.js                  # Express app entry point
├── cache.js                  # In-memory cache with 1hr TTL
├── productCodes.json         # Persisted item name → product code mappings
├── Procfile                  # Heroku startup command
├── run-heroku.sh             # Heroku Chrome path detection script
├── routes/
│   └── loblaw.js             # All /api/loblaw/* route handlers
├── scrapers/
│   └── loblaw.js             # Puppeteer browser session + XHR API calls
├── .env.example              # Template for required environment variables
├── .env                      # Your local config (never committed)
└── package.json
```

---

## Local setup

### Prerequisites

- Node.js v18 or higher — https://nodejs.org
- Git

### Install

```bash
git clone https://github.com/reneevettivelu08/groceryComp_express.git
cd groceryComp_express
npm install
```

> `npm install` downloads Puppeteer and a bundled Chromium (~170MB). This is expected and only happens once.

### Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
LOBLAW_API_KEY=C1xujSegT5j3ap3yexJjqhOfELwGKYvz
NOFRILLS_STORE_ID=3643
LOBLAWS_STORE_ID=1038
SUPERSTORE_STORE_ID=1057
PORT=3001
NODE_ENV=development
```

**Finding your store ID:** Browse to nofrills.ca, open DevTools → Network → filter XHR, add anything to cart, and look for `storeId` in any request to `api.pcexpress.ca`.

**Refreshing the API key:** If requests start returning 403, the key has rotated. Go to nofrills.ca → DevTools → Network → filter XHR → find any request to `api.pcexpress.ca` → copy the `x-apikey` header value.

### Run

```bash
npm run dev
```

Server starts at `http://localhost:3001`. You should see:

```
🥦 groceryComp server running on http://localhost:3001
   NODE_ENV: development
   Loblaw API key: ✓ set
```

---

## API reference

### `GET /health`
Health check. Returns `{ status: "ok", timestamp: "..." }`.

---

### `GET /api/loblaw/product/:code`
Fetch a single product by its PC Express product code.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `code` | path | yes | PC Express product code e.g. `20175355001_KG` |
| `banner` | query | no | `nofrills` \| `loblaws` \| `superstore` (default: `nofrills`) |
| `storeId` | query | no | Override the default store ID from `.env` |

**Example:**
```
GET /api/loblaw/product/20175355001_KG?banner=nofrills
```

**Response:**
```json
{
  "product": {
    "code": "20175355001_KG",
    "name": "Bananas, Bunch",
    "price": 1.75,
    "priceUnit": "ea",
    "pricePerKg": 1.52,
    "pricePerLb": 0.69,
    "packageSize": "",
    "inStock": true,
    "onSale": false,
    "wasPrice": null,
    "imageUrl": "https://assets.shop.loblaws.ca/...",
    "link": "/bananas-bunch/p/20175355001_KG"
  },
  "fromCache": false
}
```

---

### `GET /api/loblaw/search`
Look up stored product codes for an item name and return their prices.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `term` | query | yes | Item name e.g. `bananas`, `avocado` |
| `banner` | query | no | Default: `nofrills` |
| `storeId` | query | no | Override store ID |

**Example:**
```
GET /api/loblaw/search?term=bananas&banner=nofrills
```

Returns `404` with instructions if no codes are stored for that term yet.

---

### `GET /api/loblaw/codes`
Returns all stored product code mappings.

---

### `POST /api/loblaw/codes`
Add or update product codes for an item name. Persisted to `productCodes.json`.

**Body:**
```json
{ "term": "bananas", "codes": ["20175355001_KG"] }
```

---

### `DELETE /api/loblaw/codes/:term`
Remove stored codes for an item.

---

### `DELETE /api/loblaw/cache`
Clear the in-memory price cache.

---

## Managing product codes

Because the Loblaw search API requires authenticated page sessions that are difficult to automate, this app uses **manually curated product codes** instead of real-time search.

### Finding a product code

1. Go to [nofrills.ca](https://www.nofrills.ca) and search for the item
2. Click the product
3. Copy the code from the URL: `https://www.nofrills.ca/bananas-bunch/p/20175355001_KG` → code is `20175355001_KG`

### Adding codes via API

```bash
curl -X POST http://localhost:3001/api/loblaw/codes \
  -H "Content-Type: application/json" \
  -d '{ "term": "avocado", "codes": ["21066_EA"] }'
```

### Adding codes by editing the file directly

Edit `productCodes.json` and restart the server:

```json
{
  "bananas": ["20175355001_KG"],
  "avocado": ["21066_EA"],
  "kale":    ["20601020001_EA"],
  "apples":  ["20145621001_EA", "20156570_EA"]
}
```

Multiple codes per term means the app will fetch all of them and return the full list, letting the frontend display alternatives.

---

## Deployment (Heroku)

See the full deployment guide in the React frontend repository README, or follow these steps:

```bash
# Install Heroku CLI: https://devcenter.heroku.com/articles/heroku-cli

heroku create grocerycomp-api
heroku buildpacks:add heroku/nodejs
heroku buildpacks:add https://github.com/jontewks/puppeteer-heroku-buildpack

heroku config:set NODE_ENV=production
heroku config:set LOBLAW_API_KEY=your_key_here
heroku config:set NOFRILLS_STORE_ID=3643
heroku config:set LOBLAWS_STORE_ID=1038
heroku config:set SUPERSTORE_STORE_ID=1057
heroku config:set CLIENT_URL=https://your-netlify-app.netlify.app

git push heroku main
```

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `LOBLAW_API_KEY` | Yes | x-apikey header value from nofrills.ca network requests |
| `NOFRILLS_STORE_ID` | Yes | Store ID for your nearest No Frills |
| `LOBLAWS_STORE_ID` | No | Store ID for your nearest Loblaws |
| `SUPERSTORE_STORE_ID` | No | Store ID for your nearest Real Canadian Superstore |
| `PORT` | No | Server port (default: 3001, Heroku sets this automatically) |
| `NODE_ENV` | No | Set to `production` on Heroku |
| `CLIENT_URL` | No | Frontend URL for CORS (e.g. your Netlify URL) |
| `PUPPETEER_EXECUTABLE_PATH` | No | Set automatically by Heroku buildpack |