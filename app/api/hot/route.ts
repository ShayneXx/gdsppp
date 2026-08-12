type HotItem = { rank: number; title: string; hot: number; url: string; source: string };

const douyinSearchUrl = (keyword: string, type: "user" | "general" = "general") =>
  `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=${type}`;

const makeCurated = (entries: Array<[string, string]>, baseHot: number): HotItem[] =>
  entries.map(([title, source], index) => ({
    rank: index + 1,
    title,
    hot: baseHot - index * 37000,
    url: douyinSearchUrl(title.replace(/\s*·.*$/, ""), title.includes("主页") ? "user" : "general"),
    source,
  }));

const contentFallback = makeCurated([
  ["风信子 · 颜值博主主页", "核心参考博主"],
  ["赛博子 · 颜值博主主页", "核心参考博主"],
  ["氛围感颜值博主", "同类型博主词条"],
  ["清冷感镜头博主", "同类型博主词条"],
  ["松弛感日常博主", "同类型博主词条"],
  ["高级感妆造博主", "同类型博主词条"],
  ["甜酷反差感博主", "同类型博主词条"],
  ["情绪文案颜值博主", "同类型博主词条"],
], 980000);

const danceFallback = makeCurated([
  ["秋贝小狼 · 舞蹈博主主页", "核心参考博主"],
  ["饺子 · 舞蹈博主主页", "核心参考博主"],
  ["你枕嬷啦 · 舞蹈博主主页", "核心参考博主"],
  ["甜酷卡点舞蹈博主", "同类型博主词条"],
  ["元气手势舞博主", "同类型博主词条"],
  ["双人齐舞博主", "同类型博主词条"],
  ["全身运镜舞蹈博主", "同类型博主词条"],
  ["简单跟跳舞蹈博主", "同类型博主词条"],
], 970000);

export async function GET() {
  return Response.json({
    contentItems: contentFallback,
    danceItems: danceFallback,
    updatedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
