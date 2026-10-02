// Die CI (ci.yml, Job backend-test, Schritt Lint) bewertet nur Fehler, nicht
// Warnungen -- wie im Frontend.
//
// Auf 'warn' herabgestuft, mit Begruendung:
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    // uploads/ entsteht bei lokalen Laeufen und in Tests, gehoert nicht zum Code.
    ignores: ['node_modules/', 'uploads/', 'coverage/'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      'no-useless-assignment': 'warn',
    },
  },
  {
    // Vitest laeuft mit `globals: true` (tests/vitest.config.ts): describe,
    // it, expect, vi usw. stehen ohne Import zur Verfuegung.
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  },
  {
    // Die einzige Testdatei mit ESM-import in einer .js-Datei; Vitest
    // verkraftet das, ESLint braucht dafuer den sourceType.
    files: ['tests/services/pushKennungMitsenden.test.js'],
    languageOptions: {
      sourceType: 'module',
    },
  },
];
