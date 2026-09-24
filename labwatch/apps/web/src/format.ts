import { useEffect, useState } from 'react';

/** Re-renders every `intervalMs` so relative times and running durations stay current. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function timeAgo(iso: string | null, now: number): string {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function duration(fromIso: string | null, toMs: number): string {
  if (!fromIso) return '—';
  const seconds = Math.max(0, Math.round((toMs - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}

export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : '—';
}

export function firstLine(text: string): string {
  return text.split('\n', 1)[0] ?? '';
}

export function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}
