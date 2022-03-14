import type { FetchContentArgs, FetchContentReturn } from "./fetchTypes";

export default async function fetchContent({
  owner,
  repo,
  path,
  token,
  userAgent,
  etag,
}: FetchContentArgs): Promise<FetchContentReturn> {
  return await new Promise((resolve, reject) => {
    const fileExtension = path.split(".").pop();
    if (fileExtension.includes("/") || !path.includes(".")) {
      return reject(
        new Error(
          `The path ${path} is not a file with an extension, which is currenlty not supported in the github-contents-cache library`
        )
      );
    }
    fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      headers: {
        accept: "application/vnd.github.v3+json",
        // https://docs.github.com/en/rest/overview/resources-in-the-rest-api#user-agent-required
        "user-agent": userAgent,
        authorization: `token ${token}`,
        ...(etag ? { "If-None-Match": etag } : {}),
      },
    })
      .then(async (res) => {
        if (res.status === 200) {
          try {
            const json = await res.json();
            const content = atob(json.content);
            resolve({
              statusCode: 200,
              content: content,
              etag: res.headers.get("etag"),
            });
          } catch (error) {
            reject(
              new Error(
                "Received a 200 response from GitHub but could not parse the response body"
              )
            );
          }
        } else if (res.status === 304) {
          resolve({ statusCode: 304 });
        } else if (res.status === 404) {
          resolve({ statusCode: 404 });
        } else if (
          res.status === 403 &&
          res.headers.get("x-ratelimit-remaining") &&
          res.headers.get("x-ratelimit-remaining").trim() === "0"
        ) {
          // https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limit-http-headers
          const remaining = Number(res.headers.get("x-ratelimit-remaining"));
          const limit = Number(res.headers.get("x-ratelimit-limit"));
          const timestampTillNextResetInSeconds = Number(
            res.headers.get("x-ratelimit-reset")
          );
          resolve({
            statusCode: 403,
            limit,
            remaining,
            timestampTillNextResetInSeconds,
          });
        } else if (res.status === 401 || res.status === 403) {
          reject(
            new Error(
              `Received HTTP response status code ${res.status} from GitHub. This means bad credentials were provided or you do not have access to the resource`
            )
          );
        } else {
          reject(
            new Error(
              `Received HTTP response status code ${res.status} from GitHub which is not an actionable code for the github-contents-cache library`
            )
          );
        }
      })
      .catch((e) => {
        reject(new Error("Could not complete request to the GitHub api"));
      });
  });
}
