const apiBase = '/api/crime-alert';

const incidentForm = document.getElementById('incidentForm');
const formStatus = document.getElementById('formStatus');
const incidentList = document.getElementById('incidentList');
const hotspotRows = document.getElementById('hotspotRows');
const kpiGrid = document.getElementById('kpiGrid');
const channelStats = document.getElementById('channelStats');

const filterLat = document.getElementById('filterLat');
const filterLon = document.getElementById('filterLon');
const filterRadius = document.getElementById('filterRadius');
const statusFilter = document.getElementById('statusFilter');

const contrastToggle = document.getElementById('contrastToggle');
const refreshBtn = document.getElementById('refreshBtn');
const loadIncidentsBtn = document.getElementById('loadIncidentsBtn');

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function incidentTemplate(incident) {
  const created = new Date(incident.createdAt).toLocaleString();
  const distance =
    typeof incident.distanceMeters === 'number' ? `${Math.round(incident.distanceMeters)}m away` : 'Distance N/A';

  const verifyButton =
    incident.status === 'pending'
      ? `<button class="btn" data-action="verify" data-id="${incident.id}">Verify + Alert</button>`
      : '';

  return `
    <article class="incident">
      <div class="incident-head">
        <strong>${incident.type.replace(/_/g, ' ')}</strong>
        <div>
          <span class="chip ${incident.severity === 'critical' ? 'critical' : ''}">${incident.severity}</span>
          <span class="chip ${incident.status === 'verified' ? 'verified' : ''}">${incident.status}</span>
        </div>
      </div>
      <p>${incident.description}</p>
      <small>${created} · ${distance} · ${incident.isAnonymous ? 'anonymous' : 'verified reporter'}</small>
      ${verifyButton}
    </article>
  `;
}

function renderIncidents(incidents) {
  if (!incidents.length) {
    incidentList.innerHTML = '<p class="subtext">No incidents match your current filter.</p>';
    return;
  }
  incidentList.innerHTML = incidents.map(incidentTemplate).join('');
}

function renderHotspots(hotspots) {
  if (!hotspots.length) {
    hotspotRows.innerHTML = '<tr><td colspan="4">No hotspot data available.</td></tr>';
    return;
  }

  hotspotRows.innerHTML = hotspots
    .map(
      (spot) => `
      <tr>
        <td>${spot.center.latitude.toFixed(3)}, ${spot.center.longitude.toFixed(3)}</td>
        <td>${spot.incidents}</td>
        <td>${spot.verified}</td>
        <td>${spot.critical}</td>
      </tr>
    `,
    )
    .join('');
}

function renderTelemetry(telemetry, health) {
  const pending = health.pendingCount ?? 0;
  const verified = health.verifiedCount ?? 0;

  kpiGrid.innerHTML = `
    <div class="kpi"><div class="value">${health.incidentCount}</div><div class="label">Total incidents</div></div>
    <div class="kpi"><div class="value">${pending}</div><div class="label">Pending moderation</div></div>
    <div class="kpi"><div class="value">${verified}</div><div class="label">Verified alerts</div></div>
    <div class="kpi"><div class="value">${telemetry.summary?.p99InitiationMs ?? 0}ms</div><div class="label">P99 alert init</div></div>
    <div class="kpi"><div class="value">${telemetry.summary?.totalDeliveries ?? 0}</div><div class="label">Delivery events</div></div>
    <div class="kpi"><div class="value">30s</div><div class="label">Latency target</div></div>
  `;

  const channels = telemetry.summary?.byChannel || {};
  channelStats.innerHTML = Object.entries(channels)
    .map(([channel, stats]) => `<li>${channel}: ${stats.count} sends · avg ${stats.avgLatencyMs}ms</li>`)
    .join('') || '<li>No deliveries yet — verify incidents to trigger alert fan-out.</li>';
}

async function loadIncidents() {
  const params = new URLSearchParams({
    latitude: filterLat.value,
    longitude: filterLon.value,
    radiusKm: filterRadius.value,
    limit: '60',
  });

  if (statusFilter.value) params.set('status', statusFilter.value);

  const data = await request(`/incidents?${params.toString()}`);
  renderIncidents(data.incidents || []);
}

async function loadHotspots() {
  const data = await request('/analytics/hotspots');
  renderHotspots(data.hotspots || []);
}

async function loadTelemetry() {
  const [telemetry, health] = await Promise.all([request('/alerts/telemetry'), request('/health')]);
  renderTelemetry(telemetry, health);
}

async function refreshAll() {
  try {
    await Promise.all([loadIncidents(), loadHotspots(), loadTelemetry()]);
  } catch (error) {
    formStatus.textContent = `Unable to refresh: ${error.message}`;
  }
}

incidentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(incidentForm);

  const payload = {
    type: formData.get('type'),
    severity: formData.get('severity'),
    description: formData.get('description'),
    latitude: Number(formData.get('latitude')),
    longitude: Number(formData.get('longitude')),
    locationMode: formData.get('locationMode'),
    isAnonymous: formData.get('isAnonymous') === 'on',
    mediaCount: Number(formData.get('mediaCount')),
  };

  try {
    const result = await request('/incidents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    formStatus.textContent = `Incident queued. Estimated moderation timeline: ${result.sla.moderationQueueEtaMinutes} minutes.`;
    incidentForm.reset();
    await refreshAll();
  } catch (error) {
    formStatus.textContent = `Submit failed: ${error.message}`;
  }
});

incidentList.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.dataset.action === 'verify' && target.dataset.id) {
    try {
      await request(`/incidents/${target.dataset.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ verifiedBy: 'dashboard_moderator' }),
      });
      formStatus.textContent = 'Incident verified and alert fan-out initiated.';
      await refreshAll();
    } catch (error) {
      formStatus.textContent = `Verification failed: ${error.message}`;
    }
  }
});

contrastToggle.addEventListener('click', () => {
  const applied = document.body.classList.toggle('contrast');
  contrastToggle.setAttribute('aria-pressed', String(applied));
});

refreshBtn.addEventListener('click', refreshAll);
loadIncidentsBtn.addEventListener('click', loadIncidents);
statusFilter.addEventListener('change', loadIncidents);

refreshAll();
setInterval(loadTelemetry, 10000);
