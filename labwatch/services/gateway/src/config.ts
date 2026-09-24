import { createRequire } from 'node:module';
import { databaseUrlFromEnv, redisUrlFromEnv } from '@labwatch/infra';
import { z } from 'zod';

export const VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

const EnvSchema = z.object({
  GITHUB_REPOS: z.string().default('Ihor-Zakharov/syssoft-labs'),
  PORT: z.coerce.number().int().positive().default(3000),
});

export interface GatewayConfig {
  repos: string[];
  port: number;
  databaseUrl: string;
  redisUrl: string;
}

export const CONFIG = Symbol('CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = EnvSchema.parse(env);
  return {
    repos: parsed.GITHUB_REPOS.split(',').map((r) => r.trim()).filter(Boolean),
    port: parsed.PORT,
    databaseUrl: databaseUrlFromEnv(env),
    redisUrl: redisUrlFromEnv(env),
  };
}
