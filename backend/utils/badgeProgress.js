// WAS HIER STEHT und was nicht:
// Die ZAEHL-Queries bleiben bewusst bei den Aufrufern. Sie sind pro Rolle
// fachlich verschieden — Konfis haben Punktekonten und Pflichttermine,
// Teamer:innen gezaehlte target_role='teamer'-Aktivitaeten und Dienstjahre.
// Eine gemeinsame Funktion mit einem Rollen-Schalter waere die alte Kopie
// mit einem `if` davor gewesen.
//
// Gemeinsam ist das Drumherum: aus fertigen Zaehlern einen Fortschritt
// rechnen, und pruefen, ob ein Abzeichen ueberhaupt erreichbar ist. Genau
// das steht hier.
//
// EINE NAMENSFALLE, die den Umbau noetig gemacht hat: Beide Pfade hatten
// eine Variable `activityCount` — beim Konfi zaehlt sie NUR Aktivitaeten
// (Events kommen separat dazu), beim Teamer enthaelt sie Aktivitaeten UND
// Events bereits. Gleicher Name, andere Bedeutung. Das Zaehler-Objekt hier
// heisst deshalb `aktivitaetenUndEvents` statt `activityCount`: Der Aufrufer
// muss beim Befuellen entscheiden, was er meint.
//
// KONSISTENZ-VERTRAG: Was hier gerechnet wird, muss zur Wertung in
// badges.js (checkAndAwardBadges / checkAndAwardTeamerBadges) passen. Sonst
// zeigt die App 10/10, ohne dass das Abzeichen kommt.

/**
 * Liest `criteria_extra` robust — egal ob als JSON-Text oder als Objekt.
 *
 * Warum mit Auffangnetz: Ein kaputtes criteria_extra darf hoechstens EIN
 * Abzeichen auf 0 setzen, nicht die ganze Antwort zerreissen. Im Teamer-Pfad
 * fehlte dieser Schutz und ein einziger defekter Datensatz haette die
 * komplette Abzeichen-Seite in den 500 laufen lassen.
 *
 * @param {object|string|null} criteriaExtra
 * @returns {{extra: object, kaputt: boolean}}
 */
function liesCriteriaExtra(criteriaExtra) {
  if (criteriaExtra && typeof criteriaExtra === 'object') {
    return { extra: criteriaExtra, kaputt: false };
  }
  try {
    return { extra: JSON.parse(criteriaExtra || '{}') || {}, kaputt: false };
  } catch {
    return { extra: {}, kaputt: true };
  }
}

/**
 * Fehlt einem Abzeichen die Bedingung, die es ueberhaupt erst erreichbar
 * macht?
 *
 * Die Wertung prueft `required_activity_name` bzw. `required_activities`;
 * ohne die passiert schlicht nichts. In Org 1 standen so zehn aktive
 * Abzeichen, von denen keines je vergeben wurde.
 *
 * Rollenneutral: Ein Teamer-Abzeichen ohne hinterlegten Aktivitaetsnamen ist
 * genauso unerreichbar wie ein Konfi-Abzeichen ohne.
 *
 * @param {object} badge
 * @returns {boolean}
 */
function bedingungFehlt(badge) {
  const { extra, kaputt } = liesCriteriaExtra(badge.criteria_extra);
  if (kaputt) return true;

  switch (badge.criteria_type) {
    case 'specific_activity':
      return !extra.required_activity_name;
    case 'activity_combination':
      return !Array.isArray(extra.required_activities) || extra.required_activities.length === 0;
    case 'category_activities':
      return !extra.required_category;
    default:
      return false;
  }
}

/**
 * Rechnet den Fortschritt EINES Abzeichens aus fertigen Zaehlern.
 *
 * @param {object} badge  Datensatz aus custom_badges (criteria_type,
 *   criteria_value, criteria_extra).
 * @param {object} z  Zaehler-Objekt des Aufrufers. Alle Felder sind
 *   optional; was fehlt, zaehlt als 0. Erwartete Felder:
 *   - aktivitaetenUndEvents {number}  fuer 'activity_count'. ACHTUNG: der
 *     Aufrufer addiert selbst, was zu seiner Wertung passt.
 *   - events {number}                 fuer 'event_count'
 *   - pflichtEvents {number}          fuer 'mandatory_event_count'
 *   - verschiedeneAktivitaeten {number} fuer 'unique_activities'
 *   - teamerJahre {number}            fuer 'teamer_year'
 *   - punkteGesamt / punkteGottesdienst / punkteGemeinde / punkteBonus {number}
 *   - beideKategorien {number|null}   fuer 'both_categories'; null heisst
 *     "nicht anwendbar" und ergibt 0
 *   - proKategorie {Map}              Kategoriename -> Anzahl
 *   - proAktivitaetsname {Map}        Aktivitaetsname -> Anzahl
 *   - erfuellteEventTitel {Set}       fuer 'activity_combination', optional:
 *     zaehlt required_events mit (nur der Teamer-Pfad nutzt das)
 *   - streak {number}
 *   - alleDaten {Array<string|Date>}  fuer 'time_based'
 * @returns {{current: number, target: number, percentage: number}}
 *   percentage ist UNGERUNDET (0-100) — die Aufrufer runden, wie ihre
 *   Ansicht es braucht.
 */
function berechneBadgeProgress(badge, z) {
  const target = badge.criteria_value || 1;
  const leer = (wert) => (typeof wert === 'number' && Number.isFinite(wert) ? wert : 0);
  let current = 0;

  try {
    switch (badge.criteria_type) {
      case 'total_points':
        current = leer(z.punkteGesamt);
        break;
      case 'gottesdienst_points':
        current = leer(z.punkteGottesdienst);
        break;
      case 'gemeinde_points':
        current = leer(z.punkteGemeinde);
        break;
      case 'both_categories':
        // null heisst "gibt es fuer diese Rolle nicht" (Teamer haben kein
        // Punktekonto) — dann bleibt es bei 0.
        current = z.beideKategorien === null || z.beideKategorien === undefined
          ? 0 : leer(z.beideKategorien);
        break;
      case 'bonus_points':
        current = leer(z.punkteBonus);
        break;
      case 'activity_count':
        current = leer(z.aktivitaetenUndEvents);
        break;
      case 'event_count':
        current = leer(z.events);
        break;
      case 'mandatory_event_count':
        current = leer(z.pflichtEvents);
        break;
      case 'unique_activities':
        current = leer(z.verschiedeneAktivitaeten);
        break;
      case 'teamer_year':
        current = leer(z.teamerJahre);
        break;
      case 'streak':
        current = leer(z.streak);
        break;
      case 'specific_activity': {
        const { extra } = liesCriteriaExtra(badge.criteria_extra);
        current = extra.required_activity_name
          ? (z.proAktivitaetsname?.get(extra.required_activity_name) || 0)
          : 0;
        break;
      }
      case 'category_activities': {
        const { extra } = liesCriteriaExtra(badge.criteria_extra);
        current = extra.required_category
          ? (z.proKategorie?.get(extra.required_category) || 0)
          : 0;
        break;
      }
      case 'activity_combination': {
        // Gezaehlt wird, wie viele der geforderten Eintraege erfuellt sind.
        // required_events zaehlt nur mit, wenn der Aufrufer die Titel
        // mitliefert — der Konfi-Pfad tut das nicht, seine Wertung kennt
        // required_events an dieser Stelle ebenfalls nicht.
        const { extra } = liesCriteriaExtra(badge.criteria_extra);
        const geforderteAktivitaeten = Array.isArray(extra.required_activities)
          ? extra.required_activities : [];
        current = geforderteAktivitaeten
          .filter((name) => (z.proAktivitaetsname?.get(name) || 0) > 0).length;
        if (z.erfuellteEventTitel) {
          const geforderteEvents = Array.isArray(extra.required_events)
            ? extra.required_events : [];
          current += geforderteEvents.filter((titel) => z.erfuellteEventTitel.has(titel)).length;
        }
        break;
      }
      case 'time_based': {
        const { extra } = liesCriteriaExtra(badge.criteria_extra);
        const tage = extra.days || (extra.weeks ? extra.weeks * 7 : null);
        if (tage && Array.isArray(z.alleDaten)) {
          const grenze = Date.now() - tage * 24 * 60 * 60 * 1000;
          current = z.alleDaten.filter((d) => new Date(d).getTime() >= grenze).length;
        }
        break;
      }
      case 'collection':
      case 'yearly':
        // In der Wertung (badges.js) noch nicht umgesetzt -> 0.
        current = 0;
        break;
      default:
        current = 0;
    }
  } catch (err) {
    // Ein einzelnes Abzeichen darf die Liste nicht zerreissen.
    console.error(`Fehler beim Berechnen des Fortschritts fuer Abzeichen ${badge.id}:`, err);
    current = 0;
  }

  return {
    current,
    target,
    percentage: Math.min((current / target) * 100, 100)
  };
}

module.exports = { berechneBadgeProgress, bedingungFehlt, liesCriteriaExtra };
