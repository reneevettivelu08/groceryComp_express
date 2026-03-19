#!/usr/bin/env bash
# run-heroku.sh
# This script is called by the Heroku puppeteer buildpack before starting the app.
# It sets the correct Chrome executable path for the Heroku environment.

export PUPPETEER_EXECUTABLE_PATH=$(which google-chrome-stable || which google-chrome || which chromium-browser)
echo "Using Chrome at: $PUPPETEER_EXECUTABLE_PATH"
node index.js
