import type { UpdateTopic } from '@labwatch/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useState } from 'react';
import { useTRPC } from './trpc';

export type LiveState = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to the gateway's update stream and refetches exactly the queries whose data changed.
 * The server pushes "what changed", not the data: the stream stays tiny, the queries stay the source of truth.
 */
export function useLiveUpdates(): { state: LiveState; lastUpdate: string | null } {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const affected = (topic: UpdateTopic) => {
    switch (topic) {
      case 'ci':
        return [trpc.overview.queryKey(), trpc.ciRuns.queryKey()];
      case 'commits':
        return [trpc.commits.queryKey()];
      case 'pulls':
        return [trpc.pulls.queryKey()];
      case 'source':
        return [trpc.overview.queryKey(), trpc.sourceProbes.queryKey()];
      case 'events':
        return [trpc.events.queryKey()];
      case 'health':
      case 'ratelimit':
        return [trpc.overview.queryKey()];
    }
  };

  const subscription = useSubscription(
    trpc.updates.subscriptionOptions(undefined, {
      onData: (message) => {
        setLastUpdate(message.at);
        for (const queryKey of affected(message.topic)) void queryClient.invalidateQueries({ queryKey });
      },
    }),
  );

  const state: LiveState =
    subscription.status === 'pending' ? 'live' : subscription.status === 'error' ? 'offline' : 'connecting';
  return { state, lastUpdate };
}
