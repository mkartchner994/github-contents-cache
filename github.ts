import { request } from "https";
import { extname } from "path";

type FetchContentArgs = {
  token: string;
  owner: string;
  repo: string;
  path: string;
  etag?: string;
};

type FetchContentReturn =
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

export default async function fetchContent({
  owner,
  repo,
  path,
  token,
  etag,
}: FetchContentArgs): Promise<FetchContentReturn> {
  return await new Promise((resolve, reject) => {
    const isFile = extname(path);
    const req = request(
      {
        hostname: "api.github.com",
        port: 443,
        path: `/repos/${owner}/${repo}/contents/${path}`,
        method: "GET",
        headers: {
          accept: "application/vnd.github.v3+json",
          "user-agent": "github-contents-cache package on npm",
          authorization: `token ${token}`,
          ...(etag ? { "If-None-Match": etag } : {}),
        },
      },
      (res) => {
        if (res.statusCode === 200) {
          const chunks = [];
          res
            .on("error", (error) => {
              reject("could_not_parse_response");
            })
            .on("data", (chunk) => {
              chunks.push(chunk);
            })
            .on("end", () => {
              try {
                const bodyString = Buffer.concat(chunks).toString();
                const json = JSON.parse(bodyString);
                let content = json;
                if (isFile) {
                  content = Buffer.from(json.content, "base64").toString(
                    "utf-8"
                  );
                } else {
                  content = json.map((file) => file.name);
                }
                resolve({
                  statusCode: 200,
                  content: content,
                  etag: res.headers.etag,
                });
              } catch (error) {
                reject("could_not_parse_response");
              }
            });
        } else if (res.statusCode === 304) {
          // https://docs.github.com/en/rest/overview/resources-in-the-rest-api#conditional-requests
          resolve({ statusCode: 304 });
        } else if (res.statusCode === 404) {
          resolve({ statusCode: 404 });
        } else if (
          res.statusCode === 403 &&
          typeof res.headers?.["x-ratelimit-remaining"] === "string" &&
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
        } else {
          reject("unsupported_status_code");
        }
      }
    );

    req
      .on("error", (error) => {
        reject("could_not_complete_request");
      })
      .end();
  });
}
