import { createRequire } from 'node:module';
import { databaseUrlFromEnv, redisUrlFromEnv } from '@labwatch/infra';
import { AWS_VANTAGE, DEFAULT_VANTAGE } from '@labwatch/shared';
import { z } from 'zod';

export const VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

const EnvSchema = z.object({
  GITHUB_REPOS: z.string().default('Ihor-Zakharov/syssoft-labs'),
  GITHUB_DEFAULT_BRANCH: z.string().default('main'),
  /** Workflow whose runs are agentic code reviews (their outcome is shown on CI runs and PRs). */
  REVIEW_WORKFLOW: z.string().default('Code review'),
  STATUS_VANTAGE: z.string().default(DEFAULT_VANTAGE),
  /** Every vantage the status page combines (this PC and the AWS prober). */
  STATUS_VANTAGES: z.string().default(`${DEFAULT_VANTAGE},${AWS_VANTAGE}`),
  /** Day buckets of the status page start at local midnight in this zone. */
  STATUS_TIMEZONE: z.string().default('Europe/Kyiv'),
  PORT: z.coerce.number().int().positive().default(3000),
});

export interface GatewayConfig {
  repos: string[];
  /** Branch views (tabs) show the first repository. */
  repo: string;
  defaultBranch: string;
  reviewWorkflow: string;
  statusVantage: string;
  statusVantages: string[];
  statusTimezone: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
}

export const CONFIG = Symbol('CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = EnvSchema.parse(env);
  const repos = parsed.GITHUB_REPOS.split(',').map((r) => r.trim()).filter(Boolean);
  return {
    repos,
    repo: repos[0] ?? 'Ihor-Zakharov/syssoft-labs',
    defaultBranch: parsed.GITHUB_DEFAULT_BRANCH,
    reviewWorkflow: parsed.REVIEW_WORKFLOW,
    statusVantage: parsed.STATUS_VANTAGE,
    statusVantages: [...new Set([parsed.STATUS_VANTAGE, ...parsed.STATUS_VANTAGES.split(',').map((v) => v.trim()).filter(Boolean)])],
    statusTimezone: parsed.STATUS_TIMEZONE,
    port: parsed.PORT,
    databaseUrl: databaseUrlFromEnv(env),
    redisUrl: redisUrlFromEnv(env),
  };
}
