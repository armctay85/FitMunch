const output = document.getElementById('output');
const apiBaseInput = document.getElementById('apiBase');
const tokenInput = document.getElementById('token');

function setOutput(data) {
  output.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

async function loadSettings() {
  const { apiBase, captureToken } = await chrome.storage.local.get(['apiBase', 'captureToken']);
  apiBaseInput.value = apiBase || 'http://localhost:5000';
  tokenInput.value = captureToken || '';
}

async function saveSettings() {
  const apiBase = apiBaseInput.value.trim() || 'http://localhost:5000';
  const captureToken = tokenInput.value.trim();
  await chrome.storage.local.set({ apiBase, captureToken });
  setOutput('Saved settings.');
}

async function capture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return setOutput('No active tab');

  const [response] = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_LISTING' });
  if (!response?.ok) return setOutput(response?.error || 'Capture failed');

  const { apiBase, captureToken } = await chrome.storage.local.get(['apiBase', 'captureToken']);
  if (!captureToken) return setOutput('Missing capture token. Generate one in /car-tracker and paste it here.');

  try {
    const apiRes = await fetch(`${apiBase || 'http://localhost:5000'}/api/car-tracker/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${captureToken}`,
      },
      body: JSON.stringify(response.payload),
    });
    const apiData = await apiRes.json();
    setOutput(apiData);
  } catch (error) {
    setOutput(`API error: ${error.message}`);
  }
}

document.getElementById('save').addEventListener('click', saveSettings);
document.getElementById('capture').addEventListener('click', capture);
loadSettings();
