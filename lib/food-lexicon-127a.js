'use strict';
// One lexicon. Coach used to keep a second copy; it now reads food-lexicon.js.
// scan() leaves near-misses off unless asked, so "fillet" is not "filbert".
const base = require('./food-lexicon');
module.exports = {
  ...base,
  scan(text, opts) {
    const near = !!(opts && opts.near === true);
    return base.scan(text, { near });
  },
};
