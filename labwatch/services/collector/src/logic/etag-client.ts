export interface CachedResponse<T> {
  etag: string;
  data: T;
}

/** Where ETags and the matching (already mapped) data are kept between polls — Redis in production. */
export interface EtagCache {
  get<T>(url: string): Promise<CachedResponse<T> | null>;
  set<T>(url: string, value: CachedResponse<T>): Promise<void>;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: string;
}

export interface FetchResult<T> {
  data: T;
  /** false when GitHub answered 304 Not Modified and the cached data was reused. */
  changed: boolean;
  status: number;
  rateLimit: RateLimitInfo | null;
}

export class GithubHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
    readonly rateLimit: RateLimitInfo | null,
  ) {
    super(`GitHub ${status} for ${url}: ${body.slice(0, 200)}`);
    this.name = 'GithubHttpError';
  }
}

export interface EtagClientOptions {
  fetch: typeof fetch;
  cache: EtagCache;
  token?: string | undefined;
  userAgent: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export function parseRateLimit(headers: Headers): RateLimitInfo | null {
  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  if (limit === null || remaining === null || reset === null) return null;
  return {
    limit: Number(limit),
    remaining: Number(remaining),
    resetAt: new Date(Number(reset) * 1000).toISOString(),
  };
}

/**
 * GitHub REST client that uses conditional requests: the ETag of the last response is sent back as
 * If-None-Match; an unchanged resource returns 304 with no body (free when authenticated), and the
 * cached, already mapped data is reused. Only the mapped data is cached, not the raw JSON — GitHub
 * payloads are large (every run embeds two full repository objects).
 */
export class EtagClient {
  private readonly baseUrl: string;

  constructor(private readonly options: EtagClientOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.github.com';
  }

  get authenticated(): boolean {
    return Boolean(this.options.token);
  }

  async getJson<Raw, T>(path: string, map: (raw: Raw) => T): Promise<FetchResult<T>> {
    const url = this.baseUrl + path;
    const cached = await this.options.cache.get<T>(url);

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': this.options.userAgent,
    };
    if (this.options.token) headers.Authorization = `Bearer ${this.options.token}`;
    if (cached) headers['If-None-Match'] = cached.etag;

    const response = await this.options.fetch(url, {
      headers,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
    });
    const rateLimit = parseRateLimit(response.headers);

    if (response.status === 304 && cached) {
      return { data: cached.data, changed: false, status: 304, rateLimit };
    }
    if (!response.ok) {
      throw new GithubHttpError(response.status, url, await response.text(), rateLimit);
    }

    const data = map((await response.json()) as Raw);
    const etag = response.headers.get('etag');
    if (etag) await this.options.cache.set(url, { etag, data });
    return { data, changed: true, status: response.status, rateLimit };
  }
}
