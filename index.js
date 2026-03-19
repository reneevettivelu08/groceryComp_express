import 'dotenv/config'; 
import cors from "cors";
import express from "express";
import loblawRoutes from "./routes/loblaw.js";

const app = express();
const PORT = process.env.PORT || 3001;

// -----------------------------------------------
// Middleware
// -----------------------------------------------
app.use(express.json());

// Allow requests from the React dev server and Netlify
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.CLIENT_URL, // set this in production .env
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

// -----------------------------------------------
// Routes
// -----------------------------------------------
app.use('/api/loblaw', loblawRoutes);

// Health check — Heroku and Netlify use this
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// -----------------------------------------------
// Start
// -----------------------------------------------
app.listen(PORT, () => {
  console.log(`\n🥦 groceryComp server running on http://localhost:${PORT}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Loblaw API key: ${process.env.LOBLAW_API_KEY ? '✓ set' : '✗ MISSING — check .env'}\n`);
});