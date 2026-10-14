'use strict';

/**
 * The shopper surface is retired. Every /api/shopper endpoint answers
 * 410 Gone; the page itself 301s to /app.html#shopping (server.js, vercel.json).
 */
const express = require('express');

const router = express.Router();

router.all(/.*/, (_req, res) => {
  res.status(410).json({
    success: false,
    error: 'gone',
    message: 'This feature has been retired. Your shopping list is in the app.',
  });
});

module.exports = router;
