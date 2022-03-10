import controlFlow from "./controlFlow";

type GetGithubContentCacheEntry =
  | {
      type: "found";
      time: number;
      content: any;
      etag: string;
    }
  | { type: "notFound"; time: number };

type GetGithubContentCacheGetReturn =
  | GetGithubContentCacheEntry
  | null
  | undefined;

export type GetGithubContentCache = {
  get: (path: string) => Promise<GetGithubContentCacheGetReturn>;
  set: (path: string, entry: GetGithubContentCacheEntry) => Promise<any>;
  remove: (path: string) => Promise<any>;
};

type GetGithubContentArgs = {
  token: string;
  owner: string;
  repo: string;
  path: string;
  userAgent: string;
  cache: GetGithubContentCache;
  ignoreCache?: boolean;
  maxAgeInMilliseconds?: number;
  max404AgeInMilliseconds?: number;
  serialize?: (content: string) => Promise<any>;
  fetchContent: (...args: any) => Promise<any>;
};

type GetGithubContentReturn =
  | { status: "found"; content: any; etag: string; cacheHit: boolean }
  | { status: "notFound"; content: ""; cacheHit: boolean }
  | {
      status: "rateLimitExceeded";
      limit: number;
      remaining: number;
      timestampTillNextResetInSeconds: number;
      content?: any; // If we have hit our rate limit but we still have a cached value
      etag?: string;
      cacheHit?: boolean;
    }
  | {
      status: "error";
      message: string;
      error: Error;
    };

type GetGithubContentStepContext = {
  cache: GetGithubContentCache;
  token: GetGithubContentArgs["token"];
  owner: GetGithubContentArgs["owner"];
  repo: GetGithubContentArgs["repo"];
  path: GetGithubContentArgs["path"];
  userAgent: GetGithubContentArgs["userAgent"];
  maxAgeInMilliseconds: GetGithubContentArgs["maxAgeInMilliseconds"];
  max404AgeInMilliseconds: GetGithubContentArgs["max404AgeInMilliseconds"];
  serialize: GetGithubContentArgs["serialize"];
  fetchContent: GetGithubContentArgs["fetchContent"];
  maxAgeInMillisecondsExpired?: boolean;
  cachedResults?: {
    time: number;
    content: any;
    etag: string;
  };
};

async function getGithubContent({
  token,
  owner,
  repo,
  path,
  userAgent,
  cache,
  maxAgeInMilliseconds,
  ignoreCache = false,
  max404AgeInMilliseconds = Infinity,
  serialize = async (content: string) => content,
  fetchContent,
}: GetGithubContentArgs): Promise<GetGithubContentReturn> {
  if (!token || !owner || !repo || !path || !userAgent || !cache) {
    throw new Error(
      "Please provide all of the required arguments - { token, owner, repo, path, userAgent, cache }"
    );
  }

  let result = await controlFlow<GetGithubContentStepContext>({
    initialStep: ignoreCache ? "clearCacheEntry" : "lookInCache",
    stepContext: {
      cache,
      token,
      owner,
      repo,
      path,
      userAgent,
      serialize,
      fetchContent,
      maxAgeInMilliseconds,
      max404AgeInMilliseconds,
    },
    steps: {
      clearCacheEntry: {
        entry: clearCacheEntry,
        onCachedCleared: "lookInGithub", // Was able to clear the cache, lets get the latest from github
        onError: "error", // Something went wrong clearing the cache - either from a corrupt cache or a manual call to clear
      },
      lookInCache: {
        entry: lookInCache,
        onFound: "found", // Found in the cache and the maxAgeInMilliseconds had not yet expired
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
      etag: result.data.etag,
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
      etag: result.data.etag,
      cacheHit: result.data.cacheHit,
    };
  }
  if (result.step == "error") {
    return {
      status: "error",
      message: result.data.message,
      error: result.data.error,
    };
  }
}

////// Entry Functions
//////

const clearCacheEntry = async (stepContext: GetGithubContentStepContext) => {
  try {
    await stepContext.cache.remove(stepContext.path);
    return { nextEvent: "onCachedCleared" };
  } catch (error) {
    return {
      nextEvent: "onError",
      message: `Error when trying to remove entry from the cache at path ${stepContext.path}`,
      error,
    };
  }
};

const lookInCache = async (stepContext: GetGithubContentStepContext) => {
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
          stepContext.max404AgeInMilliseconds
        ) {
          return { nextEvent: "on404CacheExpired" };
        }
        return { nextEvent: "on404InCache", cacheHit: true };
      }
      if (stepContext.maxAgeInMilliseconds) {
        if (
          Date.now() - cachedResults.time <=
          stepContext.maxAgeInMilliseconds
        ) {
          return {
            nextEvent: "onFound",
            content: cachedResults.content,
            etag: cachedResults.etag,
            cacheHit: true,
          };
        }
        stepContext.maxAgeInMillisecondsExpired = true;
      }
      stepContext.cachedResults = cachedResults;
      return { nextEvent: "onFoundInCache" };
    } catch (error) {
      return {
        nextEvent: "onError",
        message: `Error when trying to get entry from the cache at path ${stepContext.path}`,
        error,
      };
    }
  }
};

const lookInGithub = async (stepContext: GetGithubContentStepContext) => {
  try {
    let resp = await stepContext.fetchContent({
      token: stepContext.token,
      owner: stepContext.owner,
      repo: stepContext.repo,
      path: stepContext.path,
      userAgent: stepContext.userAgent,
      etag: stepContext.cachedResults && stepContext.cachedResults.etag,
    });
    // If the content isn't modified return what is in our cache
    if (resp.statusCode === 304) {
      // If we got here because the maxAgeInMilliseconds provided had expired
      // We need to make sure to reset the `time` in the cache or else the cached time
      // would always be passed the maxAgeInMilliseconds from that point on
      if (stepContext.maxAgeInMillisecondsExpired === true) {
        try {
          await stepContext.cache.set(stepContext.path, {
            type: "found",
            time: Date.now(),
            content: stepContext.cachedResults.content,
            etag: stepContext.cachedResults.etag,
          });
        } catch (error) {
          // Ignore errors we get if trying to set content to the cache
          // These should be handled in the cache.set method by the caller
        }
      }
      return {
        nextEvent: "onFound",
        content: stepContext.cachedResults.content,
        etag: stepContext.cachedResults.etag,
        cacheHit: true,
      };
    }
    // This file wasn't found in github, cache the 404 response so we don't hit our api limit
    // Using the time field with the max404AgeInMilliseconds option to expire this cache entry
    if (resp.statusCode === 404) {
      try {
        await stepContext.cache.set(stepContext.path, {
          time: Date.now(),
          type: "notFound",
        });
      } catch (error) {
        // Ignore errors we get if trying to set content to the cache
        // These should be handled in the cache.set method by the caller
      }
      return { nextEvent: "on404FromGithub", cacheHit: false };
    }
    // There has probably been a mistake with the cache logic we've been provided?
    // Or this is actual demand which is a good problem to have, but we need to figure it out
    if (resp.statusCode === 403) {
      return {
        nextEvent: "onRateLimitExceeded",
        limit: resp.limit,
        remaining: resp.remaining,
        timestampTillNextResetInSeconds: resp.timestampTillNextResetInSeconds,
        content:
          (stepContext.cachedResults && stepContext.cachedResults.content) ??
          "",
        etag:
          (stepContext.cachedResults && stepContext.cachedResults.etag) ?? "",
        cacheHit:
          stepContext.cachedResults && stepContext.cachedResults.content
            ? true
            : false,
      };
    }

    try {
      resp.content = await stepContext.serialize(resp.content);
    } catch (error) {
      return {
        nextEvent: "onError",
        message: "Error occured when serializing the content",
        error,
      };
    }

    try {
      await stepContext.cache.set(stepContext.path, {
        type: "found",
        time: Date.now(),
        content: resp.content,
        etag: resp.etag,
      });
    } catch (error) {
      // Ignore errors we get if trying to set content to the cache
      // These should be handled in the cache.set method by the caller
    }

    return {
      nextEvent: "onFound",
      content: resp.content,
      etag: resp.etag,
      cacheHit: false,
    };
  } catch (error: any) {
    // We didn't get back what we expected from the github api, but we have it cached
    // so lets return that
    if (stepContext.cachedResults && stepContext.cachedResults.content) {
      console.warn(
        "Received an unexpected error, but returning the value from the cache",
        error
      );
      return {
        nextEvent: "onFound",
        content: stepContext.cachedResults.content,
        etag: stepContext.cachedResults.etag,
        cacheHit: true,
      };
    }
    // Treat anything else as an internal server error
    return {
      nextEvent: "onError",
      message: `Unexpected error when looking for content on GitHub at path ${stepContext.path}`,
      error,
    };
  }
};

const getGithubContentFactory = (fetchContent) => (options) =>
  getGithubContent({ ...options, fetchContent });

export default getGithubContentFactory;
