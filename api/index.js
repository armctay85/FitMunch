/**
 * Vercel serverless entry — all traffic is rewritten here (see vercel.json).
 * Local / Railway: use `node server.js` instead (server listens on PORT).
 */
const app = require('../server.js');

module.exports = app;
