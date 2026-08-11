type CommonsPage = {
  pageid?: number;
  title?: string;
  imageinfo?: Array<{ url?: string; thumburl?: string; descriptionurl?: string; mime?: string }>;
};

const chineseSearchHints = {
  clothing: [
    [/通勤|职场|办公室/, "office fashion"], [/法式|浪漫/, "french fashion"], [/运动|健身/, "sportswear fashion"],
    [/裙|礼服/, "fashion dress"], [/街头|酷|潮/, "street fashion"], [/复古/, "vintage fashion"], [/中式|国风/, "chinese fashion"],
  ] as Array<[RegExp, string]>,
  makeup: [
    [/清透|自然|裸妆/, "natural makeup"], [/复古|港风/, "vintage makeup"], [/欧美|浓妆/, "glam makeup"],
    [/舞台|派对/, "stage makeup"], [/新娘|婚礼/, "bridal makeup"], [/中式|国风/, "chinese makeup"],
  ] as Array<[RegExp, string]>,
};

function commonsSearch(query: string, kind: "clothing" | "makeup") {
  if (/[a-z]/i.test(query)) return query;
  return chineseSearchHints[kind].find(([pattern]) => pattern.test(query))?.[1] ?? (kind === "clothing" ? "fashion outfit" : "beauty makeup portrait");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim().slice(0, 80) || "editorial fashion";
  const kind = url.searchParams.get("kind") === "makeup" ? "makeup" : "clothing";
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: commonsSearch(query, kind),
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
