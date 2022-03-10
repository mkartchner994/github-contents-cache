import fetch from "node-fetch";

// Polyfill fetch for cloudflare tests
beforeAll(() => {
  if (!globalThis.fetch) {
    globalThis.fetch = fetch;
  }
});
