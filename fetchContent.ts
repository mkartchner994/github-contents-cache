import type { FetchContentArgs, FetchContentReturn } from "./fetchTypes";
import { request } from "follow-redirects/https";
import { extname } from "path";

export default async function fetchContent({
  owner,
  repo,
  path,
  token,
  userAgent,
  etag,
}: FetchContentArgs): Promise<FetchContentReturn> {
  return await new Promise((resolve, reject) => {
    const isFile = extname(path);
    if (!isFile) {
      return reject(
        new Error(
          `The path ${path} is not a file with an extension, which is currenlty not supported in the github-contents-cache library`
        )
      );
    }
    request(
      {
        hostname: "api.github.com",
        port: 443,
        path: `/repos/${owner}/${repo}/contents/${path}`,
        method: "GET",
        headers: {
          accept: "application/vnd.github.v3+json",
          // https://docs.github.com/en/rest/overview/resources-in-the-rest-api#user-agent-required
          "user-agent": userAgent,
          authorization: `token ${token}`,
          ...(etag ? { "If-None-Match": etag } : {}),
        },
      },
      (res) => {
        if (res.statusCode === 200) {
          const chunks = [];
          res
            .on("data", (chunk) => {
              chunks.push(chunk);
            })
            .on("end", () => {
              try {
                const bodyString = Buffer.concat(chunks).toString();
                const json = JSON.parse(bodyString);
                let content = Buffer.from(json.content, "base64").toString(
                  "utf-8"
                );
                resolve({
                  statusCode: 200,
                  content: content,
                  etag: res.headers.etag,
                });
              } catch (error) {
                reject(
                  new Error(
                    "Received a 200 response from GitHub but could not parse the response body"
                  )
                );
              }
            });
        } else if (res.statusCode === 304) {
          // https://docs.github.com/en/rest/overview/resources-in-the-rest-api#conditional-requests
          resolve({ statusCode: 304 });
        } else if (res.statusCode === 404) {
          resolve({ statusCode: 404 });
        } else if (
          res.statusCode === 403 &&
          res.headers["x-ratelimit-remaining"] &&
          res.headers["x-ratelimit-remaining"].trim() === "0"
        ) {
          // https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limit-http-headers
          const remaining = Number(res.headers["x-ratelimit-remaining"]);
          const limit = Number(res.headers["x-ratelimit-limit"]);
          const timestampTillNextResetInSeconds = Number(
            res.headers["x-ratelimit-reset"]
          );
          resolve({
            statusCode: 403,
            limit,
            remaining,
            timestampTillNextResetInSeconds,
          });
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          reject(
            new Error(
              `Received HTTP response status code ${res.statusCode} from GitHub. This means bad credentials were provided or you do not have access to the resource`
            )
          );
        } else {
          reject(
            new Error(
              `Received HTTP response status code ${res.statusCode} from GitHub which is not an actionable code for the github-contents-cache library`
            )
          );
        }
      }
    )
      .on("error", (error) => {
        reject(new Error("Could not complete request to the GitHub api"));
      })
      .end();
  });
}
