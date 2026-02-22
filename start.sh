#!/bin/bash
# FitMunch Production Start Script

set -e

echo "🚀 Starting FitMunch..."

# Load .env if not already set
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Validate required env vars
if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL is required. Set it in .env or environment."
  exit 1
fi

if [ -z "$STRIPE_SECRET_KEY" ]; then
  echo "⚠️  STRIPE_SECRET_KEY not set. Payment features will be disabled."
fi

# Install dependencies if needed
if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies..."
  npm install --production
fi

echo "✅ Starting server on port ${PORT:-5000}..."
node server.js
