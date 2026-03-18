// Simple in-memory cache with TTL
// Prevents hammering the Loblaw API on every render
// Resets on server restart — fine for development
// For production consider upgrading to Redis

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value) {
  store.set(key, { value, timestamp: Date.now() });
}

function clear() {
  store.clear();
}

function size() {
  return store.size;
}

module.exports = { get, set, clear, size };