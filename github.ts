import { request } from "https";

export async function fetchContent({
  owner,
  repo,
  path,
  token,
  etag,
}: {
  token: string;
  owner: string;
  repo: string;
  path: string;
  etag?: string;
}): Promise<{ statusCode: number; content?: string; etag?: string }> {
  return await new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "api.github.com",
        port: 443,
        path: `/repos/${owner}/${repo}/contents/${path}`,
        method: "GET",
        headers: {
          "user-agent": "Mozilla/4.0 Custom User Agent",
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
                resolve({
                  statusCode: 200,
                  content: Buffer.from(json.content, "base64").toString(
                    "utf-8"
                  ),
                  etag: res.headers.etag,
                });
              } catch (error) {
                reject("could_not_parse_response");
              }
            });
        } else if (res.statusCode === 304) {
          resolve({ statusCode: 304 });
        } else if (res.statusCode === 404) {
          resolve({ statusCode: 404 });
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
