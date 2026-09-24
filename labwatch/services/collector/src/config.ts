import { createRequire } from 'node:module';
import { databaseUrlFromEnv, redisUrlFromEnv } from '@labwatch/infra';
import { z } from 'zod';

export const VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

const PINNED_CERT_SHA256 = '7F96A64D03536BC384D4CF118B4BB52DB1E906372FE73B81BF771BF90226B378';
const KNOWN_BODY_SHA256 = '02a592dd5411b84b036606dc98048ff224dec95f3ac27d8399a9d52f699c21ca';

const EnvSchema = z.object({
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_REPOS: z.string().default('Ihor-Zakharov/syssoft-labs'),
  GITHUB_DEFAULT_BRANCH: z.string().default('main'),
  SOURCE_URL: z.url().default('https://91.202.128.107/manual.txt'),
  SOURCE_EXPECTED_CERT_SHA256: z.string().default(PINNED_CERT_SHA256),
  /** Set to an empty string to skip the content check. */
  SOURCE_EXPECTED_BODY_SHA256: z.string().default(KNOWN_BODY_SHA256),
  PORT: z.coerce.number().int().positive().default(3001),
});

export interface CollectorConfig {
  githubToken: string | undefined;
  repos: string[];
  defaultBranch: string;
  sourceUrl: string;
  expectedCertSha256: string;
  expectedBodySha256: string | null;
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
    sourceUrl: parsed.SOURCE_URL,
    expectedCertSha256: parsed.SOURCE_EXPECTED_CERT_SHA256,
    expectedBodySha256: parsed.SOURCE_EXPECTED_BODY_SHA256.trim() || null,
    port: parsed.PORT,
    databaseUrl: databaseUrlFromEnv(env),
    redisUrl: redisUrlFromEnv(env),
  };
}
