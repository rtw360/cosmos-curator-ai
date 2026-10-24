export type NewsItem = { title: string; link: string; summary: string; source: string; date: string };
export type NewsResult = { items: NewsItem[]; unavailableSources: string[] };

export const NEWS_FEEDS = [
  { source: "NASA", url: "https://www.nasa.gov/news-release/feed/" },
  { source: "Space.com", url: "https://www.space.com/feeds/all" },
  { source: "ESA", url: "https://www.esa.int/rssfeed/Our_Activities/Space_Science" },
  { source: "Harvard", url: "https://news.harvard.edu/gazette/feed/" },
  { source: "MIT", url: "https://news.mit.edu/topic/mitphysics-rss.xml" },
  { source: "UC Berkeley", url: "https://news.berkeley.edu/feed/" },
  { source: "Caltech", url: "https://feeds.feedburner.com/CaltechNews" },
  { source: "UW", url: "https://www.washington.edu/news/feed/" },
  { source: "Illinois", url: "https://news.illinois.edu/rss" },
];

function strip(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(+n, 0x10ffff)))
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"')
    .replace(/&rsquo;/g, "'").replace(/\s+/g, " ").trim();
}

export function parseFeed(xml: string, source: string): NewsItem[] {
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error("Invalid news feed");
  return (xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? []).slice(0, 8).map((item) => {
    const get = (tag: string) => item.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1] ?? "";
    const atomLinks = Array.from(item.matchAll(/<link\b([^>]+)>/gi));
    const alternate = atomLinks.find((match) => !/rel=["'](?:self|enclosure)["']/i.test(match[1] ?? ""));
    const link = strip(get("link") || alternate?.[1]?.match(/href=["']([^"']+)["']/i)?.[1] || "");
    return { title: strip(get("title")), link, summary: strip(get("description") || get("summary") || get("content")).slice(0, 400), source, date: strip(get("pubDate") || get("published") || get("updated")) };
  }).filter((item) => item.title && /^https?:\/\//i.test(item.link));
}

type Dependencies = { fetcher?: typeof fetch; wait?: (ms: number) => Promise<void> };

export async function loadNewsSource(feed: { source: string; url: string }, deps: Dependencies = {}): Promise<NewsItem[]> {
  const fetcher = deps.fetcher ?? fetch;
  const wait = deps.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt++) {
    let delay = 1000 * 2 ** attempt;
    try {
      const response = await fetcher(feed.url, { headers: { "User-Agent": "Mozilla/5.0 StarPostBot" }, signal: AbortSignal.timeout(6000) });
      if (response.ok) return parseFeed(await response.text(), feed.source);
      if (response.status !== 429 && response.status < 500) throw new TerminalFeedError();
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const retryDelay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter ?? "") - Date.now();
      if (Number.isFinite(retryDelay)) delay = Math.max(delay, retryDelay);
      // Do not keep a preview request waiting indefinitely or retry before a long Retry-After.
      if (delay > 5000) throw new TerminalFeedError();
      await response.body?.cancel();
    } catch (error) {
      if (error instanceof TerminalFeedError || attempt === 2) throw error;
    }
    if (attempt === 2) break;
    await wait(delay);
  }
  throw new Error("News source unavailable after retries");
}

class TerminalFeedError extends Error {}

export async function loadNews(feeds = NEWS_FEEDS, deps: Dependencies = {}): Promise<NewsResult> {
  const results = await Promise.allSettled(feeds.map((feed) => loadNewsSource(feed, deps)));
  const items = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const rank = (source: string) => source === "NASA" ? 0 : source === "ESA" ? 1 : 2;
  items.sort((a, b) => rank(a.source) - rank(b.source) || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  return { items: items.slice(0, 20), unavailableSources: feeds.filter((_, i) => results[i]?.status === "rejected").map((feed) => feed.source) };
}