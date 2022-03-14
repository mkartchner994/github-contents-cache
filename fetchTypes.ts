export type FetchContentArgs = {
  token: string;
  owner: string;
  repo: string;
  path: string;
  userAgent: string;
  etag?: string;
};

export type FetchContentReturn =
  | {
      statusCode: 403;
      limit: number;
      remaining: number;
      timestampTillNextResetInSeconds: number;
    }
  | {
      statusCode: 200 | 304 | 404;
      content?: string;
      etag?: string;
    };

export type FetchContentFn = (
  args: FetchContentArgs
) => Promise<FetchContentReturn>;
