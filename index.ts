import getGithubContentFactory from "./getGithubContent";
import fetchContent from "./fetchContent";

export type { GetGithubContentCache } from "./getGithubContent";
export default getGithubContentFactory(fetchContent);
