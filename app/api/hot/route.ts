type RawHotItem = { word?: string; hotindex?: number };
type HotItem = { rank: number; title: string; hot: number; url: string; source: string };

const douyinSearchUrl = (keyword: string) =>
  `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`;

const makeCurated = (entries: Array<[string, string]>, baseHot: number): HotItem[] =>
  entries.map(([title, source], index) => ({
    rank: index + 1,
    title,
    hot: baseHot - index * 37000,
    url: douyinSearchUrl(`${source.replace("同类型风格", "")} ${title}`),
    source,
  }));

const contentFallback = makeCurated([
  ["镜头感氛围短片", "风信子同类型风格"],
  ["松弛感日常文案", "赛博子同类型风格"],
  ["冷感近景与情绪 BGM", "风信子同类型风格"],
  ["女生视角细节独白", "赛博子同类型风格"],
  ["反差感变装卡点", "风信子同类型风格"],
  ["清透妆造慢镜头", "赛博子同类型风格"],
  ["甜酷情绪转场", "风信子同类型风格"],
  ["高级感留白文案", "赛博子同类型风格"],
], 980000);

const danceFallback = makeCurated([
  ["副歌手势舞跟拍", "秋贝小狼同类型风格"],
  ["甜酷双人齐舞", "饺子同类型风格"],
  ["强节奏卡点小舞段", "你枕嬷啦同类型风格"],
  ["元气全身舞蹈运镜", "秋贝小狼同类型风格"],
  ["反差感变装接舞蹈", "饺子同类型风格"],
  ["近景表情管理舞", "你枕嬷啦同类型风格"],
  ["三机位节拍切换", "秋贝小狼同类型风格"],
  ["朋友局简单齐舞", "饺子同类型风格"],
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
