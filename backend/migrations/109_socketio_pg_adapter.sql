-- Socket.IO postgres-adapter: Hilfstabelle fuer Event-Payloads ueber dem
-- NOTIFY-Limit (~8000 Bytes). Der Adapter synchronisiert io.emit()-Aufrufe
-- zwischen den beiden Backend-Replikas ueber Postgres NOTIFY/LISTEN.
-- Hintergrund: Ohne Adapter emittete jede
-- Replika nur an ihre EIGENEN Sockets — LiveUpdates und Chat-Events gingen
-- fuer Clients auf der jeweils anderen Replika systematisch verloren.
CREATE TABLE IF NOT EXISTS socket_io_attachments (
  id          bigserial UNIQUE,
  created_at  timestamptz DEFAULT NOW(),
  payload     bytea
);
