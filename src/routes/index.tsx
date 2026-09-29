import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getNews, generatePost, generateImage, type Post } from "@/lib/posts.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Starpost — AI Instagram posts from astronomy news" },
      { name: "description", content: "Turn astronomy news into Instagram-ready titles, captions, hashtags and images." },
      { property: "og:title", content: "Starpost — AI astronomy post studio" },
      { property: "og:description", content: "Turn astronomy news into Instagram-ready posts with AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const fetchNews = useServerFn(getNews);
  const genPost = useServerFn(generatePost);
  const genImage = useServerFn(generateImage);
  const news = useQuery({ queryKey: ["news"], queryFn: () => fetchNews(), staleTime: 600_000 });

  const [input, setInput] = useState("");
  const [post, setPost] = useState<Post | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"text" | "image" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function makeImage(prompt: string) {
    setBusy("image");
    try {
      const r = await genImage({ data: { prompt } });
      setImage(r.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function run(text: string) {
    if (text.trim().length < 10) return setError("Paste a link or some article text first.");
    setError(null);
    setPost(null);
    setImage(null);
    setBusy("text");
    try {
      const p = await genPost({ data: { input: text } });
      setPost(p);
      await makeImage(p.imagePrompt);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const full = post ? `${post.title}\n\n${post.caption}\n.\n.\n.\n${post.hashtags.map((h) => "#" + h).join(" ")}` : "";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-5">
        <div className="mx-auto flex max-w-6xl items-baseline gap-3">
          <h1 className="font-display text-3xl tracking-tight">Starpost</h1>
          <p className="text-sm text-muted-foreground">astronomy news → Instagram posts</p>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-6 py-8 lg:grid-cols-[1fr_420px]">
        <section className="space-y-8">
          <div className="rounded-xl border border-border bg-card p-5">
            <label className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground">
              Paste an article link or text
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={5}
              placeholder="https://… or paste the article here"
              className="w-full resize-y rounded-md border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={() => run(input)}
              disabled={!!busy}
              className="mt-3 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {busy === "text" ? "Writing post…" : busy === "image" ? "Painting image…" : "Generate post"}
            </button>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Latest astronomy news</h2>
              <button onClick={() => news.refetch()} className="text-xs text-primary hover:underline">
                Refresh
              </button>
            </div>
            {news.isLoading && <p className="text-sm text-muted-foreground">Scanning the skies…</p>}
            {news.isError && <p className="text-sm text-destructive">Couldn't load news feeds.</p>}
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {news.data?.map((n) => (
                <li key={n.link} className="flex gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-wider text-primary">{n.source}</p>
                    <a href={n.link} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      {n.title}
                    </a>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{n.summary}</p>
                  </div>
                  <button
                    disabled={!!busy}
                    onClick={() => {
                      setInput(n.link);
                      run(`${n.link}`).catch(() => {});
                    }}
                    className="h-fit shrink-0 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    Use
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="lg:sticky lg:top-6 lg:h-fit">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <div className="h-7 w-7 rounded-full bg-primary" />
              <span className="text-sm font-medium">your_astro_account</span>
            </div>
            <div className="relative aspect-square bg-muted">
              {image ? (
                <>
                  <img src={image} alt={post?.title ?? "Generated post image"} className="h-full w-full object-cover" />
                  {post && (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-5 pb-5 pt-24">
                      <p className="font-display text-3xl font-bold uppercase leading-tight tracking-wide text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] md:text-4xl">
                        {post.title}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {busy ? "Generating…" : "Your image will appear here"}
                </div>
              )}
            </div>
            {post && (
              <div className="space-y-3 p-4 text-sm">
                <p className="whitespace-pre-line">{post.caption}</p>
                <p className="text-primary">{post.hashtags.map((h) => "#" + h).join(" ")}</p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(full);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                  >
                    {copied ? "Copied!" : "Copy caption"}
                  </button>
                  {image && (
                    <a href={image} download="starpost.png" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
                      Download image
                    </a>
                  )}
                  <button
                    disabled={!!busy}
                    onClick={() => makeImage(post.imagePrompt)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    New image
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
