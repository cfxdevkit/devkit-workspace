import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Providers } from './providers';
import { App } from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
