import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';

/**
 * El QueryClient es el caché de TanStack Query: guarda las respuestas del
 * servidor y decide cuándo volver a pedirlas.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Durante 5 segundos los datos se consideran frescos y no se re-piden.
      staleTime: 5_000,
      retry: 1,
    },
  },
});

// getElementById devuelve HTMLElement | null. En modo strict TypeScript no
// deja usarlo sin chequear que exista: este if es strictNullChecks en acción.
const contenedor = document.getElementById('root');
if (!contenedor) {
  throw new Error('No se encontró el elemento #root en index.html');
}

createRoot(contenedor).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
