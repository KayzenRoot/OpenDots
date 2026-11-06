import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
import './editor.css';
import { watchSystemTheme } from './theme';
import { initializeLocale } from './i18n';
watchSystemTheme();
initializeLocale();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
