import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GW = "https://ai.gateway.lovable.dev";

function strip(html: string) {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const FEEDS = [
  { source: "NASA", url: "https://www.nasa.gov/news-release/feed/" },
  { source: "Space.com", url: "https://www.space.com/feeds/all" },
  { source: "ESA", url: "https://www.esa.int/rssfeed/Our_Activities/Space_Science" },
];

export type NewsItem = { title: string; link: string; summary: string; source: string; date: string };

export const getNews = createServerFn({ method: "GET" }).handler(async () => {
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => {
      const res = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 StarPostBot" } });
      if (!res.ok) return [];
      const xml = await res.text();
      const items = xml.match(/<item[\s\S]*?<\/item>/g) ?? [];
      return items.slice(0, 8).map((it): NewsItem => {
        const get = (tag: string) => it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
        return {
          title: strip(get("title")),
          link: strip(get("link")),
          summary: strip(get("description")).slice(0, 400),
          source: f.source,
          date: strip(get("pubDate")),
        };
      });
    }),
  );
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  all.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  return all.slice(0, 20);
});

async function articleText(input: string) {
  const trimmed = input.trim();
  if (/^https?:\/\/\S+$/.test(trimmed)) {
    const res = await fetch(trimmed, { headers: { "User-Agent": "Mozilla/5.0 StarPostBot" } });
    if (!res.ok) throw new Error(`Couldn't open that link (status ${res.status}). Try pasting the article text instead.`);
    const html = await res.text();
    const body = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
    return `Source URL: ${trimmed}\n\n${strip(body).slice(0, 12000)}`;
  }
  return trimmed.slice(0, 12000);
}

export type Post = { title: string; caption: string; hashtags: string[]; imagePrompt: string };

export const generatePost = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ input: z.string().min(10).max(20000) }).parse(d))
  .handler(async ({ data }): Promise<Post> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured.");
    const text = await articleText(data.input);
    const res = await fetch(`${GW}/v1/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        instructions:
          "You are a social media editor for an astronomy Instagram account. From the article, write: a punchy title (max 70 chars, may include one emoji); an Instagram caption of 80-150 words that hooks in the first line, explains the science accurately and accessibly, uses short paragraphs separated by blank lines, a few tasteful emojis, and ends with a question or call to action; 15-25 relevant hashtags (without #, mixing broad and niche); and a detailed prompt for a striking, scientifically plausible square image illustrating the story (no text in the image).",
        input: text,
        text: {
          format: {
            type: "json_schema",
            name: "post",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                caption: { type: "string" },
                hashtags: { type: "array", items: { type: "string" } },
                imagePrompt: { type: "string" },
              },
              required: ["title", "caption", "hashtags", "imagePrompt"],
            },
          },
        },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 429) throw new Error("Too many requests right now — please wait a moment.");
      if (res.status === 402) throw new Error("Out of AI credits. Add credits in workspace settings.");
      throw new Error(`AI request failed (${res.status}): ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const out =
      json.output_text ??
      json.output
        ?.flatMap((o: any) => o.content ?? [])
        .filter((c: any) => c.type === "output_text")
        .map((c: any) => c.text)
        .join("");
    if (!out) throw new Error("The AI returned no content.");
    const post = JSON.parse(out) as Post;
    post.hashtags = post.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, ""));
    return post;
  });

export const generateImage = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ prompt: z.string().min(5).max(4000) }).parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured.");
    const res = await fetch(`${GW}/v1/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-image-2.5-sunburst",
        prompt: `${data.prompt}\n\nSquare 1:1 Instagram composition, cinematic, high detail, no text or watermarks.`,
        size: "1024x1024",
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 429) throw new Error("Too many requests right now — please wait a moment.");
      if (res.status === 402) throw new Error("Out of AI credits. Add credits in workspace settings.");
      throw new Error(`Image request failed (${res.status}): ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const item = json.data?.[0];
    if (item?.b64_json) return { url: `data:image/png;base64,${item.b64_json}` };
    if (item?.url) return { url: item.url as string };
    throw new Error("No image was returned.");
  });
