import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dist-app', 'cypress.config.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      //   refs                      Ionic-Popover-Muster (ref im Event-Handler)
      //   set-state-in-effect       Init- und Reset-Muster beim Mount
      //   immutability              TDZ-Meldung, laeuft zur Laufzeit korrekt
      //   purity                    Date.now() in der Anzeige
      //   static-components         bewusst lokal definierte Unterkomponenten
      //   preserve-manual-memoization  vorhandene useMemo-Grenzen
      //
      // Warum nicht 'off': Als Warnung bleiben sie im Lint-Log sichtbar.
      // Die CI lintet bei jedem Push und PR den ganzen Baum und bewertet
      // nur FEHLER (kein --max-warnings) — der geprüfte Altbestand blockiert
      // also nichts, ein neuer Fehler schon (siehe ci.yml, Schritt Lint).
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Parameter, die zur Signatur gehoeren, aber nicht gebraucht werden
      // (Mock-Signaturen, Callback-Argumente), werden mit _ gekennzeichnet
      // statt geloescht — sonst passt die Signatur nicht mehr.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    },
  },
)
