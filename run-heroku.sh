#!/usr/bin/env bash
set -e

echo "--- groceryComp startup ---"
echo "NODE_ENV: $NODE_ENV"

# Find Chrome installed by the Puppeteer buildpack
# Try each known path in order
CHROME_PATH=""

for candidate in \
  "/app/.apt/usr/bin/google-chrome-stable" \
  "/app/.apt/usr/bin/google-chrome" \
  "/app/.apt/usr/bin/chromium-browser" \
  "/app/.apt/usr/bin/chromium" \
  "$(which google-chrome-stable 2>/dev/null)" \
  "$(which google-chrome 2>/dev/null)" \
  "$(which chromium-browser 2>/dev/null)" \
  "$(which chromium 2>/dev/null)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    CHROME_PATH="$candidate"
    break
  fi
done

if [ -z "$CHROME_PATH" ]; then
  echo "ERROR: Chrome not found. Check that the Puppeteer buildpack is installed."
  echo "Run: heroku buildpacks (should show jontewks/puppeteer-heroku-buildpack as #1)"
  exit 1
fi

echo "Chrome found at: $CHROME_PATH"
export PUPPETEER_EXECUTABLE_PATH="$CHROME_PATH"

echo "Starting Express server..."
node index.js