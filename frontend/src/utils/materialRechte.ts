//   "Admins sehen Material ihrer Jahrgaenge und globales Material.
//    Material bearbeiten kann nur der Ersteller!"
//
// Die verbindliche Pruefung macht der Server (routes/material.js,
// darfMaterialAendern) -- diese Funktion spiegelt sie fuer die Oberflaeche,
// damit Bearbeiten und Loeschen gar nicht erst angeboten werden, wo der
// Server ohnehin mit 403 antworten wuerde.
//
// Regeln (identisch zum Server):
//   - org_admin und is_super_admin-Flag duerfen immer -- sonst waere das
//     Material einer ausgeschiedenen Person fuer immer unveraenderlich.
//   - admin darf nur eigenes Material (created_by = eigene id).
//   - created_by null (Konto geloescht) -> nur noch die Leitung.
//   - created_by undefined (alter Offline-Cache ohne das Feld) -> wie null
//     behandeln: lieber die Aktion ausblenden als einen Knopf anbieten, der
//     mit 403 antwortet. Nach dem naechsten Online-Laden ist das Feld da.

export interface MaterialRechteUser {
  id: number;
  role_name?: string;
  is_super_admin?: boolean;
}

export interface MaterialMitErsteller {
  created_by?: number | null;
}

export const darfMaterialBearbeiten = (
  user: MaterialRechteUser | null | undefined,
  material: MaterialMitErsteller
): boolean => {
  if (!user) return false;
  if (user.is_super_admin === true || user.role_name === 'org_admin') return true;
  return material.created_by != null && material.created_by === user.id;
};
