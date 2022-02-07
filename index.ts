import controlFlow from "./controlFlow";
import { fetchContent } from "./github";

interface CacheInterface {
  get: (path: string) => Promise<any>;
  set: (path: string, content: any) => Promise<any>;
  remove: (path: string) => Promise<any>;
}

export default async function getGithubContent({
  token,
  owner,
  repo,
  path,
  max404CacheTimeInMilliseconds = Infinity,
  clearCache,
  cache,
}: {
  token: string;
  owner: string;
  repo: string;
  path: string;
  max404CacheTimeInMilliseconds?: number;
  clearCache: boolean;
  cache: CacheInterface;
}): Promise<
  | { status: "found"; content: string; cacheHit: boolean }
  | { status: "notFound"; content: ""; cacheHit: boolean }
> {
  let result = await controlFlow<{
    cacheHit?: {
      time: number;
      content: string;
      etag: string;
    };
  }>({
    logSteps: true,
    initialStep: clearCache ? "clearCacheEntry" : "lookInCache",
    stepContext: {},
    steps: {
      clearCacheEntry: {
        entry: async () => {
          try {
            await cache.remove(path);
            return { nextEvent: "onCachedCleared" };
          } catch (error) {
            return { nextEvent: "onError" };
          }
        },
        onCachedCleared: "lookInGithub", // Was able to clear the cache, lets get the latest from github
        onError: "error", // Something went wrong clearing the cache - either from a corrupt cache or a manual call to clear
      },
      lookInCache: {
        entry: async (stepContext) => {
          try {
            const cachedResults = await cache.get(path);
            if (!cachedResults) {
              return {
                nextEvent: "onNotInCache",
              };
            }
            try {
              const parsedResult = JSON.parse(cachedResults);
              if (parsedResult.notFound) {
                if (
                  parsedResult.time &&
                  Date.now() - parsedResult.time > max404CacheTimeInMilliseconds
                ) {
                  return { nextEvent: "on404CacheExpired" };
                }
                return { nextEvent: "on404InCache", cacheHit: true };
              }
              stepContext.cacheHit = parsedResult;
              return { nextEvent: "onFoundInCache" };
            } catch (error) {
              return {
                nextEvent: "onCorruptCache",
              };
            }
          } catch (error) {
            return {
              nextEvent: "onError",
            };
          }
        },
        onFoundInCache: "lookInGithub", // Ask github if what we have in cache is stale (Does Not count against our api limit)
        onNotInCache: "lookInGithub", // Ask for it from github (Does count against our api limit)
        on404CacheExpired: "clearCacheEntry", // We found a cache 404 but it has expired
        onCorruptCache: "clearCacheEntry", // We found something in the cache but we could not parse it
        on404InCache: "404", // We asked github earlier and they said they didn't have it
        onError: "error", // Unknown error we couldn't recover from
      },
      lookInGithub: {
        entry: async (stepContext) => {
          try {
            let resp = await fetchContent({
              token,
              owner,
              repo,
              path,
              etag: stepContext?.cacheHit?.etag,
            });
            // If the content isn't modified or the github api is not working
            // but we still have a cached version of the content, return what is in our cache
            if (resp.statusCode === 304) {
              return {
                nextEvent: "onFound",
                content: stepContext?.cacheHit?.content,
                cacheHit: true,
              };
            }
            if (resp.statusCode === 404) {
              // This file wasn't found in github, cache the 404 response so we don't hit our api limit
              // We can use the time field to expire this cache entry in the future if we want
              cache
                .set(path, JSON.stringify({ time: Date.now(), notFound: true }))
                .catch(() => {});
              return { nextEvent: "on404FromGithub", cacheHit: false };
            }

            cache
              .set(
                path,
                JSON.stringify({
                  time: Date.now(),
                  content: resp.content,
                  etag: resp.etag,
                })
              )
              .catch(() => {});

            return {
              nextEvent: "onFound",
              content: resp.content,
              cacheHit: false,
            };
          } catch (error: any) {
            // We didn't get back what we expected from the github api, but we have it cached
            // so lets return that
            if (stepContext?.cacheHit?.content) {
              return {
                nextEvent: "onFound",
                content: stepContext.cacheHit.content,
                cacheHit: true,
              };
            }
            // Treat anything else as an internal server error
            return { nextEvent: "onError" };
          }
        },
        onFound: "found", // Either came from the cache or from github and then we cached it
        on404FromGithub: "404", // Github said they didn't have it
        onError: "error", // Having trouble getting data from the github api?
      },
      found: { final: true }, // Got it!
      "404": { final: true }, // Don't have it
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
  if (result.step == "404") {
    return { status: "notFound", content: "", cacheHit: result.data.cacheHit };
  }
  throw new Error("could_not_get_content");
}
