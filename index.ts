import controlFlow from "./controlFlow";
import fetchContent from "./github";

type CacheContent =
  | {
      type: "found";
      time: number;
      content: any;
      etag: string;
    }
  | { type: "notFound"; time: number };

type Cache = {
  get: (path: string) => Promise<CacheContent | null | undefined>;
  set: (path: string, entry: CacheContent) => Promise<any>;
  remove: (path: string) => Promise<any>;
};

type GetGithubContentArgs = {
  token: string;
  owner: string;
  repo: string;
  path: string;
  ignoreCache: boolean;
  cache: Cache;
  max404CacheTimeInMilliseconds?: number;
  serialize?: (content: string) => Promise<any>;
};

type GetGithubContentReturn =
  | { status: "found"; content: string; cacheHit: boolean }
  | { status: "notFound"; content: ""; cacheHit: boolean }
  | {
      status: "rateLimitExceeded";
      limit: number;
      remaining: number;
      timestampTillNextResetInSeconds: number;
      content?: any; // If we have hit our rate limit but we still have a cached value
      cacheHit?: boolean;
    };

type GetGithubContentStepContext = {
  cache: Cache;
  token: GetGithubContentArgs["token"];
  owner: GetGithubContentArgs["owner"];
  repo: GetGithubContentArgs["repo"];
  path: GetGithubContentArgs["path"];
  max404CacheTimeInMilliseconds: GetGithubContentArgs["max404CacheTimeInMilliseconds"];
  serialize: GetGithubContentArgs["serialize"];
  cachedResults?: {
    time: number;
    content: any;
    etag: string;
  };
};

export default async function getGithubContent({
  token,
  owner,
  repo,
  path,
  ignoreCache,
  cache,
  max404CacheTimeInMilliseconds = Infinity,
  serialize = async (content) => content,
}: GetGithubContentArgs): Promise<GetGithubContentReturn> {
  let result = await controlFlow<GetGithubContentStepContext>({
    logSteps: false,
    initialStep: ignoreCache ? "clearCacheEntry" : "lookInCache",
    stepContext: {
      cache,
      token,
      owner,
      repo,
      path,
      serialize,
      max404CacheTimeInMilliseconds,
    },
    steps: {
      clearCacheEntry: {
        entry: clearCacheEntry,
        onCachedCleared: "lookInGithub", // Was able to clear the cache, lets get the latest from github
        onError: "error", // Something went wrong clearing the cache - either from a corrupt cache or a manual call to clear
      },
      lookInCache: {
        entry: lookInCache,
        onFoundInCache: "lookInGithub", // Ask github if what we have in cache is stale (Does Not count against our api limit)
        onNotInCache: "lookInGithub", // Ask for it from github (Does count against our api limit)
        on404CacheExpired: "clearCacheEntry", // We found a cache 404 but it has expired
        on404InCache: "notFound", // We asked github earlier and they said they didn't have it
        onError: "error", // Unknown error we couldn't recover from
      },
      lookInGithub: {
        entry: lookInGithub,
        onFound: "found", // Either came from the cache or from github and then we cached it
        on404FromGithub: "notFound", // Github said they didn't have it
        onRateLimitExceeded: "rateLimitExceeded", // Github said we are hitting their api to much
        onError: "error", // Having trouble getting data from the github api?
      },
      found: { final: true }, // Got it!
      notFound: { final: true }, // Don't have it
      rateLimitExceeded: { final: true }, // Oops
      error: { final: true }, // Hopefully this never happens, but we are taking care of it if it does :thumbsup:
    },
  });

  if (result.step === "found") {
    return {
      status: "found",
      content: result.data.content,
      cacheHit: result.data.cacheHit,
    };
  }
  if (result.step == "notFound") {
    return { status: "notFound", content: "", cacheHit: result.data.cacheHit };
  }
  if (result.step == "rateLimitExceeded") {
    return {
      status: "rateLimitExceeded",
      limit: result.data.limit,
      remaining: result.data.remaining,
      timestampTillNextResetInSeconds:
        result.data.timestampTillNextResetInSeconds,
      content: result.data.content,
      cacheHit: result.data.cacheHit,
    };
  }
  throw new Error("could_not_get_content");
}

////// Entry Functions
//////

async function clearCacheEntry(stepContext: GetGithubContentStepContext) {
  try {
    await stepContext.cache.remove(stepContext.path);
    return { nextEvent: "onCachedCleared" };
  } catch (error) {
    return { nextEvent: "onError" };
  }
}

async function lookInCache(stepContext: GetGithubContentStepContext) {
  {
    try {
      const cachedResults = await stepContext.cache.get(stepContext.path);
      if (!cachedResults) {
        return {
          nextEvent: "onNotInCache",
        };
      }
      if (cachedResults.type === "notFound") {
        if (
          Date.now() - cachedResults.time >
          stepContext.max404CacheTimeInMilliseconds
        ) {
          return { nextEvent: "on404CacheExpired" };
        }
        return { nextEvent: "on404InCache", cacheHit: true };
      }
      stepContext.cachedResults = cachedResults;
      return { nextEvent: "onFoundInCache" };
    } catch (error) {
      return {
        nextEvent: "onError",
      };
    }
  }
}

async function lookInGithub(stepContext: GetGithubContentStepContext) {
  try {
    let resp = await fetchContent({
      token: stepContext.token,
      owner: stepContext.owner,
      repo: stepContext.repo,
      path: stepContext.path,
      etag: stepContext?.cachedResults?.etag,
    });
    // If the content isn't modified return what is in our cache
    if (resp.statusCode === 304) {
      return {
        nextEvent: "onFound",
        content: stepContext?.cachedResults?.content,
        cacheHit: true,
      };
    }
    // This file wasn't found in github, cache the 404 response so we don't hit our api limit
    // Using the time field with the max404CacheTimeInMilliseconds option to expire this cache entry
    if (resp.statusCode === 404) {
      stepContext.cache
        .set(stepContext.path, { time: Date.now(), type: "notFound" })
        .catch(() => {});
      return { nextEvent: "on404FromGithub", cacheHit: false };
    }
    // We
    if (resp.statusCode === 403) {
      return {
        nextEvent: "onRateLimitExceeded",
        limit: resp.limit,
        remaining: resp.remaining,
        timestampTillNextResetInSeconds: resp.timestampTillNextResetInSeconds,
        content: stepContext?.cachedResults?.content,
        cacheHit: stepContext?.cachedResults?.content ? true : false,
      };
    }

    let content;
    try {
      content = await stepContext.serialize(resp.content);
    } catch (error) {
      return { nextEvent: "onError" };
    }

    stepContext.cache
      .set(stepContext.path, {
        type: "found",
        time: Date.now(),
        content: content,
        etag: resp.etag,
      })
      .catch(() => {});

    return {
      nextEvent: "onFound",
      content: content,
      cacheHit: false,
    };
  } catch (error: any) {
    // We didn't get back what we expected from the github api, but we have it cached
    // so lets return that
    if (stepContext?.cachedResults?.content) {
      return {
        nextEvent: "onFound",
        content: stepContext.cachedResults.content,
        cacheHit: true,
      };
    }
    // Treat anything else as an internal server error
    return { nextEvent: "onError" };
  }
}

