const { validationResult, body, param, query } = require('express-validator');

/**
 * Middleware: Prüft express-validator Ergebnisse und gibt 400 zurück bei Fehlern.
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validierungsfehler',
      details: errors.array().map(e => ({
        field: e.path,
        message: e.msg
      }))
    });
  }
  next();
};

/**
 * Whitelist-validierter Spaltennamen-Resolver für Punktetypen.
 * Verhindert SQL-Injection über dynamische Spaltennamen in Template Literals.
 */
const VALID_POINT_FIELDS = {
  gottesdienst: 'gottesdienst_points',
  gemeinde: 'gemeinde_points'
};

function getPointField(type) {
  const field = VALID_POINT_FIELDS[type];
  if (!field) {
    throw new Error('Ungültiger Punktetyp');
  }
  return field;
}

// Wiederverwendbar: ID-Parameter validieren
const validateId = param('id').isInt({ min: 1 }).withMessage('Ungültige ID');

// Wiederverwendbar: Pagination-Parameter
const validatePagination = [
  query('page').optional().isInt({ min: 1 }).withMessage('Seitenzahl muss positiv sein'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit muss zwischen 1 und 100 liegen')
];

// Gemeinsame Validierungen für häufige Felder
const commonValidations = {
  name: body('name').trim().notEmpty().withMessage('Name ist erforderlich')
    .isLength({ min: 2, max: 100 }).withMessage('Name muss zwischen 2 und 100 Zeichen lang sein'),
  description: body('description').optional().trim()
    .isLength({ max: 500 }).withMessage('Beschreibung darf maximal 500 Zeichen lang sein'),
  points: body('points').isInt({ min: 1 }).withMessage('Punkte müssen eine positive Ganzzahl sein'),
  type: body('type').isIn(['gottesdienst', 'gemeinde']).withMessage('Typ muss "gottesdienst" oder "gemeinde" sein'),
  email: body('email').trim().isEmail().withMessage('Gültige E-Mail-Adresse erforderlich'),
  // KEIN trim(): Leerzeichen sollen NICHT still entfernt werden, sondern eine
  // klare Fehlermeldung ausloesen (Regex unten verbietet sie).
  // Erlaubt sind nur Buchstaben, Zahlen, Punkt und Bindestrich (KEIN Unterstrich,
  // KEINE Leerzeichen). Gross-/Kleinschreibung bleibt erhalten — der Login ist
  // case-insensitiv (LOWER-Vergleich), gespeichert wird die Original-Schreibweise.
  username: body('username')
    .isLength({ min: 3, max: 50 }).withMessage('Benutzername muss zwischen 3 und 50 Zeichen lang sein')
    .matches(/^[a-zA-Z0-9.-]+$/).withMessage('Benutzername darf nur Buchstaben, Zahlen, Punkt (.) und Bindestrich (-) enthalten — keine Leerzeichen oder anderen Sonderzeichen'),
  password: body('password')
    .isLength({ min: 8 }).withMessage('Passwort muss mindestens 8 Zeichen lang sein')
    .matches(/^\S+$/).withMessage('Passwort darf keine Leerzeichen enthalten'),
  date: body('completed_date').optional().isISO8601().withMessage('Ungültiges Datumsformat'),
};

module.exports = {
  handleValidationErrors,
  getPointField,
  validateId,
  validatePagination,
  commonValidations
};
