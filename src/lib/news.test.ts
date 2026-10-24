import { describe, expect, it } from "vitest";
import { loadNews, loadNewsSource, parseFeed } from "./news";

const xml = '<rss><channel><item><title>Space discovery</title><link>https://example.org/article</link><description>Science</description></item></channel></rss>';
const feed = { source: "NASA", url: "https://example.org/rss" };

describe("news recovery", () => {
  it("automatically retries a failed source and returns its articles", async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetcher: typeof fetch = async () => ++calls === 1 ? new Response(null, { status: 503 }) : new Response(xml);
    const result = await loadNewsSource(feed, { fetcher, wait: async (ms) => { delays.push(ms); } });
    expect(calls).toBe(2);
    expect(delays).toEqual([1000]);
    expect(result[0]?.title).toBe("Space discovery");
  });
  it("bounds failures to three attempts with backoff", async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetcher: typeof fetch = async () => { calls++; throw new TypeError("Network unavailable"); };
    await expect(loadNewsSource(feed, { fetcher, wait: async (ms) => { delays.push(ms); } })).rejects.toThrow();
    expect(calls).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });
  it("keeps healthy sources when another fails", async () => {
    const fetcher: typeof fetch = async (url) => String(url).includes("broken") ? new Response(null, { status: 404 }) : new Response(xml);
    const result = await loadNews([feed, { source: "College", url: "https://broken.org/rss" }], { fetcher, wait: async () => {} });
    expect(result.items).toHaveLength(1);
    expect(result.unavailableSources).toEqual(["College"]);
  });
  it("honors Retry-After for rate-limited sources", async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetcher: typeof fetch = async () => ++calls === 1 ? new Response(null, { status: 429, headers: { "Retry-After": "3" } }) : new Response(xml);
    await loadNewsSource(feed, { fetcher, wait: async (ms) => { delays.push(ms); } });
    expect(delays).toEqual([3000]);
  });
  it("does not retry permanent source errors", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return new Response(null, { status: 403 }); };
    await expect(loadNewsSource(feed, { fetcher })).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it("retains Atom college articles", () => {
    expect(parseFeed('<feed><entry><title>College space research</title><link rel="alternate" href="https://college.edu/story" /></entry></feed>', "Caltech")[0]?.link).toBe("https://college.edu/story");
  });
});