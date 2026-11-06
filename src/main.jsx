import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const onWindowLoad = () => {
    window.removeEventListener('load', onWindowLoad);
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  };
  window.addEventListener('load', onWindowLoad);
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
