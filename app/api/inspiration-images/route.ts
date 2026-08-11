type CommonsPage = {
  pageid?: number;
  title?: string;
  imageinfo?: Array<{ url?: string; thumburl?: string; descriptionurl?: string; mime?: string }>;
};

const categoryTerms = {
  clothing: "fashion outfit editorial clothing style",
  makeup: "makeup beauty portrait cosmetics",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim().slice(0, 80) || "editorial fashion";
  const kind = url.searchParams.get("kind") === "makeup" ? "makeup" : "clothing";
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${query} ${categoryTerms[kind]}`,
    gsrnamespace: "6",
    gsrlimit: "24",
    prop: "imageinfo",
    iiprop: "url|mime",
    iiurlwidth: "720",
    format: "json",
    origin: "*",
  });

  try {
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": "GaodianVideoPaipai/1.0 (image inspiration search)" },
    });
    if (!response.ok) throw new Error("upstream unavailable");
    const result = await response.json() as { query?: { pages?: Record<string, CommonsPage> } };
    const images = Object.values(result.query?.pages ?? {}).flatMap(page => {
      const info = page.imageinfo?.[0];
      if (!page.pageid || !info?.url || !info.thumburl || !info.mime?.startsWith("image/") || info.mime === "image/svg+xml" || info.mime === "image/gif") return [];
      return [{ id: String(page.pageid), title: (page.title ?? "参考图片").replace(/^File:/, ""), thumbUrl: info.thumburl, sourceUrl: info.url, creditUrl: info.descriptionurl ?? info.url }];
    }).slice(0, 18);
    return Response.json({ images }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return Response.json({ error: "图片搜索暂时不可用，请稍后再试" }, { status: 502 });
  }
}
