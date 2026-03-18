import 'dotenv/config'; 
import cors from "cors";
import express from "express";
const loblawRoutes = require('./routes/loblaw');

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
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
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