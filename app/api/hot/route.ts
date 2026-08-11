type RawHotItem = { word?: string; hotindex?: number };

const douyinSearchUrl = (keyword: string) =>
  `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`;

export async function GET() {
  try {
    const response = await fetch("https://api.qqsuu.cn/api/dm-douyinhot", {
      headers: { Accept: "application/json", "User-Agent": "gaodian-video-hot-radar/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("upstream unavailable");
    const payload = await response.json() as { data?: { list?: RawHotItem[] } };
    const items = (payload.data?.list ?? []).slice(0, 30).map((item, index) => ({
      rank: index + 1,
      title: item.word ?? "未命名热点",
      hot: Number(item.hotindex ?? 0),
      url: douyinSearchUrl(item.word ?? "抖音热点"),
    }));
    const blockedWords = /政治|政府|国家|主席|总统|外交|战争|军事|军队|导弹|国际|会议|政策|警方|法院|科技|手机|电脑|芯片|人工智能|AI|机器人|汽车|航天|卫星|数码|发布会/i;
    const musicWords = /歌|曲|音乐|舞|唱|旋律|演唱|专辑|单曲|乐队|歌手|音综|BGM|卡点/i;
    const beautyWords = /穿搭|妆|美|颜|氛围|写真|造型|女神|男神|明星|红毯|时尚|发型|护肤/i;
    const safeItems = items.filter(item => !blockedWords.test(item.title));
    const musicFallback = ["热门BGM卡点转场", "情绪副歌氛围片", "甜酷舞蹈卡点", "松弛感清唱片段", "复古旋律变装", "通勤耳机氛围", "情侣对唱片段", "轻快节奏日常", "夜景慢歌情绪", "元气舞蹈跟拍", "治愈系音乐独白", "节拍定格转场"].map((title, index) => ({ rank: index + 1, title, hot: 980000 - index * 43000, url: douyinSearchUrl(title) }));
    const beautyFallback = ["清透妆容近景", "轻熟通勤穿搭", "自然光氛围写真", "甜酷反差变装", "高级感黑白造型", "夏日清爽妆面", "松弛感居家穿搭", "复古港风妆造", "显气色腮红妆", "简约纯色穿搭", "温柔长发氛围", "镜前快速变装"].map((title, index) => ({ rank: index + 1, title, hot: 960000 - index * 41000, url: douyinSearchUrl(title) }));
    const makeList = (pattern: RegExp, fallback: typeof items) => {
      const preferred = safeItems.filter(item => pattern.test(item.title));
      return [...preferred, ...fallback].filter((item, index, list) => list.findIndex(candidate => candidate.title === item.title) === index).slice(0, 12).map((item, index) => ({ ...item, rank: index + 1 }));
    };
    const musicItems = makeList(musicWords, musicFallback);
    const beautyItems = makeList(beautyWords, beautyFallback);
    return Response.json({ musicItems, beautyItems, updatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return Response.json({ musicItems: [], beautyItems: [], error: "热点服务暂不可用" }, { status: 502 });
  }
}
