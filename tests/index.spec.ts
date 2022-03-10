import getGithubContent, { GetGithubContentCache } from "../index";
import getGithubContentCloudflare from "../cloudflare";
import {
  CONTENT,
  CONTENT_UPDATED,
  ETAG,
  SECONDS_UNTIL_NEXT_RESET,
  foundFileOnGitHub,
  foundFileOnGitHubBadJsonBody,
  foundFileOnGitHubUpdatedContent,
  foundInCacheDidNotChange,
  notFounOnGitHub,
  rateLimitExceededOnGitHub,
  badCreds,
  badRequest,
  internalServerErrorOnGitHub,
} from "./mswServers";

function createTestSuite(platform = "node") {
  const getGithubContentByPlatform =
    platform === "node" ? getGithubContent : getGithubContentCloudflare;

  function Cache({
    foundInCache = false,
    type404 = false,
    typeMaxAge = false,
    setMockFn = (...args) => {},
  }): GetGithubContentCache {
    return {
      get: async () => {
        if (foundInCache === false) {
          return null;
        }
        if (foundInCache && type404) {
          // time - assume this was cached 5 seconds in the past
          return { type: "notFound", time: Date.now() - 5000 };
        }
        return {
          type: "found",
          // time - assume this was cached 5 seconds in the past if we are testing maxAge
          time: typeMaxAge ? Date.now() - 5000 : Date.now(),
          content: CONTENT,
          etag: ETAG,
        };
      },
      set: async (...args) => {
        setMockFn(...args);
      },
      remove: async () => {},
    };
  }

  async function serialize(content) {
    return content.toLowerCase();
  }

  function getContentFromMkartchner994(args) {
    return getGithubContentByPlatform({
      token: "123",
      owner: "mkartchner994",
      repo: "github-contents-cache",
      path: "test-file.mdx",
      userAgent: "Github user mkartchner994 personal blog",
      ...args,
    });
  }

  function getContentFromMkartchner994Dir(args) {
    return getGithubContentByPlatform({
      token: "123",
      owner: "mkartchner994",
      repo: "github-contents-cache",
      path: "contentDir",
      userAgent: "Github user mkartchner994 personal blog",
      ...args,
    });
  }

  describe(`Tests for ${platform}`, () => {
    test(`An error is thrown if not all of the required arguments are provided`, async () => {
      badCreds.listen();
      await expect(
        getContentFromMkartchner994({}) // not providing cache
      ).rejects.toThrowError(
        "Please provide all of the required arguments - { token, owner, repo, path, userAgent, cache }"
      );
      badCreds.close();
    });

    test(`Throw an error if a bad token was provided`, async () => {
      badCreds.listen();
      const cache = Cache({ foundInCache: false });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      // Because we don't have the actual instance of the error, checking response.error.message matches our expected error string
      expect(response.status).toEqual("error");
      // @ts-ignore
      expect(response.message).toEqual(
        "Unexpected error when looking for content on GitHub at path test-file.mdx"
      );
      // @ts-ignore
      expect(response.error.message).toEqual(
        "Received HTTP response status code 401 from GitHub. This means bad credentials were provided or you do not have access to the resource"
      );
      badCreds.close();
    });

    test(`Throw an error if the path is not a file with an extension`, async () => {
      foundFileOnGitHub.listen();
      const cache = Cache({ foundInCache: false });
      const response = await getContentFromMkartchner994Dir({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      // Because we don't have the actual instance of the error, checking response.error.message matches our expected error string
      expect(response.status).toEqual("error");
      // @ts-ignore
      expect(response.message).toEqual(
        "Unexpected error when looking for content on GitHub at path contentDir"
      );
      // @ts-ignore
      expect(response.error.message).toEqual(
        "The path contentDir is not a file with an extension, which is currenlty not supported in the github-contents-cache library"
      );
      foundFileOnGitHub.close();
    });

    test(`Throw an error if the request cannot be made`, async () => {
      badRequest.listen();
      const cache = Cache({ foundInCache: false });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      // Because we don't have the actual instance of the error, checking response.error.message matches our expected error string
      expect(response.status).toEqual("error");
      // @ts-ignore
      expect(response.message).toEqual(
        "Unexpected error when looking for content on GitHub at path test-file.mdx"
      );
      // @ts-ignore
      expect(response.error.message).toEqual(
        "Could not complete request to the GitHub api"
      );
      badRequest.close();
    });

    test(`Throw an error if malformed json is received from GitHub`, async () => {
      foundFileOnGitHubBadJsonBody.listen();
      const cache = Cache({ foundInCache: false });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      // Because we don't have the actual instance of the error, checking response.error.message matches our expected error string
      expect(response.status).toEqual("error");
      // @ts-ignore
      expect(response.message).toEqual(
        "Unexpected error when looking for content on GitHub at path test-file.mdx"
      );
      // @ts-ignore
      expect(response.error.message).toEqual(
        "Received a 200 response from GitHub but could not parse the response body"
      );
      foundFileOnGitHubBadJsonBody.close();
    });

    test(`NOT FOUND in cache, FOUND in GitHub, YES serialize method provided - return { status: "found", cacheHit: false, content: <serialized content> }`, async () => {
      foundFileOnGitHub.listen();
      const cache = Cache({ foundInCache: false });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      const expectedResponse = {
        status: "found",
        content: await serialize(CONTENT),
        etag: ETAG,
        cacheHit: false,
      };
      expect(response).toEqual(expectedResponse);
      foundFileOnGitHub.close();
    });

    test(`NOT FOUND in cache, FOUND in GitHub, NO serialize method provided - return { status: "found", cacheHit: false, content: <content> }`, async () => {
      foundFileOnGitHub.listen();
      const cache = Cache({ foundInCache: false });
      const response = await getContentFromMkartchner994({
        ignoreCache: false,
        cache: cache,
      });
      const expectedResponse = {
        status: "found",
        content: CONTENT,
        etag: ETAG,
        cacheHit: false,
      };
      expect(response).toEqual(expectedResponse);
      foundFileOnGitHub.close();
    });

    test(`FOUND in cache, UPDATE NOT FOUND in GitHub - return { status: "found", cacheHit: true, content: <cached content> }`, async () => {
      foundInCacheDidNotChange.listen();
      const cache = Cache({ foundInCache: true });
      const response = await getContentFromMkartchner994({
        ignoreCache: false,
        serialize: serialize,
        cache: cache,
      });
      const cachedResults = await cache.get("test-file.mdx");
      const expectedResponse = {
        status: "found",
        // @ts-ignore
        content: cachedResults.content,
        // @ts-ignore
        etag: cachedResults.etag,
        cacheHit: true,
      };
      expect(response).toEqual(expectedResponse);
      foundInCacheDidNotChange.close();
    });

    test(`FOUND in cache, UPDATE FOUND in GitHub - return { status: "found", cacheHit: false, content: <updated serialized content> }`, async () => {
      foundFileOnGitHubUpdatedContent.listen();
      const cache = Cache({ foundInCache: true });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      const cachedResults = await cache.get("test-file.mdx");
      // @ts-ignore
      expect(cachedResults?.type).toEqual("found");
      // @ts-ignore
      expect(cachedResults?.content).toEqual(CONTENT);
      const expectedResponse = {
        status: "found",
        content: await serialize(CONTENT_UPDATED),
        etag: ETAG,
        cacheHit: false,
      };
      expect(response).toEqual(expectedResponse);
      foundFileOnGitHubUpdatedContent.close();
    });

    test(`NOT FOUND in cache, NOT FOUND in GitHub - return { status: "notFound", cacheHit: false, content: "" }`, async () => {
      notFounOnGitHub.listen();
      const cache = Cache({ foundInCache: false });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      const expectedResponse = {
        status: "notFound",
        content: "",
        cacheHit: false,
      };
      expect(response).toEqual(expectedResponse);
      notFounOnGitHub.close();
    });

    test(`FOUND in cache, NOT FOUND in GitHub - return { status: "notFound", cacheHit: false, content: "" }`, async () => {
      notFounOnGitHub.listen();
      const cache = Cache({ foundInCache: true });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      const expectedResponse = {
        status: "notFound",
        content: "",
        cacheHit: false,
      };
      expect(response).toEqual(expectedResponse);
      notFounOnGitHub.close();
    });

    test(`NOT FOUND in cache, GitHub rate limit exceeded - return { status: "rateLimitExceeded", cacheHit: false, content: "", ... }`, async () => {
      rateLimitExceededOnGitHub.listen();
      const cache = Cache({ foundInCache: false });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      const expectedResponse = {
        status: "rateLimitExceeded",
        limit: 5000,
        remaining: 0,
        timestampTillNextResetInSeconds: SECONDS_UNTIL_NEXT_RESET,
        content: "",
        etag: "",
        cacheHit: false,
      };
      expect(response).toEqual(expectedResponse);
      rateLimitExceededOnGitHub.close();
    });

    test(`FOUND in cache, GitHub rate limit exceeded - return { status: "rateLimitExceeded", cacheHit: true, content: <cached content>, ... }`, async () => {
      rateLimitExceededOnGitHub.listen();
      const cache = Cache({ foundInCache: true });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      const cachedResults = await cache.get("test-file.mdx");
      const expectedResponse = {
        status: "rateLimitExceeded",
        limit: 5000,
        remaining: 0,
        timestampTillNextResetInSeconds: SECONDS_UNTIL_NEXT_RESET,
        // @ts-ignore
        content: cachedResults.content,
        // @ts-ignore
        etag: cachedResults.etag,
        cacheHit: true,
      };
      expect(response).toEqual(expectedResponse);
      rateLimitExceededOnGitHub.close();
    });

    test(`FOUND in cache, ignoreCache TRUE, FOUND in GitHub - return { status: "found", cacheHit: false, content: <serialized content> }`, async () => {
      foundFileOnGitHub.listen();
      const cache = Cache({ foundInCache: true });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: true,
        cache: cache,
      });
      const expectedResponse = {
        status: "found",
        content: await serialize(CONTENT),
        etag: ETAG,
        cacheHit: false,
      };
      expect(response).toEqual(expectedResponse);
      foundFileOnGitHub.close();
    });

    test(`FOUND in cache, ignoreCache TRUE, NOT FOUND in GitHub - return { status: "notFound", cacheHit: false, content: "" }`, async () => {
      notFounOnGitHub.listen();
      const cache = Cache({ foundInCache: true });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: true,
        cache: cache,
      });
      const expectedResponse = {
        status: "notFound",
        content: "",
        cacheHit: false,
      };
      expect(response).toEqual(expectedResponse);
      notFounOnGitHub.close();
    });

    test(`FOUND in cache, INTERNAL SERVER ERROR from GitHub - return { status: "found", cacheHit: true, content: <cached content> }`, async () => {
      internalServerErrorOnGitHub.listen();
      const cache = Cache({ foundInCache: true });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      const cachedResults = await cache.get("test-file.mdx");
      const expectedResponse = {
        status: "found",
        // @ts-ignore
        content: cachedResults.content,
        // @ts-ignore
        etag: cachedResults.etag,
        cacheHit: true,
      };
      expect(response).toEqual(expectedResponse);
      internalServerErrorOnGitHub.close();
    });

    test(`NOT FOUND in cache, INTERNAL SERVER ERROR from GitHub - return { status: "error", error: <Error>, message: "..." }`, async () => {
      internalServerErrorOnGitHub.listen();
      const cache = Cache({ foundInCache: false });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      // Because we don't have the actual instance of the error, checking response.error.message matches our expected error string
      expect(response.status).toEqual("error");
      // @ts-ignore
      expect(response.message).toEqual(
        "Unexpected error when looking for content on GitHub at path test-file.mdx"
      );
      // @ts-ignore
      expect(response.error.message).toEqual(
        "Received HTTP response status code 500 from GitHub which is not an actionable code for the github-contents-cache library"
      );
      internalServerErrorOnGitHub.close();
    });

    test(`FOUND 404 in cache, max404AgeInMilliseconds provided HAS elapsed, SHOULD retry for new content - return { status: "found", cacheHit: false, content: <serialized content> }`, async () => {
      foundFileOnGitHub.listen();
      const cache = Cache({ foundInCache: true, type404: true });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
        max404AgeInMilliseconds: 1,
      });
      const expectedResponse = {
        status: "found",
        content: await serialize(CONTENT),
        etag: ETAG,
        cacheHit: false,
      };
      expect(response).toEqual(expectedResponse);
      foundFileOnGitHub.close();
    });

    test(`FOUND 404 in cache, max404AgeInMilliseconds provided HAS NOT elapsed, SHOULD NOT retry for new content - return { status: "notFound", cacheHit: true, content: "" }`, async () => {
      foundFileOnGitHub.listen();
      const cache = Cache({ foundInCache: true, type404: true });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
        max404AgeInMilliseconds: 10000,
      });
      const expectedResponse = {
        status: "notFound",
        content: "",
        cacheHit: true,
      };
      expect(response).toEqual(expectedResponse);
      foundFileOnGitHub.close();
    });

    test(`FOUND in cache, maxAgeInMilliseconds provided HAS elapsed, SHOULD retry for new content - return { status: "found", cacheHit: false, content: <serialized content> }`, async () => {
      foundFileOnGitHub.listen();
      const setMockFn = jest.fn();
      const cache = Cache({ foundInCache: true, typeMaxAge: true, setMockFn });
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
        maxAgeInMilliseconds: 1,
      });
      const expectedResponse = {
        status: "found",
        content: await serialize(CONTENT),
        etag: ETAG,
        cacheHit: false,
      };
      expect(response).toEqual(expectedResponse);
      expect(setMockFn).toHaveBeenCalled();
      foundFileOnGitHub.close();
    });

    test(`FOUND in cache, maxAgeInMilliseconds provided HAS elapsed, UPDATE NOT FOUND in GitHub - return { status: "found", cacheHit: true, content: <cached content> }`, async () => {
      foundInCacheDidNotChange.listen();
      const setMockFn = jest.fn();
      const cache = Cache({ foundInCache: true, typeMaxAge: true, setMockFn });
      const response = await getContentFromMkartchner994({
        ignoreCache: false,
        cache: cache,
        maxAgeInMilliseconds: 1,
      });
      const expectedResponse = {
        status: "found",
        content: CONTENT,
        etag: ETAG,
        cacheHit: true,
      };
      expect(response).toEqual(expectedResponse);
      expect(setMockFn).toHaveBeenCalled();
      foundInCacheDidNotChange.close();
    });

    test(`FOUND in cache, maxAgeInMilliseconds provided HAS NOT elapsed, SHOULD NOT retry for new content - return { status: "found", cacheHit: true, content: <cached content> }`, async () => {
      foundFileOnGitHub.listen();
      const setMockFn = jest.fn();
      const cache = Cache({ foundInCache: true, typeMaxAge: true, setMockFn });
      const response = await getContentFromMkartchner994({
        ignoreCache: false,
        cache: cache,
        maxAgeInMilliseconds: 10000,
      });
      const expectedResponse = {
        status: "found",
        content: CONTENT,
        etag: ETAG,
        cacheHit: true,
      };
      expect(response).toEqual(expectedResponse);
      expect(setMockFn).not.toHaveBeenCalled();
      foundFileOnGitHub.close();
    });

    test(`Error when 'getting' from cache - return { status: "error", error: <Error>, message: "..." }`, async () => {
      foundFileOnGitHub.listen();
      const cache = Cache({ foundInCache: false });
      const error = new Error("Error getting from cache");
      cache.get = async () => {
        throw error;
      };
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      const expectedResponse = {
        status: "error",
        message:
          "Error when trying to get entry from the cache at path test-file.mdx",
        error: error,
      };
      expect(response).toEqual(expectedResponse);
      foundFileOnGitHub.close();
    });

    test(`Error when 'setting' to cache, FOUND in GitHub - return { status: "found", cacheHit: false, content: <serialized content> }`, async () => {
      foundFileOnGitHub.listen();
      const cache = Cache({ foundInCache: false });
      cache.set = async () => {
        throw new Error("Error setting to cache");
      };
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      const expectedResponse = {
        status: "found",
        content: await serialize(CONTENT),
        etag: ETAG,
        cacheHit: false,
      };
      expect(response).toEqual(expectedResponse);
      foundFileOnGitHub.close();
    });

    test(`Error when 'setting' to cache, NOT FOUND in GitHub - return { status: "notFound", cacheHit: false, content: "" }`, async () => {
      notFounOnGitHub.listen();
      const cache = Cache({ foundInCache: false });
      cache.set = async () => {
        throw new Error("Error setting to cache");
      };
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      const expectedResponse = {
        status: "notFound",
        content: "",
        cacheHit: false,
      };
      expect(response).toEqual(expectedResponse);
      notFounOnGitHub.close();
    });

    test(`Error when 'removing' from cache - return { status: "error", error: <Error>, message: "..." }`, async () => {
      foundFileOnGitHub.listen();
      const cache = Cache({ foundInCache: true });
      const error = new Error("could not remove from cache");
      cache.remove = async () => {
        throw error;
      };
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: true,
        cache: cache,
      });
      const expectedResponse = {
        status: "error",
        message:
          "Error when trying to remove entry from the cache at path test-file.mdx",
        error: error,
      };
      expect(response).toEqual(expectedResponse);
      foundFileOnGitHub.close();
    });

    test(`Error when serializing content - return { status: "error", error: <Error>, message: "..." }`, async () => {
      foundFileOnGitHub.listen();
      const cache = Cache({ foundInCache: false });
      const error = new Error("Could not serialize content");
      const serialize = async () => {
        throw error;
      };
      const response = await getContentFromMkartchner994({
        serialize: serialize,
        ignoreCache: false,
        cache: cache,
      });
      const expectedResponse = {
        status: "error",
        message: "Error occured when serializing the content",
        error: error,
      };
      expect(response).toEqual(expectedResponse);
      foundFileOnGitHub.close();
    });
  });
}

createTestSuite("node");
createTestSuite("cloudflare");
