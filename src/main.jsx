import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { rememberError } from './lib/errors.mjs';
import './index.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // S9: register the console's worker scoped to the base it was built for.
  //
  // On the aggregated yoursaas.com deploy Central ships under /admin/ alongside
  // myClinic at the root, and each has its OWN worker. A default-scope
  // registration resolves to the script's directory today, but "today" is the
  // whole argument — scope is the one word that keeps the console's worker from
  // claiming the clinic shell (and vice-versa) if a base ever moves. Vite injects
  // __BUILD_BASE__ ('./' or '/admin/'); the typeof guard keeps this module
  // importable under plain Node, where the define has not run.
  const swBase = typeof __BUILD_BASE__ === 'string' ? __BUILD_BASE__ : './';
  const onWindowLoad = () => {
    window.removeEventListener('load', onWindowLoad);
    navigator.serviceWorker.register(`${swBase}sw.js`, { scope: swBase }).catch((err) => {
      rememberError(err, 'Service worker registration');
    });
  };
  window.addEventListener('load', onWindowLoad);
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
