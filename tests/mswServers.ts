/* istanbul ignore file */

import { setupServer } from "msw/node";
import { rest } from "msw";

const GITHUB_API_URL =
  "https://api.github.com/repos/mkartchner994/github-contents-cache/contents/test-file.mdx";

export const ETAG = '"abcdefghijklmnop"';
export const CONTENT = "This is a Test";
export const CONTENT_UPDATED = "This is Updated Content";
export const SECONDS_UNTIL_NEXT_RESET = (Date.now() + 5000) / 1000;

export const badRequest = setupServer(
  rest.get(GITHUB_API_URL, (req, res) => {
    return res.networkError("Failed to connect");
  })
);

export const foundFileOnGitHub = setupServer(
  rest.get(GITHUB_API_URL, (req, res, ctx) => {
    const body = {
      content: Buffer.from(CONTENT, "utf-8").toString("base64"),
    };
    return res(ctx.status(200), ctx.set("etag", ETAG), ctx.json(body));
  })
);

export const foundFileOnGitHubBadJsonBody = setupServer(
  rest.get(GITHUB_API_URL, (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.set("etag", ETAG),
      ctx.body("{this is a bad json response}")
    );
  })
);

export const foundFileOnGitHubUpdatedContent = setupServer(
  rest.get(GITHUB_API_URL, (req, res, ctx) => {
    const body = {
      content: Buffer.from(CONTENT_UPDATED, "utf-8").toString("base64"),
    };
    return res(ctx.status(200), ctx.set("etag", ETAG), ctx.json(body));
  })
);

export const foundInCacheDidNotChange = setupServer(
  rest.get(GITHUB_API_URL, (req, res, ctx) => {
    return res(ctx.status(304));
  })
);

export const notFounOnGitHub = setupServer(
  rest.get(GITHUB_API_URL, (req, res, ctx) => {
    return res(ctx.status(404));
  })
);

export const rateLimitExceededOnGitHub = setupServer(
  rest.get(GITHUB_API_URL, (req, res, ctx) => {
    return res(
      ctx.status(403),
      ctx.set("x-ratelimit-remaining", "0"),
      ctx.set("x-ratelimit-limit", "5000"),
      ctx.set("x-ratelimit-reset", `${SECONDS_UNTIL_NEXT_RESET}`)
    );
  })
);

export const badCreds = setupServer(
  rest.get(GITHUB_API_URL, (req, res, ctx) => {
    return res(ctx.status(401));
  })
);

export const internalServerErrorOnGitHub = setupServer(
  rest.get(GITHUB_API_URL, (req, res, ctx) => {
    return res(ctx.status(500));
  })
);
