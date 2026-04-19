function pickText(selectors) {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (node?.textContent?.trim()) return node.textContent.trim();
  }
  return null;
}

function parsePrice(text) {
  if (!text) return null;
  const digits = text.replace(/[^\d.]/g, '');
  return digits ? Number.parseFloat(digits) : null;
}

function captureListing() {
  const title = pickText(['h1', '[data-testid="listing-title"]']);
  const priceText = pickText(['[data-testid="listing-price"]', '.price', '[class*="price"]']);
  const details = pickText(['[data-testid="key-details"]', '.key-details']);

  return {
    source: 'carsales',
    sourceUrl: window.location.href,
    title: title || document.title,
    price: parsePrice(priceText),
    notes: details || '',
  };
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type !== 'CAPTURE_LISTING') return;
  try {
    sendResponse({ ok: true, payload: captureListing() });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
});
