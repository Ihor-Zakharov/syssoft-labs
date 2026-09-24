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
        return [trpc.overview, trpc.branches, trpc.ciRuns, trpc.ciRun, trpc.pulls];
      case 'commits':
        return [trpc.overview, trpc.branches, trpc.commits];
      case 'pulls':
        return [trpc.branches, trpc.pulls, trpc.pull];
      case 'reviews':
        return [trpc.branches, trpc.pulls, trpc.pull, trpc.ciRuns, trpc.ciRun];
      case 'checks':
        return [trpc.ciRuns, trpc.ciRun];
      case 'source':
        return [trpc.overview, trpc.sourceProbes];
      case 'status':
        return [trpc.overview, trpc.statusPage, trpc.incidents];
      case 'events':
        return [trpc.events];
      case 'health':
      case 'ratelimit':
        return [trpc.overview];
    }
  };

  const subscription = useSubscription(
    trpc.updates.subscriptionOptions(undefined, {
      onData: (message) => {
        setLastUpdate(message.at);
        for (const procedure of affected(message.topic)) void queryClient.invalidateQueries(procedure.pathFilter());
      },
    }),
  );

  const state: LiveState =
    subscription.status === 'pending' ? 'live' : subscription.status === 'error' ? 'offline' : 'connecting';
  return { state, lastUpdate };
}
