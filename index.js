require('dotenv').config();
const express = require('express');
const cors = require('cors');
const loblawRoutes = require('./routes/loblaw');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// In production, allow the Netlify origin.
// In development, allow localhost.
// If CLIENT_URL isn't set, fall back to allowing all origins so the
// server never crashes with a CORS error during initial setup.
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // No origin = curl / Postman / server-to-server — always allow
    if (!origin) return callback(null, true);
    // Known origin — allow
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Unknown origin in production — log and reject cleanly (no crash)
    if (process.env.NODE_ENV === 'production') {
      console.warn(`CORS blocked: ${origin}`);
      return callback(null, false);
    }
    // In development allow everything so local testing is easy
    return callback(null, true);
  }
}));

app.use('/api/loblaw', loblawRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n🥦 groceryComp server running on http://localhost:${PORT}`);
  console.log(`   NODE_ENV : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   API key  : ${process.env.LOBLAW_API_KEY ? '✓ set' : '✗ MISSING'}`);
  console.log(`   CORS     : ${allowedOrigins.join(', ') || 'all origins (no CLIENT_URL set)'}\n`);
});