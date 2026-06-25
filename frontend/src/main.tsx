import React from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import { migrateToPreferences } from './services/migrateStorage';
import { initTokenStore } from './services/tokenStore';

// Umami-Reichweitenmessung NUR im Web laden, niemals im nativen App-Build.
// Die native App (iOS/Android) erhebt damit selbst keine Analytics-Daten —
// das vermeidet Store-Datenerhebungs-Angaben und schuetzt minderjaehrige Konfis.
const loadWebAnalytics = () => {
  if (Capacitor.isNativePlatform()) {
    return;
  }
  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://t.godsapp.de/script.js';
  script.setAttribute('data-website-id', 'dfd37276-5ad4-474d-8306-bf3ed9a3a5d3');
  document.head.appendChild(script);
};

const container = document.getElementById('root');
const root = createRoot(container!);

(async () => {
  loadWebAnalytics();
  await migrateToPreferences();
  await initTokenStore();
  root.render(
    // <React.StrictMode>  // Temporarily disabled to avoid double routing in development
      <App />
    // </React.StrictMode>
  );
})();