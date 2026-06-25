/**
 * Losung-Service: Tageslosung abrufen mit DB-Cache
 */
async function fetchTageslosung(db, translation) {
  const today = new Date().toISOString().split('T')[0];

  // Cache pruefen
  const { rows: [cachedVerse] } = await db.query(
    'SELECT verse_data FROM daily_verses WHERE date = $1 AND translation = $2',
    [today, translation]
  );

  if (cachedVerse) {
    return { data: cachedVerse.verse_data, translation, cached: true };
  }

  // Von API abrufen
  const fetch = (await import('node-fetch')).default;
  const losungApiKey = process.env.LOSUNG_API_KEY;
  if (!losungApiKey) {
    throw new Error('LOSUNG_API_KEY Umgebungsvariable fehlt');
  }

  const apiUrl = `https://losung.konfi-quest.de/api/?api_key=${losungApiKey}&translation=${translation}`;
  const response = await fetch(apiUrl, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Konfi-Quest-App/1.0'
    },
    timeout: 5000
  });

  if (!response.ok) {
    throw new Error(`Losungen API error: ${response.status}`);
  }

  const losungData = await response.json();
  if (!losungData.success) {
    throw new Error('Losungen API returned error');
  }

  // In Cache speichern
  try {
    await db.query(
      'INSERT INTO daily_verses (date, translation, verse_data) VALUES ($1, $2, $3) ON CONFLICT (date, translation) DO UPDATE SET verse_data = $3',
      [today, translation, losungData.data]
    );
  } catch (cacheErr) {
    console.error('Cache write error:', cacheErr.message);
  }

  // Alte Eintraege bereinigen (aelter als 7 Tage)
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    await db.query(
      'DELETE FROM daily_verses WHERE date < $1',
      [sevenDaysAgo.toISOString().split('T')[0]]
    );
  } catch (cleanupErr) {
    console.error('Cleanup error:', cleanupErr.message);
  }

  return { data: losungData.data, translation, cached: false };
}

module.exports = { fetchTageslosung };
