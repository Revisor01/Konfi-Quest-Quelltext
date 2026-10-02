// Die Basis-Adresse der API an einer Stelle. api.ts baut den Client damit,
// networkMonitor prüft damit im Funkloch, ob der Server antwortet — ohne api.ts
// zu importieren (api.ts importiert den networkMonitor, das wäre ein Kreis).
export const API_BASE_URL: string = import.meta.env.VITE_API_URL || 'https://konfi-quest.de/api';
