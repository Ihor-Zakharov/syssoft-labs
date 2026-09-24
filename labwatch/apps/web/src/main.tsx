import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createClient, TRPCProvider } from './trpc';
import './styles.css';

function Root() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Live updates invalidate queries; polling is only a safety net if the stream drops
          queries: { staleTime: 5_000, refetchInterval: 60_000, retry: 2 },
        },
      }),
  );
  const [trpcClient] = useState(createClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <App />
      </TRPCProvider>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
