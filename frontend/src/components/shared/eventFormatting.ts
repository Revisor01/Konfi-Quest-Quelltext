// Gemeinsame Datums-/Zeit-Formatierung für Events (zuvor in jeder Rolle
// dupliziert: Konfi/Admin/Teamer Views + DetailViews). Deutsche Locale.

export const formatEventDate = (dateString: string): string =>
  new Date(dateString).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

// 18:30 (leere/ungueltige Eingaben -> '')
export const formatEventTime = (dateString: string): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Sonntag, 14. Juni 2026
export const formatEventDateLong = (dateString: string): string =>
  new Date(dateString).toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

// Folge: Bei einer Freizeit vom 10. bis 14. sagte die Konfi-Liste ab dem
// 11. noch "laeuft", die Detailansicht desselben Termins aber schon
// "vergangen" -- zwei Ansichten derselben Sache widersprachen sich.
//
// Die Begruendung stand bereits zweimal im Code (konfi/views/EventsView.tsx,
// admin/pages/AdminEventsPage.tsx), nur eben nicht an den anderen neun
// Stellen. Deshalb steht sie jetzt hier, einmal.

// Ende eines Termins: bei mehrtaegigen das Ende, sonst der Start.
export const eventEnde = (event: { event_date: string; event_end_time?: string | null }): Date =>
  new Date(event.event_end_time || event.event_date);

// Ist der Termin vorbei? Mehrtaegige erst NACH ihrem letzten Tag.
export const istVergangen = (
  event: { event_date: string; event_end_time?: string | null },
  jetzt: Date = new Date()
): boolean => eventEnde(event) < jetzt;
