import { FARBEN, METRIK_AMPEL } from '../../../theme/colors';
import {
  ICON_AKTION,
  ICON_AKTUALISIEREN,
  ICON_NETZWERK,
  ICON_PULS,
  ICON_STUFEN,
  ICON_TACHO,
  ICON_UHRZEIT,
  ICON_WARNHINWEIS,
  ICON_WARNUNG,
  ICON_ZURUECK,
} from '../../shared/icons';
import { fehlerStatus } from '../../../utils/fehler';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSpinner,
  IonToggle
} from '@ionic/react';
import api from '../../../services/api';
import { triggerPullHaptic } from '../../../utils/haptics';

interface RouteRow {
  route: string;
  count: number;
  errors: number;
  errorRate: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  notModified?: number;
  cacheQuote?: number;
}
interface TimelinePoint { t: string; requests: number; errors: number; avgMs: number; }
interface ErrorRow { route: string; url: string; status: number; durationMs: number; at: string; }
interface Snapshot {
  uptimeSeconds: number;
  totalRequests: number;
  // Anfragen, die mit 304 beantwortet wurden: Der Client hatte die Daten
  // schon, es ging nur die Rueckfrage ueber die Leitung.
  totalNotModified?: number;
  cacheQuote?: number;
  totalErrors: number;
  errorRate: number;
  inFlight: number;
  maxInFlight: number;
  rps: number;
  routesSlowest: RouteRow[];
  routesBusiest: RouteRow[];
  recentErrors: ErrorRow[];
  timeline: TimelinePoint[];
  replicas?: { replica: string; requests: number; inFlight: number; share: number }[];
}
interface HistorySnap {
  captured_at: string;
  total_requests: number;
  total_errors: number;
  max_in_flight: number;
  worst_p95_ms: number;
  worst_route: string | null;
}

const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const msColor = (ms: number) => ms >= 1000 ? METRIK_AMPEL.kritisch : ms >= 500 ? METRIK_AMPEL.erhoeht : ms >= 200 ? METRIK_AMPEL.maessig : METRIK_AMPEL.gut;
const statusColor = (s: number) => s >= 500 ? METRIK_AMPEL.kritisch : s >= 400 ? METRIK_AMPEL.erhoeht : METRIK_AMPEL.gut;

// Kleines KPI-Kaestchen
const Kpi: React.FC<{ icon: string; label: string; value: string; color: string; sub?: string }> = ({ icon, label, value, color, sub }) => (
  <div style={{ flex: '1 1 140px', background: 'white', borderRadius: 'var(--app-radius-weich)', padding: 'var(--app-abstand-mittelweit)', boxShadow: 'var(--app-schatten-fein)', minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-kompakt)', color: 'var(--app-text-system)', fontSize: 'var(--app-text-klein)', fontWeight: 'var(--app-schrift-halbfett)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
      <IonIcon icon={icon} style={{ color, fontSize: 'var(--app-text-standard)' }} />
      {label}
    </div>
    <div style={{ fontSize: 'var(--app-text-ueberschrift-gross)', fontWeight: 'var(--app-schrift-fett)', color: 'var(--app-text-emphasis)', marginTop: 'var(--app-abstand-mini)', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    {sub && <div style={{ fontSize: 'var(--app-text-meta)', color: 'var(--app-text-system)', marginTop: 'var(--app-abstand-winzig)' }}>{sub}</div>}
  </div>
);

// Verlaufs-Chart (Requests pro Minute, Fehler rot ueberlagert) — reines SVG.
const TimelineChart: React.FC<{ data: TimelinePoint[] }> = ({ data }) => {
  if (data.length === 0) return <div style={{ color: 'var(--app-text-system)', textAlign: 'center', padding: 'var(--app-abstand-gross)', fontSize: 'var(--app-text-sekundaer)' }}>Noch keine Verlaufsdaten (sammelt sich live).</div>;
  const W = 320, H = 90, pad = 4;
  const max = Math.max(1, ...data.map(d => d.requests));
  const bw = (W - pad * 2) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = (d.requests / max) * (H - 16);
        const eh = (d.errors / max) * (H - 16);
        const x = pad + i * bw;
        return (
          <g key={i}>
            <rect x={x} y={H - h} width={Math.max(1, bw - 1)} height={h} fill={FARBEN.chat} opacity={0.75} rx={1} />
            {d.errors > 0 && <rect x={x} y={H - eh} width={Math.max(1, bw - 1)} height={eh} fill={FARBEN.danger} rx={1} />}
          </g>
        );
      })}
      <text x={pad} y={10} fontSize="8" fill={FARBEN.textSystem}>{max} req/min max</text>
    </svg>
  );
};

const RouteTable: React.FC<{ rows: RouteRow[]; mode: 'slow' | 'busy' }> = ({ rows, mode }) => (
  <div style={{ background: 'white', borderRadius: 'var(--app-radius-weich)', overflow: 'hidden', boxShadow: 'var(--app-schatten-fein)' }}>
    {rows.length === 0 && <div style={{ padding: 'var(--app-abstand-basis)', color: 'var(--app-text-system)', fontSize: 'var(--app-text-sekundaer)' }}>Keine Daten.</div>}
    {rows.map((r, i) => (
      <div key={r.route} style={{ padding: 'var(--app-abstand-schmal) var(--app-abstand-mittel)', borderTop: i ? '1px solid var(--app-surface-dim)' : 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--app-abstand-eng)' }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-emphasis)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{r.route}</span>
          {mode === 'slow'
            ? <span style={{ fontWeight: 'var(--app-schrift-fett)', fontSize: 'var(--app-text-sekundaer)', color: msColor(r.p95Ms), flexShrink: 0 }}>{r.p95Ms}ms</span>
            : <span style={{ fontWeight: 'var(--app-schrift-fett)', fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-color-chat)', flexShrink: 0 }}>{r.count}×</span>}
        </div>
        {/* Erste Zeile: was der SERVER gebraucht hat — die einzige Zahl, an
            der eine Backend-Aenderung etwas dreht. */}
        <div style={{ display: 'flex', gap: 'var(--app-abstand-mittel)', marginTop: 'var(--app-abstand-mini)', fontSize: 'var(--app-text-meta)', color: 'var(--app-text-system)' }}>
          <span>{r.count}× Aufrufe</span>
          <span>Ø {r.avgMs}ms</span>
          <span>p95 {r.p95Ms}ms</span>
          <span>max {r.maxMs}ms</span>
          {r.errors > 0 && <span style={{ color: 'var(--app-color-danger)', fontWeight: 'var(--app-schrift-halbfett)'}}>{r.errors} Fehler</span>}
        </div>
        {/* Die Zeiten laufen bis zur AUSLIEFERUNG beim Client und enthalten
            damit die Verbindung des Geraets. Eine Trennung Server/Leitung
            gab es hier kurzzeitig — sie war falsch gemessen (von
            Middleware-Eintritt bis res.end, also inklusive Warten auf den
            Client) und zeigte bei 20 von 20 Routen zweimal dieselbe Zahl.
            Lieber eine ehrliche Zahl als zwei, von denen eine luegt. */}
        <div style={{ display: 'flex', gap: 'var(--app-abstand-mittel)', marginTop: 'var(--app-abstand-winzig)', fontSize: 'var(--app-text-meta)', color: METRIK_AMPEL.blass }}>
          {r.cacheQuote !== undefined && r.cacheQuote > 0 && (
            <span style={{ color: r.cacheQuote >= 50 ? METRIK_AMPEL.gut : METRIK_AMPEL.blass }}>
              {r.cacheQuote}% aus dem Cache
            </span>
          )}
        </div>
      </div>
    ))}
  </div>
);

const AdminMetricsPage: React.FC = () => {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<HistorySnap[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'slow' | 'busy' | 'errors' | 'history'>('slow');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (withHistory = false) => {
    try {
      // Zwei Endpunkte mit unterschiedlicher Antwortform: der zweite wird nur
      // bei withHistory geholt, deshalb die Union statt eines gemeinsamen Typs.
      const [m, h] = await Promise.all([
        api.get<Snapshot>('/metrics'),
        withHistory
          ? api.get<{ snapshots?: HistorySnap[] }>('/metrics/history?days=7')
          : Promise.resolve(null),
      ]);
      setSnap(m.data);
      if (h) setHistory(h.data.snapshots || []);
      setError(null);
    } catch (e) {
      setError(fehlerStatus(e) === 403 ? 'Nur für Super-Admins.' : 'Metrics konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(true); }, [load]);

  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (autoRefresh) {
      timerRef.current = setInterval(() => load(false), 5000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, load]);

  // Historie-Deltas: Differenz aufeinanderfolgender Snapshots (Reset bei Deploy -> Delta 0).
  const historyDeltas = history.map((s, i) => {
    if (i === 0) return null;
    const prev = history[i - 1];
    const dReq = s.total_requests - prev.total_requests;
    const dErr = s.total_errors - prev.total_errors;
    return {
      at: s.captured_at,
      requests: dReq >= 0 ? dReq : s.total_requests,
      errors: dErr >= 0 ? dErr : s.total_errors,
      worstP95: s.worst_p95_ms,
      worstRoute: s.worst_route,
    };
  }).filter(Boolean) as { at: string; requests: number; errors: number; worstP95: number; worstRoute: string | null }[];

  return (
    <IonPage>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton aria-label="Zurück" onClick={() => window.history.back()}><IonIcon icon={ICON_ZURUECK} /></IonButton>
          </IonButtons>
          <IonTitle>Performance</IonTitle>
          <IonButtons slot="end">
            <IonButton aria-label="Daten neu laden" onClick={() => load(true)}><IonIcon icon={ICON_AKTUALISIEREN} /></IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar"><IonTitle size="large">Performance</IonTitle></IonToolbar>
        </IonHeader>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await load(true); e.detail.complete(); }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        {loading && !snap ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-freiraum-kopf-m)' }}><IonSpinner /></div>
        ) : error ? (
          <div style={{ padding: 'var(--app-abstand-riesig) var(--app-abstand-gross)', textAlign: 'center', color: 'var(--app-color-danger)' }}>
            <IonIcon icon={ICON_WARNUNG} style={{ fontSize: 'var(--app-anzeige-gross)' }} /><p>{error}</p>
          </div>
        ) : snap ? (
          <div style={{ padding: 'var(--app-abstand-mittel) var(--app-abstand-basis) var(--app-abstand-extraweit)' }}>

            {/* Auto-Refresh-Schalter */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--app-abstand-mittel)', fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-secondary)' }}>
              <span>Server-Laufzeit: <b>{fmtUptime(snap.uptimeSeconds)}</b></span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-kompakt)' }}>
                Auto (5s)
                <IonToggle checked={autoRefresh} onIonChange={(e) => setAutoRefresh(e.detail.checked)} />
              </span>
            </div>

            {/* KPI-Karten */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--app-abstand-schmal)', marginBottom: 'var(--app-abstand-basis)' }}>
              <Kpi icon={ICON_PULS} label="Requests" value={String(snap.totalRequests)} color="var(--app-color-chat)" sub={`seit Start`} />
              <Kpi icon={ICON_AKTION} label="Parallel" value={String(snap.inFlight)} color="var(--app-color-wrapped)" sub={`max ${snap.maxInFlight}`} />
              <Kpi icon={ICON_TACHO} label="Req/Sek" value={String(snap.rps)} color="var(--app-color-chat-dunkel)" sub="Ø letzte 10s" />
              <Kpi icon={ICON_WARNHINWEIS} label="Fehlerrate" value={`${(snap.errorRate * 100).toFixed(1)}%`} color={snap.totalErrors ? METRIK_AMPEL.kritisch : METRIK_AMPEL.gut} sub={`${snap.totalErrors} Fehler (5xx)`} />
              {snap.cacheQuote !== undefined && (
                /* Anteil 304: Der Client hatte die Daten schon. HOCH IST GUT —
                   dann gingen keine Nutzdaten ueber die Leitung. Gruen ab 50 %. */
                <Kpi
                  icon={ICON_STUFEN}
                  label="Aus dem Cache"
                  value={`${snap.cacheQuote}%`}
                  color={snap.cacheQuote >= 50 ? METRIK_AMPEL.gut : snap.cacheQuote >= 25 ? METRIK_AMPEL.maessig : METRIK_AMPEL.blass}
                  sub={`${snap.totalNotModified ?? 0}× ohne Daten (304)`}
                />
              )}
            </div>

            {/* Lastverteilung ueber die Backend-Replicas (nur bei >1 Replica) */}
            {snap.replicas && snap.replicas.length > 1 && (
              <div style={{ background: 'white', borderRadius: 'var(--app-radius-weich)', padding: 'var(--app-abstand-mittel)', marginBottom: 'var(--app-abstand-basis)', boxShadow: 'var(--app-schatten-fein)' }}>
                <div style={{ fontSize: 'var(--app-text-hinweis)', fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-secondary)', marginBottom: 'var(--app-abstand-eng)', display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-kompakt)' }}>
                  <IonIcon icon={ICON_NETZWERK} style={{ color: 'var(--app-color-wrapped)' }} /> Lastverteilung ({snap.replicas.length} Replicas)
                </div>
                {snap.replicas.map((r, i) => (
                  <div key={r.replica} style={{ marginBottom: i < snap.replicas!.length - 1 ? 'var(--app-abstand-eng)' : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--app-text-hinweis)', marginBottom: 'var(--app-abstand-mini)' }}>
                      <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--app-text-body)' }}>{r.replica.slice(0, 12)}</span>
                      <span style={{ color: 'var(--app-text-secondary)' }}>{r.requests} req · {(r.share * 100).toFixed(0)}% · {r.inFlight} aktiv</span>
                    </div>
                    <div style={{ height: '8px', background: 'var(--app-border-soft)', borderRadius: 'var(--app-radius-fein)', overflow: 'hidden' }}>
                      <div style={{ width: `${r.share * 100}%`, height: '100%', background: i === 0 ? 'var(--app-color-chat)' : 'var(--app-color-wrapped)', borderRadius: 'var(--app-radius-fein)' }} />
                    </div>
                  </div>
                ))}
                {/* Hinweis auf Schieflast, wenn eine Replica >70% traegt */}
                {snap.replicas.some(r => r.share > 0.7) && (
                  <div style={{ fontSize: 'var(--app-text-meta)', color: METRIK_AMPEL.erhoeht, marginTop: 'var(--app-abstand-kompakt)' }}>
                    Hinweis: Last ungleich verteilt — eine Replica trägt den Großteil.
                  </div>
                )}
              </div>
            )}

            {/* Verlauf */}
            <div style={{ background: 'white', borderRadius: 'var(--app-radius-weich)', padding: 'var(--app-abstand-mittel)', marginBottom: 'var(--app-abstand-basis)', boxShadow: 'var(--app-schatten-fein)' }}>
              <div style={{ fontSize: 'var(--app-text-hinweis)', fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-secondary)', marginBottom: 'var(--app-abstand-kompakt)', display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-kompakt)' }}>
                <IonIcon icon={ICON_UHRZEIT} style={{ color: 'var(--app-color-chat)' }} /> Requests/Min (letzte 30 Min) — <span style={{ color: 'var(--app-color-danger)' }}>rot = Fehler</span>
              </div>
              <TimelineChart data={snap.timeline} />
            </div>

            {/* Tabs */}
            <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value as 'slow' | 'busy' | 'errors' | 'history')} style={{ marginBottom: 'var(--app-abstand-mittel)' }}>
              <IonSegmentButton value="slow"><IonLabel>Langsam</IonLabel></IonSegmentButton>
              <IonSegmentButton value="busy"><IonLabel>Häufig</IonLabel></IonSegmentButton>
              <IonSegmentButton value="errors"><IonLabel>Fehler ({snap.recentErrors.length})</IonLabel></IonSegmentButton>
              <IonSegmentButton value="history"><IonLabel>Verlauf</IonLabel></IonSegmentButton>
            </IonSegment>

            {tab === 'slow' && <RouteTable rows={snap.routesSlowest} mode="slow" />}
            {tab === 'busy' && <RouteTable rows={snap.routesBusiest} mode="busy" />}

            {tab === 'errors' && (
              <div style={{ background: 'white', borderRadius: 'var(--app-radius-weich)', overflow: 'hidden', boxShadow: 'var(--app-schatten-fein)' }}>
                {snap.recentErrors.length === 0 ? (
                  <div style={{ padding: 'var(--app-abstand-weit)', textAlign: 'center', color: METRIK_AMPEL.gut, fontSize: 'var(--app-text-basis)' }}>
                    <IonIcon icon={ICON_PULS} style={{ fontSize: 'var(--app-anzeige-zahl)' }} /><div>Keine Fehler erfasst.</div>
                  </div>
                ) : snap.recentErrors.map((er, i) => (
                  <div key={i} style={{ padding: 'var(--app-abstand-schmal) var(--app-abstand-mittel)', borderTop: i ? '1px solid var(--app-surface-dim)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--app-abstand-eng)' }}>
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--app-text-hinweis)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{er.url}</span>
                      <span style={{ fontWeight: 'var(--app-schrift-fett)', fontSize: 'var(--app-text-hinweis)', color: statusColor(er.status), flexShrink: 0 }}>{er.status}</span>
                    </div>
                    <div style={{ fontSize: 'var(--app-text-meta)', color: 'var(--app-text-system)', marginTop: 'var(--app-abstand-winzig)' }}>{fmtTime(er.at)} · {er.durationMs}ms</div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'history' && (
              <div style={{ background: 'white', borderRadius: 'var(--app-radius-weich)', overflow: 'hidden', boxShadow: 'var(--app-schatten-fein)' }}>
                <div style={{ padding: 'var(--app-abstand-schmal) var(--app-abstand-mittel)', fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', borderBottom: '1px solid var(--app-surface-dim)' }}>
                  Persistente Historie (5-Min-Intervalle, übersteht Deploys)
                </div>
                {historyDeltas.length === 0 ? (
                  <div style={{ padding: 'var(--app-abstand-gross)', color: 'var(--app-text-system)', fontSize: 'var(--app-text-sekundaer)', textAlign: 'center' }}>Noch keine Historie (erster Snapshot nach ~5 Min).</div>
                ) : [...historyDeltas].reverse().slice(0, 60).map((d, i) => (
                  <div key={i} style={{ padding: 'var(--app-abstand-eng) var(--app-abstand-mittel)', borderTop: i ? '1px solid var(--app-surface-dim)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--app-abstand-eng)' }}>
                    <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-secondary)', flexShrink: 0 }}>{fmtDateTime(d.at)}</span>
                    <span style={{ display: 'flex', gap: 'var(--app-abstand-schmal)', fontSize: 'var(--app-text-klein)' }}>
                      <span style={{ color: 'var(--app-color-chat)' }}>{d.requests} req</span>
                      {d.errors > 0 && <span style={{ color: 'var(--app-color-danger)', fontWeight: 'var(--app-schrift-halbfett)'}}>{d.errors} err</span>}
                      <span style={{ color: msColor(d.worstP95) }}>{d.worstP95}ms</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </IonContent>
    </IonPage>
  );
};

export default AdminMetricsPage;
