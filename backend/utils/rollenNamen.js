// Anzeigenamen der Rollen in Texten, die der Server selbst formuliert
// (Einladung per Push und E-Mail, "Einladung angenommen", Rollenangabe in den
// Chat-Kontaktlisten).
//
// Gegenstueck in der App: frontend/src/utils/rollenNamen.ts (dieselben Woerter).

const ROLLEN_NAMEN = Object.freeze({
  org_admin: 'Gemeindeleitung',
  admin: 'Leitung',
  teamer: 'Teamer:in'
});

/**
 * @param {string|null|undefined} name         technischer Rollenname (roles.name)
 * @param {string|null|undefined} displayName  roles.display_name als Rueckfall
 * @returns {string}
 */
const rollenAnzeigename = (name, displayName) =>
  (name && ROLLEN_NAMEN[name]) || displayName || name || '';

module.exports = { ROLLEN_NAMEN, rollenAnzeigename };
