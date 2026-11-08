import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { rememberError } from './lib/errors.mjs';
import './index.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const onWindowLoad = () => {
    window.removeEventListener('load', onWindowLoad);
    navigator.serviceWorker.register('./sw.js').catch((err) => {
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
