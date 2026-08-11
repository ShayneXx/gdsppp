type SocialSource = "xiaohongshu" | "instagram";

function sourcePageHost(hostname: string, source: SocialSource) {
  return source === "xiaohongshu"
    ? hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com") || hostname === "xhslink.com" || hostname.endsWith(".xhslink.com")
    : hostname === "instagram.com" || hostname.endsWith(".instagram.com");
}

function mediaHost(hostname: string, source: SocialSource) {
  return source === "xiaohongshu"
    ? hostname === "xhscdn.com" || hostname.endsWith(".xhscdn.com")
    : hostname === "cdninstagram.com" || hostname.endsWith(".cdninstagram.com") || hostname === "fbcdn.net" || hostname.endsWith(".fbcdn.net");
}

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function metaContent(html: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"))?.[1];
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { url?: string; source?: SocialSource };
    const source: SocialSource = body.source === "instagram" ? "instagram" : "xiaohongshu";
    if (!body.url) return Response.json({ error: "请粘贴帖子或图片链接" }, { status: 400 });
    const input = new URL(body.url);
    if (input.protocol !== "https:" || (!sourcePageHost(input.hostname, source) && !mediaHost(input.hostname, source))) return Response.json({ error: `请粘贴有效的${source === "xiaohongshu" ? "小红书" : " Instagram"}链接` }, { status: 400 });

    const response = await fetch(input, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7" } });
    if (!response.ok) throw new Error("source unavailable");
    const contentType = response.headers.get("content-type") ?? "";
    let sourceUrl = response.url;
    let title = source === "xiaohongshu" ? "小红书参考图" : "Instagram 参考图";
    let creditUrl = input.toString();

    if (!contentType.startsWith("image/")) {
      const html = await response.text();
      const image = metaContent(html, "og:image");
      if (!image) return Response.json({ error: "该帖子暂时无法提取图片，请复制图片地址后重试" }, { status: 422 });
      sourceUrl = decodeHtml(image);
      title = decodeHtml(metaContent(html, "og:title") ?? title).slice(0, 160);
    }
    const media = new URL(sourceUrl);
    if (media.protocol !== "https:" || !mediaHost(media.hostname, source)) return Response.json({ error: "未识别到平台图片地址" }, { status: 422 });
    return Response.json({ image: { id: `social-${source}-${Date.now()}`, title, thumbUrl: sourceUrl, sourceUrl, creditUrl } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "链接解析失败，请确认内容公开或改用图片地址" }, { status: 502 });
  }
}
