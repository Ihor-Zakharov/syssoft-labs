import { createRequire } from 'node:module';
import { databaseUrlFromEnv, redisUrlFromEnv } from '@labwatch/infra';
import { DEFAULT_VANTAGE } from '@labwatch/shared';
import { z } from 'zod';

export const VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

const PINNED_CERT_SHA256 = '7F96A64D03536BC384D4CF118B4BB52DB1E906372FE73B81BF771BF90226B378';
const KNOWN_BODY_SHA256 = '02a592dd5411b84b036606dc98048ff224dec95f3ac27d8399a9d52f699c21ca';

const bool = z
  .string()
  .default('true')
  .transform((v) => !['false', '0', 'no', 'off'].includes(v.trim().toLowerCase()));

const EnvSchema = z.object({
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_REPOS: z.string().default('Ihor-Zakharov/syssoft-labs'),
  GITHUB_DEFAULT_BRANCH: z.string().default('main'),
  /** Requests per rolling hour labwatch may make without a token (GitHub allows 60 per IP). */
  GITHUB_UNAUTH_BUDGET_PER_HOUR: z.coerce.number().int().min(1).max(60).default(40),
  /** Requests per rolling hour with a token (GitHub allows 5000 per token). */
  GITHUB_AUTH_BUDGET_PER_HOUR: z.coerce.number().int().min(1).max(5000).default(2000),
  /** Check runs whose name matches are test reports (e.g. dorny/test-reporter's "Test results"). */
  TEST_REPORT_CHECK_PATTERN: z.string().default('^test results'),
  SOURCE_URL: z.url().default('https://91.202.128.107/manual.txt'),
  SOURCE_EXPECTED_CERT_SHA256: z.string().default(PINNED_CERT_SHA256),
  /** Set to an empty string to skip the content check. */
  SOURCE_EXPECTED_BODY_SHA256: z.string().default(KNOWN_BODY_SHA256),
  STATUS_ENABLED: bool,
  STATUS_VANTAGE: z.string().regex(/^[a-z0-9-]+$/).default(DEFAULT_VANTAGE),
  STATUS_INTERVAL_S: z.coerce.number().int().min(10).default(60),
  STATUS_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
  STATUS_DEGRADED_MS: z.coerce.number().int().min(1).default(2000),
  STATUS_RETENTION_DAYS: z.coerce.number().int().min(1).default(120),
  PORT: z.coerce.number().int().positive().default(3001),
});

export interface CollectorConfig {
  githubToken: string | undefined;
  repos: string[];
  defaultBranch: string;
  unauthBudgetPerHour: number;
  authBudgetPerHour: number;
  testReportPattern: RegExp;
  sourceUrl: string;
  expectedCertSha256: string;
  expectedBodySha256: string | null;
  status: {
    enabled: boolean;
    vantage: string;
    intervalMs: number;
    timeoutMs: number;
    degradedMs: number;
    retentionDays: number;
  };
  port: number;
  databaseUrl: string;
  redisUrl: string;
}

export const CONFIG = Symbol('CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const parsed = EnvSchema.parse(env);
  const repos = parsed.GITHUB_REPOS.split(',').map((r) => r.trim()).filter(Boolean);
  if (repos.some((r) => !/^[\w.-]+\/[\w.-]+$/.test(r))) {
    throw new Error(`GITHUB_REPOS must be "owner/name[,owner/name]", got "${parsed.GITHUB_REPOS}"`);
  }
  return {
    githubToken: parsed.GITHUB_TOKEN?.trim() || undefined,
    repos,
    defaultBranch: parsed.GITHUB_DEFAULT_BRANCH,
    unauthBudgetPerHour: parsed.GITHUB_UNAUTH_BUDGET_PER_HOUR,
    authBudgetPerHour: parsed.GITHUB_AUTH_BUDGET_PER_HOUR,
    testReportPattern: new RegExp(parsed.TEST_REPORT_CHECK_PATTERN, 'i'),
    sourceUrl: parsed.SOURCE_URL,
    expectedCertSha256: parsed.SOURCE_EXPECTED_CERT_SHA256,
    expectedBodySha256: parsed.SOURCE_EXPECTED_BODY_SHA256.trim() || null,
    status: {
      enabled: parsed.STATUS_ENABLED,
      vantage: parsed.STATUS_VANTAGE,
      intervalMs: parsed.STATUS_INTERVAL_S * 1000,
      timeoutMs: parsed.STATUS_TIMEOUT_MS,
      degradedMs: parsed.STATUS_DEGRADED_MS,
      retentionDays: parsed.STATUS_RETENTION_DAYS,
    },
    port: parsed.PORT,
    databaseUrl: databaseUrlFromEnv(env),
    redisUrl: redisUrlFromEnv(env),
  };
}
