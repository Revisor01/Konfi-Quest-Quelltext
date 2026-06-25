// apm.js — Leichtgewichtiges Application Performance Monitoring (in-memory).
//
// Sammelt pro Route-Schluessel (Methode + normalisierter Pfad) Anzahl, Fehlerrate
// und Antwortzeiten. Bewusst ohne externe Abhaengigkeit/DB: ein rollierendes
// Fenster der letzten N Dauer-Werte pro Route fuer eine p95-Naeherung. Reicht, um
// im Livebetrieb langsame/fehlerhafte Endpunkte zu erkennen, ohne Overhead.
//
// Zusaetzlich: Gauge fuer parallele (in-flight) Requests, ein rollierendes Log der
// letzten Fehler und ein 1-Sekunden-Bucket-Verlauf (Requests/Fehler pro Sekunde)
// fuer die letzten ~30 Minuten. Persistenz (Verlauf ueber Deploys hinweg) macht
// der BackgroundService via snapshot() -> apm_snapshots-Tabelle.

const SLOW_MS = 1000;          // Schwelle fuer "langsamer Request" (Log-Warnung)
const MAX_SAMPLES = 200;       // rollierende Dauer-Stichproben pro Route (p95)
const MAX_ERRORS = 50;         // rollierendes Fenster letzter Fehler
const HISTORY_SECONDS = 1800;  // Sekunden-Buckets (30 min) fuer Live-Verlauf

// Map<routeKey, { count, errors, totalMs, maxMs, samples: number[] }>
const stats = new Map();
const startedAt = Date.now();

// In-flight (parallele) Requests jetzt + beobachtetes Maximum.
let inFlight = 0;
let maxInFlight = 0;

// Rollierendes Fehler-Log (neueste zuletzt).
const recentErrors = [];

// Sekunden-Buckets fuer den Live-Verlauf: Map<epochSec, { requests, errors, sumMs }>
const buckets = new Map();

// Normalisiert den Pfad, damit IDs nicht zu tausenden Einzel-Routen explodieren:
// /api/admin/konfis/42 -> /api/admin/konfis/:id
function normalizePath(path) {
  return path
    .split('?')[0]
    .replace(/\/\d+/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:uuid');
}

function trimBuckets(nowSec) {
  const cutoff = nowSec - HISTORY_SECONDS;
  for (const sec of buckets.keys()) {
    if (sec < cutoff) buckets.delete(sec);
  }
}

function record(method, normPath, statusCode, durationMs, rawUrl) {
  const key = `${method} ${normPath}`;
  let s = stats.get(key);
  if (!s) {
    s = { count: 0, errors: 0, totalMs: 0, maxMs: 0, samples: [] };
    stats.set(key, s);
  }
  s.count += 1;
  s.totalMs += durationMs;
  if (durationMs > s.maxMs) s.maxMs = durationMs;
  const isError = statusCode >= 500;
  if (isError) s.errors += 1;
  s.samples.push(durationMs);
  if (s.samples.length > MAX_SAMPLES) s.samples.shift();

  // Sekunden-Bucket fuer den Verlauf
  const nowSec = Math.floor(Date.now() / 1000);
  let b = buckets.get(nowSec);
  if (!b) { b = { requests: 0, errors: 0, sumMs: 0 }; buckets.set(nowSec, b); }
  b.requests += 1;
  b.sumMs += durationMs;
  if (statusCode >= 400) b.errors += 1;
  if (buckets.size > HISTORY_SECONDS + 60) trimBuckets(nowSec);

  // Fehler (4xx + 5xx) ins rollierende Fehler-Log
  if (statusCode >= 400) {
    recentErrors.push({
      route: key,
      url: rawUrl,
      status: statusCode,
      durationMs: Math.round(durationMs),
      at: new Date().toISOString(),
    });
    if (recentErrors.length > MAX_ERRORS) recentErrors.shift();
  }
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

// Infrastruktur-Endpoints, die NICHT in die Nutzungsstatistik gehoeren:
// - /api/health: Docker- + Traefik-Loadbalancer-Healthchecks (bei 2 Replicas ~30/min,
//   sinnvoll fuers Zero-Downtime-Routing, aber keine echten Nutzeranfragen).
// - /api/status: Uptime-Kuma/Readiness-Polling.
// - /api/metrics*: das Dashboard selbst (Auto-Refresh alle 5s) wuerde sich sonst
//   in die eigene Statistik schreiben.
const IGNORED_PATHS = /^\/api\/(health|status|metrics)\b/;

// Express-Middleware: misst jede Request-Dauer, zaehlt parallele Requests,
// loggt langsame Requests. Infrastruktur-Pings (s.o.) werden uebersprungen.
function apmMiddleware(req, res, next) {
  if (IGNORED_PATHS.test((req.originalUrl || req.url || '').split('?')[0])) {
    return next();
  }
  const start = process.hrtime.bigint();
  inFlight += 1;
  if (inFlight > maxInFlight) maxInFlight = inFlight;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    inFlight -= 1;
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const rawUrl = req.originalUrl || req.url;
    record(req.method, normalizePath(rawUrl), res.statusCode, durationMs, rawUrl);
    if (durationMs > SLOW_MS) {
      console.warn(`[APM] LANGSAM ${Math.round(durationMs)}ms ${req.method} ${rawUrl} -> ${res.statusCode}`);
    }
  };
  res.on('finish', finish);
  res.on('close', finish);
  next();
}

// Route-Aggregate (sortierbar). limit=0 -> alle.
function routeRows() {
  const routes = [];
  for (const [route, s] of stats.entries()) {
    const sorted = [...s.samples].sort((a, b) => a - b);
    routes.push({
      route,
      count: s.count,
      errors: s.errors,
      errorRate: s.count ? +(s.errors / s.count).toFixed(4) : 0,
      avgMs: s.count ? Math.round(s.totalMs / s.count) : 0,
      p95Ms: Math.round(percentile(sorted, 95)),
      maxMs: Math.round(s.maxMs),
    });
  }
  return routes;
}

// Verlauf: pro Minute aggregierte Buckets der letzten `minutes` Minuten.
function timeline(minutes = 30) {
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - minutes * 60;
  const perMinute = new Map(); // Map<epochMinute, {requests,errors,sumMs}>
  for (const [sec, b] of buckets.entries()) {
    if (sec < fromSec) continue;
    const min = Math.floor(sec / 60) * 60;
    let m = perMinute.get(min);
    if (!m) { m = { requests: 0, errors: 0, sumMs: 0 }; perMinute.set(min, m); }
    m.requests += b.requests;
    m.errors += b.errors;
    m.sumMs += b.sumMs;
  }
  return [...perMinute.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([min, m]) => ({
      t: new Date(min * 1000).toISOString(),
      requests: m.requests,
      errors: m.errors,
      avgMs: m.requests ? Math.round(m.sumMs / m.requests) : 0,
    }));
}

// Requests pro Sekunde (Durchschnitt) ueber das letzte `windowSec`-Fenster.
function currentRps(windowSec = 10) {
  const nowSec = Math.floor(Date.now() / 1000);
  let sum = 0;
  for (let s = nowSec - windowSec; s <= nowSec; s++) {
    const b = buckets.get(s);
    if (b) sum += b.requests;
  }
  return +(sum / windowSec).toFixed(2);
}

// Kennung dieser Replica (Container-Hostname) — zur Lastverteilungs-Anzeige bei
// mehreren Backend-Replicas. HOSTNAME setzt Docker pro Container.
const REPLICA_ID = process.env.HOSTNAME || 'single';

// Vollstaendiges Aggregat DIESER Replica (in-memory). Bei mehreren Replicas mergen
// mergeSnapshots() die Einzel-Snapshots zu einem Gesamtbild.
function snapshot() {
  const routes = routeRows().sort((a, b) => b.p95Ms - a.p95Ms);
  let totalCount = 0;
  let totalErrors = 0;
  for (const r of routes) { totalCount += r.count; totalErrors += r.errors; }
  return {
    replica: REPLICA_ID,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    totalRequests: totalCount,
    totalErrors,
    errorRate: totalCount ? +(totalErrors / totalCount).toFixed(4) : 0,
    inFlight,
    maxInFlight,
    rps: currentRps(),
    routesSlowest: routes.slice(0, 20),
    routesBusiest: [...routes].sort((a, b) => b.count - a.count).slice(0, 20),
    recentErrors: [...recentErrors].reverse(),
    timeline: timeline(30),
  };
}

// Mergt mehrere Replica-Snapshots zu EINEM Gesamtbild + Lastverteilung pro Replica.
// Counts/Errors/inFlight werden summiert, p95/avg/max pro Route ueber die Replicas
// zusammengefasst (max p95, gewichteter avg), Timelines pro Minute addiert.
function mergeSnapshots(snaps) {
  const valid = snaps.filter(Boolean);
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    return { ...valid[0], replicas: [{ replica: valid[0].replica, requests: valid[0].totalRequests, inFlight: valid[0].inFlight, share: 1 }] };
  }

  // Routen ueber Replicas zusammenfassen (Key = route).
  const routeMap = new Map();
  const addRoutes = (rows) => {
    for (const r of rows) {
      const e = routeMap.get(r.route) || { route: r.route, count: 0, errors: 0, sumAvg: 0, p95Ms: 0, maxMs: 0 };
      e.count += r.count;
      e.errors += r.errors;
      e.sumAvg += r.avgMs * r.count;      // gewichteter Mittelwert ueber count
      e.p95Ms = Math.max(e.p95Ms, r.p95Ms);
      e.maxMs = Math.max(e.maxMs, r.maxMs);
      routeMap.set(r.route, e);
    }
  };
  valid.forEach(s => { addRoutes(s.routesSlowest || []); addRoutes(s.routesBusiest || []); });
  const routes = [...routeMap.values()].map(e => ({
    route: e.route,
    count: e.count,
    errors: e.errors,
    errorRate: e.count ? +(e.errors / e.count).toFixed(4) : 0,
    avgMs: e.count ? Math.round(e.sumAvg / e.count) : 0,
    p95Ms: e.p95Ms,
    maxMs: e.maxMs,
  }));

  // Timeline pro Minute (ISO-Zeit) addieren.
  const tlMap = new Map();
  valid.forEach(s => (s.timeline || []).forEach(p => {
    const e = tlMap.get(p.t) || { t: p.t, requests: 0, errors: 0, sumAvg: 0 };
    e.requests += p.requests;
    e.errors += p.errors;
    e.sumAvg += p.avgMs * p.requests;
    tlMap.set(p.t, e);
  }));
  const timelineMerged = [...tlMap.values()]
    .sort((a, b) => new Date(a.t) - new Date(b.t))
    .map(e => ({ t: e.t, requests: e.requests, errors: e.errors, avgMs: e.requests ? Math.round(e.sumAvg / e.requests) : 0 }));

  const totalRequests = valid.reduce((s, x) => s + x.totalRequests, 0);
  const totalErrors = valid.reduce((s, x) => s + x.totalErrors, 0);
  const recentErrors = valid.flatMap(x => x.recentErrors || [])
    .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 50);

  return {
    uptimeSeconds: Math.max(...valid.map(x => x.uptimeSeconds)),
    totalRequests,
    totalErrors,
    errorRate: totalRequests ? +(totalErrors / totalRequests).toFixed(4) : 0,
    inFlight: valid.reduce((s, x) => s + x.inFlight, 0),
    maxInFlight: valid.reduce((s, x) => s + x.maxInFlight, 0),
    rps: +valid.reduce((s, x) => s + x.rps, 0).toFixed(2),
    routesSlowest: [...routes].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 20),
    routesBusiest: [...routes].sort((a, b) => b.count - a.count).slice(0, 20),
    recentErrors,
    timeline: timelineMerged,
    // Lastverteilung: Anteil der Requests pro Replica.
    replicas: valid.map(x => ({
      replica: x.replica,
      requests: x.totalRequests,
      inFlight: x.inFlight,
      share: totalRequests ? +(x.totalRequests / totalRequests).toFixed(3) : 0,
    })),
  };
}

// Kompaktes Objekt fuer die persistente Historie (apm_snapshots-Tabelle).
function persistSummary() {
  const routes = routeRows();
  let totalCount = 0;
  let totalErrors = 0;
  let worstP95 = 0;
  let worstRoute = null;
  for (const r of routes) {
    totalCount += r.count;
    totalErrors += r.errors;
    if (r.p95Ms > worstP95) { worstP95 = r.p95Ms; worstRoute = r.route; }
  }
  return {
    totalRequests: totalCount,
    totalErrors,
    maxInFlight,
    worstP95Ms: worstP95,
    worstRoute,
  };
}

module.exports = { apmMiddleware, snapshot, mergeSnapshots, persistSummary, REPLICA_ID };
