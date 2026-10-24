import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchNews, generatePost, generateImage, regenerateTitle, type Post } from "@/lib/posts.functions";

const DOWNLOAD_WIDTH = 1080;
const DOWNLOAD_HEIGHT = 1350;

async function loadDownloadImage(src: string) {
  const response = await fetch(src);
  if (!response.ok) throw new Error("Couldn't prepare the image for download.");
  const objectUrl = URL.createObjectURL(await response.blob());
  const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Couldn't prepare the image for download."));
    element.src = objectUrl;
  });
  return { loaded, objectUrl };
}

function wrapTitle(context: CanvasRenderingContext2D, title: string, maxWidth: number) {
  const words = title.toUpperCase().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

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
  const genPost = useServerFn(generatePost);
  const genImage = useServerFn(generateImage);
  const regenTitle = useServerFn(regenerateTitle);
  const getNews = useServerFn(fetchNews);
  const news = useQuery({ queryKey: ["news"], queryFn: () => getNews(), staleTime: 600_000, retry: 2, retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 8000) });

  const [input, setInput] = useState("");
  const [post, setPost] = useState<Post | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"text" | "image" | "title" | "download" | null>(null);
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

  async function makeTitle() {
    if (!post) return;
    setBusy("title");
    setError(null);
    try {
      const r = await regenTitle({ data: { title: post.title, caption: post.caption } });
      setPost({ ...post, title: r.title });
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

  async function downloadImage() {
    if (!image || !post) return;
    setBusy("download");
    setError(null);
    let objectUrl: string | null = null;
    try {
      await document.fonts.ready;
      const source = await loadDownloadImage(image);
      objectUrl = source.objectUrl;
      const canvas = document.createElement("canvas");
      canvas.width = DOWNLOAD_WIDTH;
      canvas.height = DOWNLOAD_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser couldn't create the download.");

      const scale = Math.max(DOWNLOAD_WIDTH / source.loaded.width, DOWNLOAD_HEIGHT / source.loaded.height);
      const width = source.loaded.width * scale;
      const height = source.loaded.height * scale;
      context.drawImage(source.loaded, (DOWNLOAD_WIDTH - width) / 2, (DOWNLOAD_HEIGHT - height) / 2, width, height);

      const fade = context.createLinearGradient(0, DOWNLOAD_HEIGHT * 0.35, 0, DOWNLOAD_HEIGHT);
      fade.addColorStop(0, "transparent");
      fade.addColorStop(0.55, "oklch(0.14 0.03 270 / 0.35)");
      fade.addColorStop(1, "oklch(0.14 0.03 270 / 0.96)");
      context.fillStyle = fade;
      context.fillRect(0, 0, DOWNLOAD_WIDTH, DOWNLOAD_HEIGHT);

      const horizontalPadding = 72;
      const maxWidth = DOWNLOAD_WIDTH - horizontalPadding * 2;
      let fontSize = 112;
      let lines: string[] = [];
      do {
        context.font = `700 ${fontSize}px "Instrument Serif", Georgia, serif`;
        lines = wrapTitle(context, post.title, maxWidth);
        if (lines.length <= 4) break;
        fontSize -= 6;
      } while (fontSize >= 76);

      const lineHeight = fontSize * 0.92;
      const blockHeight = lines.length * lineHeight;
      let y = DOWNLOAD_HEIGHT - 82 - blockHeight + lineHeight;
      context.fillStyle = "oklch(0.95 0.01 90)";
      context.shadowColor = "oklch(0 0 0 / 0.9)";
      context.shadowBlur = 24;
      context.shadowOffsetY = 5;
      context.textBaseline = "alphabetic";
      for (const line of lines) {
        context.fillText(line, horizontalPadding, y, maxWidth);
        y += lineHeight;
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Your browser couldn't create the download.");
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "starpost.png";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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
              <Button variant="link" size="sm" onClick={() => news.refetch()} disabled={news.isFetching}>
                {news.isFetching ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
            {news.isLoading && <p className="text-sm text-muted-foreground">Scanning the skies…</p>}
            {news.isError && <p role="alert" className="text-sm text-destructive">Couldn't reach the news feed after retrying. Please try Refresh.</p>}
            {news.data?.unavailableSources.length ? <p role="status" className="mb-3 text-sm text-muted-foreground">Temporarily unavailable: {news.data.unavailableSources.join(", ")}. Other sources are still shown.</p> : null}
            {news.data && news.data.items.length === 0 && <p role="status" className="mb-3 text-sm text-muted-foreground">No articles are available right now. Please try Refresh shortly.</p>}
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {news.data?.items.map((n) => (
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
            <div className="relative aspect-[4/5] bg-muted">
              {image && (
                <img
                  src={image}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/30 to-background/10" />
              {post ? (
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <h3 className="font-display text-4xl font-bold uppercase leading-[0.95] tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] md:text-5xl">
                    {post.title}
                  </h3>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {busy ? "Generating…" : "Your post will appear here"}
                </div>
              )}
            </div>
            {post && (
              <div className="space-y-3 p-5">
                <p className="text-sm leading-relaxed">{post.caption}</p>
                <p className="text-xs leading-relaxed text-primary">
                  {post.hashtags.map((h) => "#" + h).join(" ")}
                </p>
                <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
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
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={downloadImage}
                      className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                    >
                      {busy === "download" ? "Preparing…" : "Download image"}
                    </button>
                  )}
                  <button
                    disabled={!!busy}
                    onClick={makeTitle}
                    className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    {busy === "title" ? "Rewriting…" : "New title"}
                  </button>
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
