import type { AppRouter } from '@labwatch/gateway/router';
import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

// Same origin: Vite (dev) or nginx (docker) proxies /trpc to the gateway
export function createClient() {
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === 'subscription',
        // Subscriptions ride on server-sent events (EventSource), reconnecting by themselves
        true: httpSubscriptionLink({ url: '/trpc' }),
        false: httpBatchLink({ url: '/trpc' }),
      }),
    ],
  });
}
