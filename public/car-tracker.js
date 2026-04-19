const CAPTURE_TOKEN_KEY = 'car_tracker_capture_token';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  return res.json();
}

function currency(value) {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(value);
}

function setTokenStatus(text) {
  document.getElementById('token-status').textContent = text;
}

function getStoredToken() {
  return localStorage.getItem(CAPTURE_TOKEN_KEY);
}

async function refreshTokenStatus() {
  const token = getStoredToken();
  const status = await fetchJson('/api/car-tracker/auth/status');
  if (!status.active) {
    setTokenStatus('No active token on server. Generate a new 30-day token.');
    return;
  }
  setTokenStatus(`Server token expires: ${status.expiresAt}\nLocal token present: ${token ? 'yes' : 'no'}`);
}

async function generateToken() {
  const response = await fetchJson('/api/car-tracker/auth/token', {
    method: 'POST',
    body: JSON.stringify({ daysValid: 30 }),
  });

  if (!response.success) {
    setTokenStatus('Failed to generate token');
    return;
  }

  localStorage.setItem(CAPTURE_TOKEN_KEY, response.token);
  setTokenStatus(`Capture token generated. Expires: ${response.expiresAt}\nToken: ${response.token}`);
}

async function renderPlans() {
  const data = await fetchJson('/api/car-tracker/monetization/plans');
  document.getElementById('plans').innerHTML = data.plans.map((plan) => `
    <div style="border:1px solid #1f2937;border-radius:10px;padding:10px;margin-bottom:8px;">
      <strong>${plan.name}</strong> — ${plan.monthlyAud === 0 ? 'Free' : `AUD $${plan.monthlyAud}/mo`}<br/>
      <small>${plan.features.join(' • ')}</small>
    </div>
  `).join('');
}

async function renderListings() {
  const comparison = await fetchJson('/api/car-tracker/comparison');
  const tableBody = document.getElementById('listing-body');

  if (!comparison.ranked.length) {
    tableBody.innerHTML = '<tr><td colspan="4">No listings yet.</td></tr>';
    return;
  }

  tableBody.innerHTML = comparison.ranked.map((listing) => `
    <tr>
      <td><a href="${listing.sourceUrl}" target="_blank" rel="noopener" style="color:#93c5fd;">${listing.title}</a></td>
      <td>${currency(listing.price)}</td>
      <td>${listing.interiorConfidence}</td>
      <td>${listing.score}/10</td>
    </tr>
  `).join('');
}

async function renderAlerts() {
  const data = await fetchJson('/api/car-tracker/alerts');
  const el = document.getElementById('alerts');
  if (!data.alerts.length) {
    el.textContent = 'No active price-drop alerts.';
    return;
  }
  el.innerHTML = data.alerts.map((item) => `• ${item.title}: ${currency(item.from)} → ${currency(item.to)} (${item.changePercent}%)`).join('<br/>');
}

function wireListingForm() {
  const form = document.getElementById('listing-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const response = await fetchJson('/api/car-tracker/listings', {
      method: 'POST',
      body: JSON.stringify(data),
    });

    if (!response.success) {
      window.alert(response.error || 'Unable to save listing');
      return;
    }

    form.reset();
    await Promise.all([renderListings(), renderAlerts()]);
  });
}

function wireInsightsForm() {
  const form = document.getElementById('insights-form');
  const output = document.getElementById('insights-output');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());

    const [depreciation, ownership] = await Promise.all([
      fetchJson('/api/car-tracker/insights/depreciation', { method: 'POST', body: JSON.stringify(payload) }),
      fetchJson('/api/car-tracker/insights/ownership-cost', { method: 'POST', body: JSON.stringify(payload) }),
    ]);

    output.textContent = JSON.stringify({ depreciation: depreciation.projection, ownership: ownership.ownership }, null, 2);
  });
}

function wireTokenButton() {
  document.getElementById('generate-token').addEventListener('click', generateToken);
}

async function init() {
  wireTokenButton();
  wireListingForm();
  wireInsightsForm();
  await Promise.all([renderPlans(), renderListings(), renderAlerts(), refreshTokenStatus()]);
}

init();
