const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FEEDS = [
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

function strip(html: string): string {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

type NewsItem = {
  title: string;
  link: string;
  summary: string;
  source: string;
  date: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const results = await Promise.allSettled(
      FEEDS.map(async (f) => {
        const res = await fetch(f.url, {
          headers: { "User-Agent": "Mozilla/5.0 StarPostBot" },
        });
        if (!res.ok) return [];
        const xml = await res.text();
        const items =
          xml.match(/<(item|entry)[\s\S]*?<\/\1>/g) ?? [];
        return items.slice(0, 8).map((it): NewsItem => {
          const get = (tag: string) =>
            it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ??
            "";
          const link =
            get("link") ||
            it.match(/<link[^>]*href="([^"]+)"/)?.[1] ||
            "";
          return {
            title: strip(get("title")),
            link: strip(link),
            summary: strip(
              get("description") || get("summary") || get("content"),
            ).slice(0, 400),
            source: f.source,
            date: strip(get("pubDate") || get("published") || get("updated")),
          };
        });
      }),
    );

    const all = results.flatMap((r) =>
      r.status === "fulfilled" ? r.value : [],
    );
    all.sort((a, b) => {
      const rank = (s: string) => (s === "NASA" ? 0 : s === "ESA" ? 1 : 2);
      return (
        rank(a.source) - rank(b.source) ||
        (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)
      );
    });

    return new Response(JSON.stringify(all.slice(0, 20)), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
