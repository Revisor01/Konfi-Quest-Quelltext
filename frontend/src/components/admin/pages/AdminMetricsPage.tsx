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
import { arrowBack, pulseOutline, refreshOutline, warningOutline, flashOutline, timeOutline, alertCircleOutline, speedometerOutline, gitNetworkOutline } from 'ionicons/icons';
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
}
interface TimelinePoint { t: string; requests: number; errors: number; avgMs: number; }
interface ErrorRow { route: string; url: string; status: number; durationMs: number; at: string; }
interface Snapshot {
  uptimeSeconds: number;
  totalRequests: number;
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

const msColor = (ms: number) => ms >= 1000 ? '#dc3545' : ms >= 500 ? '#fd7e14' : ms >= 200 ? '#f0ad4e' : '#28a745';
const statusColor = (s: number) => s >= 500 ? '#dc3545' : s >= 400 ? '#fd7e14' : '#28a745';

// Kleines KPI-Kaestchen
const Kpi: React.FC<{ icon: string; label: string; value: string; color: string; sub?: string }> = ({ icon, label, value, color, sub }) => (
  <div style={{ flex: '1 1 140px', background: '#fff', borderRadius: '14px', padding: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#8e8e93', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
      <IonIcon icon={icon} style={{ color, fontSize: '1rem' }} />
      {label}
    </div>
    <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#1a1a1a', marginTop: '4px', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    {sub && <div style={{ fontSize: '0.72rem', color: '#8e8e93', marginTop: '2px' }}>{sub}</div>}
  </div>
);

// Verlaufs-Chart (Requests pro Minute, Fehler rot ueberlagert) — reines SVG.
const TimelineChart: React.FC<{ data: TimelinePoint[] }> = ({ data }) => {
  if (data.length === 0) return <div style={{ color: '#8e8e93', textAlign: 'center', padding: '20px', fontSize: '0.85rem' }}>Noch keine Verlaufsdaten (sammelt sich live).</div>;
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
            <rect x={x} y={H - h} width={Math.max(1, bw - 1)} height={h} fill="#06b6d4" opacity={0.75} rx={1} />
            {d.errors > 0 && <rect x={x} y={H - eh} width={Math.max(1, bw - 1)} height={eh} fill="#dc3545" rx={1} />}
          </g>
        );
      })}
      <text x={pad} y={10} fontSize="8" fill="#8e8e93">{max} req/min max</text>
    </svg>
  );
};

const RouteTable: React.FC<{ rows: RouteRow[]; mode: 'slow' | 'busy' }> = ({ rows, mode }) => (
  <div style={{ background: '#fff', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
    {rows.length === 0 && <div style={{ padding: '16px', color: '#8e8e93', fontSize: '0.85rem' }}>Keine Daten.</div>}
    {rows.map((r, i) => (
      <div key={r.route} style={{ padding: '10px 12px', borderTop: i ? '1px solid #f0f0f0' : 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{r.route}</span>
          {mode === 'slow'
            ? <span style={{ fontWeight: 700, fontSize: '0.85rem', color: msColor(r.p95Ms), flexShrink: 0 }}>{r.p95Ms}ms</span>
            : <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#06b6d4', flexShrink: 0 }}>{r.count}×</span>}
        </div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '3px', fontSize: '0.72rem', color: '#8e8e93' }}>
          <span>{r.count}× Aufrufe</span>
          <span>Ø {r.avgMs}ms</span>
          <span>p95 {r.p95Ms}ms</span>
          <span>max {r.maxMs}ms</span>
          {r.errors > 0 && <span style={{ color: '#dc3545', fontWeight: 600 }}>{r.errors} Fehler</span>}
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
      const reqs: Promise<any>[] = [api.get('/metrics')];
      if (withHistory) reqs.push(api.get('/metrics/history?days=7'));
      const [m, h] = await Promise.all(reqs);
      setSnap(m.data);
      if (h) setHistory(h.data.snapshots || []);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.status === 403 ? 'Nur für Super-Admins.' : 'Metrics konnten nicht geladen werden.');
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
            <IonButton onClick={() => window.history.back()}><IonIcon icon={arrowBack} /></IonButton>
          </IonButtons>
          <IonTitle>Performance</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => load(true)}><IonIcon icon={refreshOutline} /></IonButton>
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
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><IonSpinner /></div>
        ) : error ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#dc3545' }}>
            <IonIcon icon={warningOutline} style={{ fontSize: '2.5rem' }} /><p>{error}</p>
          </div>
        ) : snap ? (
          <div style={{ padding: '12px 16px 32px' }}>

            {/* Auto-Refresh-Schalter */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', fontSize: '0.85rem', color: '#666' }}>
              <span>Server-Laufzeit: <b>{fmtUptime(snap.uptimeSeconds)}</b></span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Auto (5s)
                <IonToggle checked={autoRefresh} onIonChange={(e) => setAutoRefresh(e.detail.checked)} />
              </span>
            </div>

            {/* KPI-Karten */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
              <Kpi icon={pulseOutline} label="Requests" value={String(snap.totalRequests)} color="#06b6d4" sub={`seit Start`} />
              <Kpi icon={flashOutline} label="Parallel" value={String(snap.inFlight)} color="#7c3aed" sub={`max ${snap.maxInFlight}`} />
              <Kpi icon={speedometerOutline} label="Req/Sek" value={String(snap.rps)} color="#0891b2" sub="Ø letzte 10s" />
              <Kpi icon={alertCircleOutline} label="Fehlerrate" value={`${(snap.errorRate * 100).toFixed(1)}%`} color={snap.totalErrors ? '#dc3545' : '#28a745'} sub={`${snap.totalErrors} Fehler (5xx)`} />
            </div>

            {/* Lastverteilung ueber die Backend-Replicas (nur bei >1 Replica) */}
            {snap.replicas && snap.replicas.length > 1 && (
              <div style={{ background: '#fff', borderRadius: '14px', padding: '12px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#666', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <IonIcon icon={gitNetworkOutline} style={{ color: '#7c3aed' }} /> Lastverteilung ({snap.replicas.length} Replicas)
                </div>
                {snap.replicas.map((r, i) => (
                  <div key={r.replica} style={{ marginBottom: i < snap.replicas!.length - 1 ? '8px' : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '3px' }}>
                      <span style={{ fontFamily: 'ui-monospace, monospace', color: '#444' }}>{r.replica.slice(0, 12)}</span>
                      <span style={{ color: '#666' }}>{r.requests} req · {(r.share * 100).toFixed(0)}% · {r.inFlight} aktiv</span>
                    </div>
                    <div style={{ height: '8px', background: '#eee', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: `${r.share * 100}%`, height: '100%', background: i === 0 ? '#06b6d4' : '#7c3aed', borderRadius: '4px' }} />
                    </div>
                  </div>
                ))}
                {/* Hinweis auf Schieflast, wenn eine Replica >70% traegt */}
                {snap.replicas.some(r => r.share > 0.7) && (
                  <div style={{ fontSize: '0.72rem', color: '#fd7e14', marginTop: '6px' }}>
                    Hinweis: Last ungleich verteilt — eine Replica trägt den Großteil.
                  </div>
                )}
              </div>
            )}

            {/* Verlauf */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '12px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#666', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IonIcon icon={timeOutline} style={{ color: '#06b6d4' }} /> Requests/Min (letzte 30 Min) — <span style={{ color: '#dc3545' }}>rot = Fehler</span>
              </div>
              <TimelineChart data={snap.timeline} />
            </div>

            {/* Tabs */}
            <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value as any)} style={{ marginBottom: '12px' }}>
              <IonSegmentButton value="slow"><IonLabel>Langsam</IonLabel></IonSegmentButton>
              <IonSegmentButton value="busy"><IonLabel>Häufig</IonLabel></IonSegmentButton>
              <IonSegmentButton value="errors"><IonLabel>Fehler ({snap.recentErrors.length})</IonLabel></IonSegmentButton>
              <IonSegmentButton value="history"><IonLabel>Verlauf</IonLabel></IonSegmentButton>
            </IonSegment>

            {tab === 'slow' && <RouteTable rows={snap.routesSlowest} mode="slow" />}
            {tab === 'busy' && <RouteTable rows={snap.routesBusiest} mode="busy" />}

            {tab === 'errors' && (
              <div style={{ background: '#fff', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                {snap.recentErrors.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#28a745', fontSize: '0.9rem' }}>
                    <IonIcon icon={pulseOutline} style={{ fontSize: '2rem' }} /><div>Keine Fehler erfasst.</div>
                  </div>
                ) : snap.recentErrors.map((er, i) => (
                  <div key={i} style={{ padding: '10px 12px', borderTop: i ? '1px solid #f0f0f0' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{er.url}</span>
                      <span style={{ fontWeight: 700, fontSize: '0.8rem', color: statusColor(er.status), flexShrink: 0 }}>{er.status}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#8e8e93', marginTop: '2px' }}>{fmtTime(er.at)} · {er.durationMs}ms</div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'history' && (
              <div style={{ background: '#fff', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <div style={{ padding: '10px 12px', fontSize: '0.75rem', color: '#8e8e93', borderBottom: '1px solid #f0f0f0' }}>
                  Persistente Historie (5-Min-Intervalle, übersteht Deploys)
                </div>
                {historyDeltas.length === 0 ? (
                  <div style={{ padding: '20px', color: '#8e8e93', fontSize: '0.85rem', textAlign: 'center' }}>Noch keine Historie (erster Snapshot nach ~5 Min).</div>
                ) : [...historyDeltas].reverse().slice(0, 60).map((d, i) => (
                  <div key={i} style={{ padding: '8px 12px', borderTop: i ? '1px solid #f0f0f0' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.76rem', color: '#666', flexShrink: 0 }}>{fmtDateTime(d.at)}</span>
                    <span style={{ display: 'flex', gap: '10px', fontSize: '0.76rem' }}>
                      <span style={{ color: '#06b6d4' }}>{d.requests} req</span>
                      {d.errors > 0 && <span style={{ color: '#dc3545', fontWeight: 600 }}>{d.errors} err</span>}
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
