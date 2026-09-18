// Events routes
//
// Zur Einhänge-Reihenfolge: Die Teilmodule haben keine überlappenden
// Pfad-Muster (gleiche Methode UND gleiche Segmentzahl), mit einer Ausnahme:
// GET /cancelled und GET /:id liegen deshalb bewusst BEIDE in lesen.js,
// dort in der richtigen Reihenfolge. checkin.js steht als erstes, damit
// die alte Zusicherung "QR-Routen vor den /:id-Routen" erhalten bleibt.
const express = require('express');

module.exports = (db, rbacVerifier, roleHelpers, checkAndAwardBadges) => {
  const router = express.Router();

  // Check-in/QR: POST /qr-checkin, POST /:id/generate-qr, GET /:id/attendance-count
  router.use(require('./checkin')(db, rbacVerifier, roleHelpers, checkAndAwardBadges));
  // Lesen/Listen: GET /, GET /cancelled, GET /:id/timeslots, GET /:id
  router.use(require('./lesen')(db, rbacVerifier, roleHelpers));
  // Anlegen/Bearbeiten/Löschen/Absagen/Chat: POST /, PUT /:id, DELETE /:id,
  // POST /:id/chat, PUT /:id/cancel
  router.use(require('./verwaltung')(db, rbacVerifier, roleHelpers));
  // Buchung/Stornierung durch die Nutzer:innen: POST /:id/book,
  // DELETE /:id/book, GET /user/bookings
  router.use(require('./buchung')(db, rbacVerifier));
  // Teilnehmerverwaltung: POST /:id/participants, DELETE /:id/bookings/:bookingId,
  // PUT /:id/participants/:participantId/status
  router.use(require('./teilnehmer')(db, rbacVerifier, roleHelpers));
  // Serien: POST /series
  router.use(require('./serien')(db, rbacVerifier, roleHelpers));
  // Anwesenheit/Verbuchung: PUT /:id/participants/attendance-all,
  // PUT /:id/participants/:participantId/attendance
  router.use(require('./anwesenheit')(db, rbacVerifier, roleHelpers, checkAndAwardBadges));

  return router;
};
