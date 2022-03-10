import getGithubContentFactory from "./getGithubContent";
import fetchContent from "./fetchContentCloudflare";

export type { GetGithubContentCache } from "./getGithubContent";
export default getGithubContentFactory(fetchContent);