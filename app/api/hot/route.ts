type RawHotItem = { word?: string; hotindex?: number };
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

const appendLive = (curated: HotItem[], live: HotItem[]) =>
  [...curated, ...live]
    .filter((item, index, list) => list.findIndex(candidate => candidate.title === item.title) === index)
    .slice(0, 12)
    .map((item, index) => ({ ...item, rank: index + 1 }));

export async function GET() {
  try {
    const response = await fetch("https://api.qqsuu.cn/api/dm-douyinhot", {
      headers: { Accept: "application/json", "User-Agent": "gaodian-video-hot-radar/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("upstream unavailable");
    const payload = await response.json() as { data?: { list?: RawHotItem[] } };
    const blockedWords = /政治|政府|国家|主席|总统|外交|战争|军事|军队|导弹|国际|会议|政策|警方|法院|科技|手机|电脑|芯片|人工智能|AI|机器人|汽车|航天|卫星|数码|发布会/i;
    const danceWords = /舞蹈|跳舞|手势舞|齐舞|编舞|舞步|宅舞|街舞|爵士舞|国标舞|拉丁舞/i;
    const contentWords = /歌|曲|音乐|唱|旋律|演唱|单曲|歌手|BGM|卡点|穿搭|妆|美|颜|氛围|写真|造型|时尚|发型|变装|文案/i;
    const liveItems: HotItem[] = (payload.data?.list ?? []).slice(0, 50).map((item, index) => ({
      rank: index + 1,
      title: item.word ?? "未命名热点",
      hot: Number(item.hotindex ?? 0),
      url: douyinSearchUrl(item.word ?? "抖音热点"),
      source: "抖音实时热点",
    })).filter(item => !blockedWords.test(item.title));
    const danceLive = liveItems.filter(item => danceWords.test(item.title));
    const contentLive = liveItems.filter(item => contentWords.test(item.title) && !danceWords.test(item.title));
    return Response.json({
      contentItems: appendLive(contentFallback, contentLive),
      danceItems: appendLive(danceFallback, danceLive),
      updatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return Response.json({
      contentItems: contentFallback,
      danceItems: danceFallback,
      updatedAt: new Date().toISOString(),
      fallback: true,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
