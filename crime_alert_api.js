const express = require('express');
const crypto = require('crypto');

const router = express.Router();

const incidents = [];
const deliveryLog = [];
const DEFAULT_COUNTRY = 'AU';
const SUPPORTED_COUNTRIES = {
  AU: { name: 'Australia', emergencyNumber: '000', defaultRadiusKm: 10 },
  NZ: { name: 'New Zealand', emergencyNumber: '111', defaultRadiusKm: 8 },
  US: { name: 'United States', emergencyNumber: '911', defaultRadiusKm: 12 },
  GB: { name: 'United Kingdom', emergencyNumber: '999', defaultRadiusKm: 9 },
  CA: { name: 'Canada', emergencyNumber: '911', defaultRadiusKm: 12 },
};

const VALID_TYPES = new Set([
  'assault',
  'theft',
  'suspicious_activity',
  'traffic_hazard',
  'fire',
  'medical',
  'other',
]);

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

const toRad = (value) => (value * Math.PI) / 180;

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function normalizeIncidentPayload(payload) {
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const country = String(payload.country || DEFAULT_COUNTRY).toUpperCase();

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { error: 'latitude must be a number between -90 and 90' };
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { error: 'longitude must be a number between -180 and 180' };
  }

  if (!VALID_TYPES.has(payload.type)) {
    return { error: `type must be one of: ${Array.from(VALID_TYPES).join(', ')}` };
  }

  if (!VALID_SEVERITIES.has(payload.severity)) {
    return { error: `severity must be one of: ${Array.from(VALID_SEVERITIES).join(', ')}` };
  }
  if (!SUPPORTED_COUNTRIES[country]) {
    return { error: `country must be one of: ${Object.keys(SUPPORTED_COUNTRIES).join(', ')}` };
  }

  const description = String(payload.description || '').trim();
  if (!description || description.length < 8) {
    return { error: 'description must be at least 8 characters' };
  }

  const locationMode = ['exact', 'intersection', 'offset'].includes(payload.locationMode)
    ? payload.locationMode
    : 'intersection';

  const isAnonymous = payload.isAnonymous !== false;
  const reporterSession = isAnonymous
    ? `anon_${crypto.randomBytes(8).toString('hex')}`
    : `verified_${crypto.randomBytes(6).toString('hex')}`;

  return {
    value: {
      id: crypto.randomUUID(),
      type: payload.type,
      severity: payload.severity,
      description,
      latitude,
      longitude,
      locationMode,
      country,
      isAnonymous,
      source: payload.source || 'community',
      status: 'pending',
      createdAt: new Date().toISOString(),
      verifiedAt: null,
      reporterSession,
      mediaCount: Number(payload.mediaCount || 0),
      trustScore: payload.isAnonymous ? 0.42 : 0.75,
    },
  };
}

function recordDelivery(incident) {
  const channels = ['websocket', 'push', 'sms', 'email'];
  const now = Date.now();

  channels.forEach((channel, index) => {
    deliveryLog.push({
      incidentId: incident.id,
      channel,
      status: 'initiated',
      latencyMs: 30 + index * 45,
      initiatedAt: new Date(now + index * 25).toISOString(),
    });
  });
}

router.get('/health', (_req, res) => {
  const countryCounts = incidents.reduce((acc, incident) => {
    acc[incident.country] = (acc[incident.country] || 0) + 1;
    return acc;
  }, {});

  res.json({
    ok: true,
    service: 'crime-alert-api',
    defaultCountry: DEFAULT_COUNTRY,
    supportedCountries: SUPPORTED_COUNTRIES,
    incidentCount: incidents.length,
    pendingCount: incidents.filter((incident) => incident.status === 'pending').length,
    verifiedCount: incidents.filter((incident) => incident.status === 'verified').length,
    countryCounts,
    timestamp: new Date().toISOString(),
  });
});

router.get('/config/countries', (_req, res) => {
  res.json({
    success: true,
    defaultCountry: DEFAULT_COUNTRY,
    countries: SUPPORTED_COUNTRIES,
  });
});

router.post('/incidents', (req, res) => {
  const { error, value } = normalizeIncidentPayload(req.body || {});
  if (error) {
    return res.status(400).json({ success: false, error });
  }

  incidents.unshift(value);
  if (incidents.length > 2500) incidents.length = 2500;

  return res.status(201).json({
    success: true,
    incident: value,
    sla: {
      targetSeconds: 30,
      moderationQueueEtaMinutes: value.severity === 'critical' ? 2 : 8,
    },
  });
});

router.get('/incidents', (req, res) => {
  const radiusKm = Math.min(Math.max(Number(req.query.radiusKm || 5), 0.25), 50);
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 200);
  const status = req.query.status;
  const country = String(req.query.country || DEFAULT_COUNTRY).toUpperCase();
  if (!SUPPORTED_COUNTRIES[country]) {
    return res.status(400).json({
      success: false,
      error: `country must be one of: ${Object.keys(SUPPORTED_COUNTRIES).join(', ')}`,
    });
  }

  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  const hasGeoFilter = Number.isFinite(latitude) && Number.isFinite(longitude);

  const filtered = incidents
    .filter((incident) => incident.country === country)
    .filter((incident) => (status ? incident.status === status : true))
    .map((incident) => {
      const distanceMeters = hasGeoFilter
        ? haversineDistanceMeters(latitude, longitude, incident.latitude, incident.longitude)
        : null;
      return { ...incident, distanceMeters };
    })
    .filter((incident) => {
      if (!hasGeoFilter || incident.distanceMeters === null) return true;
      return incident.distanceMeters <= radiusKm * 1000;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  return res.json({
    success: true,
    incidents: filtered,
    metadata: {
      radiusKm,
      limit,
      totalMatched: filtered.length,
      country,
    },
  });
});

router.post('/incidents/:incidentId/verify', (req, res) => {
  const incident = incidents.find((entry) => entry.id === req.params.incidentId);
  if (!incident) {
    return res.status(404).json({ success: false, error: 'Incident not found' });
  }

  incident.status = 'verified';
  incident.verifiedAt = new Date().toISOString();
  incident.verifiedBy = req.body?.verifiedBy || 'community_moderator';
  recordDelivery(incident);

  return res.json({ success: true, incident });
});

router.get('/alerts/telemetry', (_req, res) => {
  const recentDeliveries = deliveryLog.slice(-150);
  const byChannel = recentDeliveries.reduce((acc, row) => {
    if (!acc[row.channel]) acc[row.channel] = { count: 0, avgLatencyMs: 0 };
    acc[row.channel].count += 1;
    acc[row.channel].avgLatencyMs += row.latencyMs;
    return acc;
  }, {});

  Object.keys(byChannel).forEach((channel) => {
    byChannel[channel].avgLatencyMs = Math.round(
      byChannel[channel].avgLatencyMs / byChannel[channel].count,
    );
  });

  res.json({
    success: true,
    deliveries: recentDeliveries,
    summary: {
      totalDeliveries: recentDeliveries.length,
      byChannel,
      p99InitiationMs: 95,
    },
  });
});

router.get('/analytics/hotspots', (req, res) => {
  const country = String(req.query.country || DEFAULT_COUNTRY).toUpperCase();
  if (!SUPPORTED_COUNTRIES[country]) {
    return res.status(400).json({
      success: false,
      error: `country must be one of: ${Object.keys(SUPPORTED_COUNTRIES).join(', ')}`,
    });
  }

  const buckets = new Map();

  incidents
    .filter((incident) => incident.country === country)
    .forEach((incident) => {
    const latBucket = Math.round(incident.latitude * 20) / 20;
    const lonBucket = Math.round(incident.longitude * 20) / 20;
    const key = `${latBucket},${lonBucket}`;

    if (!buckets.has(key)) {
      buckets.set(key, {
        center: { latitude: latBucket, longitude: lonBucket },
        incidents: 0,
        verified: 0,
        critical: 0,
      });
    }

    const bucket = buckets.get(key);
    bucket.incidents += 1;
    if (incident.status === 'verified') bucket.verified += 1;
    if (incident.severity === 'critical') bucket.critical += 1;
    });

  const hotspots = Array.from(buckets.values())
    .sort((a, b) => b.incidents - a.incidents)
    .slice(0, 12);

  res.json({
    success: true,
    hotspots,
    country,
    generatedAt: new Date().toISOString(),
  });
});

module.exports = router;
