"use client";

import { ClipboardEvent as ReactClipboardEvent, FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseConfigured } from "../lib/supabase";

type Status = "confirmed" | "pending";
type Task = { id: number; weekId: string; day: number; person: string; time: string; title: string; status: Status };
type CopyItem = { id: number; title: string; content: string; tags: string; createdAt: string; source?: string };
type HotItem = { rank: number; title: string; hot: number; url: string };
type Week = { id: string; label: string; range: string; days: { weekday: string; date: string }[] };
type PointerDragState = { taskId: number; pointerId: number; startX: number; startY: number; x: number; y: number; active: boolean };
type DropPreview = { weekId: string; day: number; dayLabel: string; person: string; time: string; minute: number };
type NoticeMeta = { talent: string; count: string; style: string; location: string; clothing: string; makeup: string; videoUrl?: string; videoUrls?: string[] };
type NoticeVideo = { name: string; version: number };
type NoticeImageKind = "clothing" | "makeup";
type InspirationImage = { id: string; title: string; thumbUrl: string; sourceUrl: string; creditUrl: string; localFile?: File };
type ReferenceSource = "xiaohongshu" | "instagram" | "douyin";
type WorkspacePayload = { weeks: Week[]; people: string[]; tasks: Task[]; copies: CopyItem[]; noticeEdits: Record<number, NoticeMeta>; noticeOrder: number[] };
type CloudStatus = "connecting" | "synced" | "local" | "error";
type ParsedScheduleItem = { source: string; day: number; time: string; person: string; title: string; issues: string[] };

const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六"];
const baseWeekId = "2026-08-10";
const timelineStart = 13 * 60;
const timelineEnd = 22 * 60 + 30;
const timelineDuration = timelineEnd - timelineStart;
const mediaUploadEnabled = process.env.NEXT_PUBLIC_MEDIA_UPLOAD !== "disabled";

function douyinUrlsFromText(value: string) {
  const matches = value.match(/https?:\/\/[^\s，。]+/gi) ?? [];
  return [...new Set(matches.flatMap(match => {
    try {
      const url = new URL(match);
      return /(^|\.)douyin\.com$/i.test(url.hostname) || /(^|\.)iesdouyin\.com$/i.test(url.hostname) ? [url.toString()] : [];
    } catch { return []; }
  }))];
}

function noticeVideoUrls(meta: NoticeMeta) {
  return [...new Set([...(meta.videoUrls ?? []), ...(meta.videoUrl ? [meta.videoUrl] : [])])];
}

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function makeWeek(startId: string, index: number): Week {
  const start = new Date(`${startId}T12:00:00`);
  const dates = weekdays.map((weekday, dayIndex) => {
    const date = new Date(start); date.setDate(start.getDate() + dayIndex);
    return { weekday, date: `${date.getMonth() + 1}.${date.getDate()}` };
  });
  const label = index === 0 ? "本周" : index === 1 ? "下周" : index === 2 ? "下下周" : `第 ${index + 1} 周`;
  return { id: startId, label, range: `${dates[0].date}—${dates[5].date}`, days: dates };
}

function getDropPreview(x: number, y: number): DropPreview | null {
  const cell = document.elementsFromPoint(x, y)
    .map(element => (element as HTMLElement).closest<HTMLElement>("[data-drop-cell]"))
    .find((element): element is HTMLElement => Boolean(element));
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (y - rect.top) / Math.max(rect.height, 1)));
  const minute = Math.min(timelineEnd, timelineStart + Math.round((ratio * timelineDuration) / 5) * 5);
  const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return {
    weekId: cell.dataset.weekId ?? baseWeekId,
    day: Number(cell.dataset.day),
    dayLabel: cell.dataset.dayLabel ?? "目标日期",
    person: cell.dataset.person ?? "",
    time,
    minute,
  };
}

function taskTop(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour || 0) * 60 + (minute || 0);
  const ratio = Math.max(0, Math.min(1, (total - timelineStart) / timelineDuration));
  return `calc(4px + ${ratio * 100}% - ${ratio * 44}px)`;
}

function timelineTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const total = Math.max(timelineStart, Math.min(timelineEnd, (hour || 0) * 60 + (minute || 0)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function parseScheduleText(text: string, week: Week, people: string[]): ParsedScheduleItem[] {
  const dayAliases = [
    /(?:周|星期)(?:一|1)/,
    /(?:周|星期)(?:二|2)/,
    /(?:周|星期)(?:三|3)/,
    /(?:周|星期)(?:四|4)/,
    /(?:周|星期)(?:五|5)/,
    /(?:周|星期)(?:六|6)/,
  ];

  return text.split(/[\n；;]+/).map(line => line.trim()).filter(Boolean).map(source => {
    const normalized = source.replace(/，/g, ",").replace(/：/g, ":");
    const dateMatch = normalized.match(/(\d{1,2})\s*[月.\/-]\s*(\d{1,2})\s*(?:日|号)?/);
    let day = dayAliases.findIndex(pattern => pattern.test(normalized));
    if (day < 0 && dateMatch) {
      const target = `${Number(dateMatch[1])}.${Number(dateMatch[2])}`;
      day = week.days.findIndex(item => item.date === target);
    }

    const periodMatch = normalized.match(/(下午|晚上)?\s*(\d{1,2})\s*(?:[:点时.]\s*(\d{1,2}))\s*分?/);
    let time = "";
    if (periodMatch) {
      let hour = Number(periodMatch[2]);
      const minute = Number(periodMatch[3] ?? 0);
      if (periodMatch[1] && hour < 12) hour += 12;
      time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }

    const person = people.find(name => normalized.includes(name)) ?? "";
    let title = normalized;
    if (dateMatch) title = title.replace(dateMatch[0], " ");
    dayAliases.forEach(pattern => { title = title.replace(pattern, " "); });
    if (periodMatch) title = title.replace(periodMatch[0], " ");
    if (person) title = title.replace(person, " ");
    title = title
      .replace(/(?:摄影师|摄像|拍摄人|达人|主播|内容)\s*[:：]?/g, " ")
      .replace(/(?:拍摄安排|安排拍摄|拍摄)/g, " ")
      .replace(/^[\s,、·|\-—]+|[\s,、·|\-—]+$/g, "")
      .replace(/\s{2,}/g, " ");

    const issues: string[] = [];
    if (dateMatch && day < 0) issues.push("填写的日期不在当前周");
    if (time) {
      const [hour, minute] = time.split(":").map(Number);
      const total = hour * 60 + minute;
      if (total < timelineStart || total > timelineEnd) issues.push("时间需在 13:00—22:30");
    }
    if (!title) issues.push("未识别到拍摄内容");
    return { source, day, time, person, title, issues };
  });
}

const defaultWeeks = [makeWeek(baseWeekId, 0)];
const seedPeople = ["星岩", "大强"];
const seedTasks: Task[] = [
  { id: 1, weekId: baseWeekId, day: 0, person: "星岩", time: "16:00", title: "猪猪 · 小念得志", status: "confirmed" },
  { id: 2, weekId: baseWeekId, day: 0, person: "大强", time: "16:00", title: "丁丁 · 郑婷婷", status: "confirmed" },
  { id: 3, weekId: baseWeekId, day: 1, person: "大强", time: "20:00", title: "小羊 · 辛诗婷", status: "pending" },
  { id: 4, weekId: baseWeekId, day: 2, person: "星岩", time: "20:00", title: "之之 · 张馨之", status: "confirmed" },
  { id: 5, weekId: baseWeekId, day: 3, person: "大强", time: "16:00", title: "咩咩 · 杨蔓梓", status: "confirmed" },
];
const seedCopies: CopyItem[] = [{ id: 101, title: "拍摄花絮｜三秒抓住注意力", content: "镜头一开，今天的快乐就有了。原来一条自然松弛的视频，背后藏着这么多小默契。", tags: "#拍摄花絮 #日常记录", createdAt: "今天 10:24", source: "手动收集" }];

export function Scheduler() {
  const [weeks, setWeeks] = useState<Week[]>(defaultWeeks);
  const [selectedWeekId, setSelectedWeekId] = useState(baseWeekId);
  const [people, setPeople] = useState<string[]>(seedPeople);
  const [tasks, setTasks] = useState<Task[]>(seedTasks);
  const [copies, setCopies] = useState<CopyItem[]>(seedCopies);
  const [workspaceView, setWorkspaceView] = useState<"home" | "shooting" | "inspiration">("home");
  const [copyView, setCopyView] = useState<"music" | "beauty" | "reference" | "auto" | "saved" | "notice">("notice");
  const [musicItems, setMusicItems] = useState<HotItem[]>([]);
  const [beautyItems, setBeautyItems] = useState<HotItem[]>([]);
  const [hotLoading, setHotLoading] = useState(true);
  const [hotUpdatedAt, setHotUpdatedAt] = useState<Date | null>(null);
  const [taskModal, setTaskModal] = useState<{ open: boolean; day: number; person: string; taskId: number | null }>({ open: false, day: 0, person: seedPeople[0], taskId: null });
  const [textScheduleOpen, setTextScheduleOpen] = useState(false);
  const [scheduleText, setScheduleText] = useState("");
  const [peopleModal, setPeopleModal] = useState(false);
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [touchDrag, setTouchDrag] = useState<PointerDragState | null>(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const ignoreClickUntilRef = useRef(0);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const [copyModal, setCopyModal] = useState(false);
  const [editingNoticeId, setEditingNoticeId] = useState<number | null>(null);
  const [noticeEdits, setNoticeEdits] = useState<Record<number, NoticeMeta>>({});
  const [noticeOrder, setNoticeOrder] = useState<number[]>([]);
  const [draggedNoticeId, setDraggedNoticeId] = useState<number | null>(null);
  const [noticeImages, setNoticeImages] = useState<Record<number, Partial<Record<NoticeImageKind, NoticeVideo>>>>({});
  const [imageUploading, setImageUploading] = useState<{ taskId: number; kind: NoticeImageKind } | null>(null);
  const [referenceQuery, setReferenceQuery] = useState("高级感通勤穿搭");
  const [referenceKind, setReferenceKind] = useState<NoticeImageKind>("clothing");
  const [referenceSource, setReferenceSource] = useState<ReferenceSource>("xiaohongshu");
  const [referencePicker, setReferencePicker] = useState<InspirationImage | null>(null);
  const [douyinVideoUrl, setDouyinVideoUrl] = useState("");
  const [videoReferencePicker, setVideoReferencePicker] = useState<string[] | null>(null);
  const [referenceAdding, setReferenceAdding] = useState(false);
  const [generatingNoticeId, setGeneratingNoticeId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>(supabaseConfigured ? "connecting" : "local");
  const syncReadyRef = useRef(false);
  const skipCloudWriteRef = useRef(false);
  const clientIdRef = useRef("");

  useEffect(() => {
    let active = true;
    clientIdRef.current ||= crypto.randomUUID();
    const read = <T,>(key: string, fallback: T) => {
      try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; }
      catch { return fallback; }
    };
    const localPayload: WorkspacePayload = {
      weeks: read("shooting-schedule-weeks", defaultWeeks),
      people: read("shooting-schedule-people", seedPeople),
      tasks: read<Omit<Task, "weekId">[]>("shooting-schedule-tasks", seedTasks).map(task => ({ ...task, weekId: (task as Task).weekId ?? baseWeekId })),
      copies: read("shooting-copy-library", seedCopies),
      noticeEdits: read("shooting-notice-edits", {}),
      noticeOrder: read("shooting-notice-order", []),
    };
    const applyPayload = (payload: WorkspacePayload, remote = false) => {
      if (remote) skipCloudWriteRef.current = true;
      if (payload.weeks?.length) setWeeks(payload.weeks);
      if (payload.people?.length) setPeople(payload.people);
      if (Array.isArray(payload.tasks)) setTasks(payload.tasks);
      if (Array.isArray(payload.copies)) setCopies(payload.copies);
      if (payload.noticeEdits) setNoticeEdits(payload.noticeEdits);
      if (Array.isArray(payload.noticeOrder)) setNoticeOrder(payload.noticeOrder);
    };
    applyPayload(localPayload);

    const initialize = async () => {
      if (!supabase) { syncReadyRef.current = true; setCloudStatus("local"); return; }
      try {
        const { data, error } = await supabase.from("workspace_state").select("payload").eq("id", "main").maybeSingle();
        if (error) throw error;
        if (!active) return;
        if (data?.payload) applyPayload(data.payload as WorkspacePayload, true);
        else {
          const { error: createError } = await supabase.from("workspace_state").upsert({ id: "main", payload: localPayload, updated_by: clientIdRef.current });
          if (createError) throw createError;
        }
        syncReadyRef.current = true;
        setCloudStatus("synced");
      } catch {
        syncReadyRef.current = true;
        setCloudStatus("error");
      }
    };
    void initialize();

    const channel = supabase?.channel("workspace-main").on("postgres_changes", { event: "*", schema: "public", table: "workspace_state", filter: "id=eq.main" }, event => {
      const row = event.new as { payload?: WorkspacePayload; updated_by?: string };
      if (!active || !row.payload || row.updated_by === clientIdRef.current) return;
      applyPayload(row.payload, true);
      setCloudStatus("synced");
    }).subscribe(status => {
      if (status === "SUBSCRIBED") setCloudStatus("synced");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setCloudStatus("error");
    });

    return () => { active = false; if (channel && supabase) void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const payload: WorkspacePayload = { weeks, people, tasks, copies, noticeEdits, noticeOrder };
    localStorage.setItem("shooting-schedule-weeks", JSON.stringify(weeks));
    localStorage.setItem("shooting-schedule-people", JSON.stringify(people));
    localStorage.setItem("shooting-schedule-tasks", JSON.stringify(tasks));
    localStorage.setItem("shooting-copy-library", JSON.stringify(copies));
    localStorage.setItem("shooting-notice-edits", JSON.stringify(noticeEdits));
    localStorage.setItem("shooting-notice-order", JSON.stringify(noticeOrder));
    const client = supabase;
    if (!syncReadyRef.current || !client) return;
    if (skipCloudWriteRef.current) { skipCloudWriteRef.current = false; return; }
    setCloudStatus("connecting");
    const timer = window.setTimeout(async () => {
      const { error } = await client.from("workspace_state").upsert({ id: "main", payload, updated_at: new Date().toISOString(), updated_by: clientIdRef.current });
      setCloudStatus(error ? "error" : "synced");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [weeks, people, tasks, copies, noticeEdits, noticeOrder]);

  const fetchHot = async (silent = false) => {
    if (!silent) setHotLoading(true);
    try { const response = await fetch(`/api/hot?t=${Date.now()}`, { cache: "no-store" }); const result = await response.json() as { musicItems?: HotItem[]; beautyItems?: HotItem[]; updatedAt?: string }; setMusicItems(result.musicItems ?? []); setBeautyItems(result.beautyItems ?? []); setHotUpdatedAt(result.updatedAt ? new Date(result.updatedAt) : new Date()); }
    catch { setToast("热点暂时未能刷新"); }
    finally { if (!silent) setHotLoading(false); }
  };
  useEffect(() => {
    fetchHot();
    const timer = window.setInterval(() => fetchHot(true), 60_000);
    const syncWhenActive = () => { if (document.visibilityState === "visible") fetchHot(true); };
    document.addEventListener("visibilitychange", syncWhenActive);
    window.addEventListener("online", syncWhenActive);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", syncWhenActive); window.removeEventListener("online", syncWhenActive); };
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 1800); return () => clearTimeout(timer); }, [toast]);

  const selectedWeek = weeks.find(week => week.id === selectedWeekId) ?? weeks[0];
  const weekTasks = useMemo(() => tasks.filter(task => task.weekId === selectedWeekId), [tasks, selectedWeekId]);
  const parsedScheduleItems = useMemo(() => parseScheduleText(scheduleText, selectedWeek, people), [scheduleText, selectedWeek, people]);
  const autoBeautyCopies = useMemo<CopyItem[]>(() => beautyItems.slice(0, 8).map(item => ({
    id: 900000 + item.rank,
    title: `颜值热点文案｜${item.title}`,
    content: `镜头先从细节开始，把「${item.title}」的氛围感留在前三秒。\n\n妆容和穿搭不需要堆满元素，用一个清晰记忆点完成近景到全身的变化，再用自然动作收住画面。\n\n你更喜欢这套风格的妆容，还是穿搭？`,
    tags: `#${item.title.slice(0, 12)} #颜值热点 #拍摄灵感`,
    createdAt: hotUpdatedAt ? `${hotUpdatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 自动整理` : "自动整理",
    source: `抖音颜值榜第 ${item.rank} 名 · 热点标题提炼`,
  })), [beautyItems, hotUpdatedAt]);
  const orderedWeekTasks = useMemo(() => [...weekTasks].sort((a, b) => {
    const aIndex = noticeOrder.indexOf(a.id); const bIndex = noticeOrder.indexOf(b.id);
    if (aIndex >= 0 || bIndex >= 0) return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
    return a.day - b.day || a.time.localeCompare(b.time);
  }), [weekTasks, noticeOrder]);
  useEffect(() => {
    if (copyView !== "notice") return;
    Promise.all(weekTasks.map(async task => {
      const [clothing, makeup] = await Promise.all([fetch(`/api/notices/${task.id}/image?kind=clothing`, { method: "HEAD" }), fetch(`/api/notices/${task.id}/image?kind=makeup`, { method: "HEAD" })]);
      const imageMeta = (response: Response, fallback: string) => response.ok ? { name: decodeURIComponent(response.headers.get("x-image-name") ?? fallback), version: Date.now() } : undefined;
      return { taskId: task.id, images: { clothing: imageMeta(clothing, "服装参考图"), makeup: imageMeta(makeup, "妆容参考图") } };
    })).then(items => { setNoticeImages(Object.fromEntries(items.map(item => [item.taskId, item.images]))); }).catch(() => undefined);
  }, [copyView, selectedWeekId, weekTasks]);
  const gridStyle = { gridTemplateColumns: `88px repeat(${people.length}, minmax(150px, 1fr))` };
  const saveTasks = (next: Task[]) => { setTasks(next); localStorage.setItem("shooting-schedule-tasks", JSON.stringify(next)); };
  const saveCopies = (next: CopyItem[]) => { setCopies(next); localStorage.setItem("shooting-copy-library", JSON.stringify(next)); };
  const savePeople = (next: string[]) => { setPeople(next); localStorage.setItem("shooting-schedule-people", JSON.stringify(next)); };
  const saveWeeks = (next: Week[]) => { setWeeks(next); localStorage.setItem("shooting-schedule-weeks", JSON.stringify(next)); };

  const addWeek = () => {
    const last = weeks[weeks.length - 1];
    const date = new Date(`${last.id}T12:00:00`); date.setDate(date.getDate() + 7);
    const next = makeWeek(isoDate(date), weeks.length);
    saveWeeks([...weeks, next]); setSelectedWeekId(next.id); setToast(`${next.label}已加入排期`);
  };
  const removeSelectedWeek = () => {
    if (weeks.length === 1) { setToast("至少保留一个拍摄周"); return; }
    const count = tasks.filter(task => task.weekId === selectedWeekId).length;
    if (!window.confirm(count ? `删除${selectedWeek.label}会同时删除其中 ${count} 条拍摄安排，是否继续？` : `确认删除${selectedWeek.label}？`)) return;
    const remaining = weeks.filter(week => week.id !== selectedWeekId).map((week, index) => makeWeek(week.id, index));
    saveWeeks(remaining); saveTasks(tasks.filter(task => task.weekId !== selectedWeekId));
    setSelectedWeekId(remaining[Math.max(0, weeks.findIndex(week => week.id === selectedWeekId) - 1)]?.id ?? remaining[0].id);
    setToast("拍摄周已删除");
  };
  const addPerson = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const names = String(data.get("name")).split(/[，,、\s]+/).map(name => name.trim()).filter(Boolean);
    const fresh = [...new Set(names)].filter(name => !people.includes(name));
    if (!fresh.length) { setToast("没有可新增的摄影师"); return; }
    savePeople([...people, ...fresh]); setToast(`已新增 ${fresh.length} 位摄影师`); event.currentTarget.reset();
  };
  const removeSelectedPeople = () => {
    if (!selectedPeople.length) { setToast("请先勾选要移除的摄影师"); return; }
    if (people.length - selectedPeople.length < 1) { setToast("至少保留一位摄影师"); return; }
    const assigned = tasks.filter(task => selectedPeople.includes(task.person)).length;
    const message = assigned ? `移除所选 ${selectedPeople.length} 位摄影师会同时删除 ${assigned} 条拍摄安排，是否继续？` : `确认移除所选 ${selectedPeople.length} 位摄影师？`;
    if (!window.confirm(message)) return;
    savePeople(people.filter(person => !selectedPeople.includes(person)));
    saveTasks(tasks.filter(task => !selectedPeople.includes(task.person)));
    setSelectedPeople([]); setToast("所选摄影师已移除");
  };
  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const values = { weekId: selectedWeekId, day: Number(data.get("day")), person: String(data.get("person")), time: String(data.get("time")), title: String(data.get("title")), status: tasks.find(task => task.id === taskModal.taskId)?.status ?? "pending" as Status };
    if (taskModal.taskId) { saveTasks(tasks.map(task => task.id === taskModal.taskId ? { ...task, ...values } : task)); setToast("拍摄安排已更新"); }
    else { saveTasks([...tasks, { id: Date.now(), ...values }]); setToast(`已加入${selectedWeek.label}排期`); }
    setTaskModal({ ...taskModal, open: false });
  };
  const importTextSchedule = () => {
    const validItems = parsedScheduleItems.filter(item => item.issues.length === 0);
    if (!validItems.length) { setToast("请先修正未识别的排期内容"); return; }
    const occupied = new Set(tasks.filter(task => task.weekId === selectedWeekId).map(task => `${task.day}|${task.time}|${task.person}`));
    const automaticTimes = Array.from({ length: 20 }, (_, index) => {
      const minute = timelineStart + index * 30;
      return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    });
    const createdAt = Date.now();
    const additions = validItems.map((item, index): Task => {
      const candidateDays = item.day >= 0 ? [item.day] : selectedWeek.days.map((_, dayIndex) => dayIndex);
      const candidatePeople = item.person ? [item.person] : people;
      const candidateTimes = item.time ? [item.time] : automaticTimes;
      let placement: { day: number; time: string; person: string } | null = null;
      for (const day of candidateDays) {
        for (const time of candidateTimes) {
          for (const person of candidatePeople) {
            if (!occupied.has(`${day}|${time}|${person}`)) { placement = { day, time, person }; break; }
          }
          if (placement) break;
        }
        if (placement) break;
      }
      placement ??= { day: item.day >= 0 ? item.day : 0, time: item.time || "13:00", person: item.person || people[0] };
      occupied.add(`${placement.day}|${placement.time}|${placement.person}`);
      return { id: createdAt + index, weekId: selectedWeekId, ...placement, title: item.title, status: "pending" };
    });
    saveTasks([...tasks, ...additions]);
    setScheduleText("");
    setTextScheduleOpen(false);
    setToast(`已自动填入 ${additions.length} 条拍摄排期`);
  };
  const addCopy = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    saveCopies([{ id: Date.now(), title: String(data.get("title")), content: String(data.get("content")), tags: String(data.get("tags")), createdAt: "刚刚", source: "手动收集" }, ...copies]); setCopyView("saved"); setCopyModal(false); setToast("文案已收进灵感库");
  };
  const organizeHot = (item: HotItem, category: "音乐" | "颜值") => {
    const keyword = item.title.replace(/[“”"']/g, "");
    saveCopies([{ id: Date.now(), title: `${category}热点借势｜${keyword}`, content: category === "音乐" ? `音乐切入：围绕「${keyword}」设计卡点、转场或情绪片段。\n\n拍摄建议：前三秒直接进入副歌或记忆点，用人物动作与节奏完成画面变化。\n\n收尾：你最近循环的是哪一首？` : `颜值切入：围绕「${keyword}」设计妆容、穿搭或氛围感画面。\n\n拍摄建议：先给细节特写，再切完整造型，用自然光与近景突出人物状态。\n\n收尾：这套风格你会尝试吗？`, tags: `#${keyword.slice(0, 12)} #${category}热点 #抖音灵感`, createdAt: "刚刚", source: `${category}榜第 ${item.rank} 名` }, ...copies]); setCopyView("saved"); setToast(`${category}热点已整理成文案框架`);
  };
  const rankingPanel = (items: HotItem[], category: "音乐" | "颜值") => hotLoading ? <div className="hot-skeleton">{[1,2,3,4,5].map(i => <i key={i} />)}</div> : items.length ? <div className="hot-list">{items.map(item => <article className="hot-card" key={`${category}-${item.rank}-${item.title}`}><span className="hot-rank">{String(item.rank).padStart(2,"0")}</span><a className="hot-link" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`前往抖音查看热点：${item.title}`}><span><h3>{item.title}</h3><p>{(item.hot / 10000).toFixed(1)} 万热度 · {category}灵感</p></span><i aria-hidden="true">↗</i></a><button onClick={() => organizeHot(item, category)}>整理</button></article>)}</div> : <div className="copy-empty"><span>↻</span><h3>{category}榜暂时不可用</h3><p>稍后刷新，或先手动收集文案。</p><button onClick={() => setCopyModal(true)}>手动收集</button></div>;
  const saveAutoCopy = (item: CopyItem) => {
    if (copies.some(copy => copy.title === item.title)) { setToast("这条文案已在整理库中"); return; }
    saveCopies([{ ...item, id: Date.now(), createdAt: "刚刚", source: `${item.source} · 已收藏` }, ...copies]);
    setToast("自动文案已保存到整理库");
  };
  const copyText = async (item: CopyItem) => { await navigator.clipboard.writeText(`${item.title}\n\n${item.content}\n\n${item.tags}`); setToast("文案已复制"); };
  const noticeMeta = (task: Task): NoticeMeta => {
    const [talent] = task.title.split(/\s*[·｜|]\s*/);
    return { talent, count: "3", style: "剧情", location: "家中", clothing: "简约日常", makeup: "自然清透", ...noticeEdits[task.id] };
  };
  const noticeText = (task: Task) => {
    const week = weeks.find(item => item.id === task.weekId) ?? selectedWeek;
    const day = week.days[task.day];
    const meta = noticeMeta(task);
    const videoText = noticeVideoUrls(meta).map((url, index) => `抖音参考视频${index + 1}：${url}`).join("\n");
    return `拍摄达人：${meta.talent}\n拍摄时间：${day.weekday} ${day.date.replace(".", "月")}日 ${task.time}\n拍摄条数：${meta.count}\n拍摄风格：${meta.style}\n拍摄地点：${meta.location}\n服装参考：${meta.clothing}\n妆容参考：${meta.makeup}\n摄影师：${task.person}${videoText ? `\n${videoText}` : ""}`;
  };
  const copyNotice = async (task: Task) => { await navigator.clipboard.writeText(noticeText(task)); setToast("拍摄通告已复制"); };
  const copyAllNotices = async () => { await navigator.clipboard.writeText(orderedWeekTasks.map(noticeText).join("\n\n————————\n\n")); setToast("本周全部通告已复制"); };
  const saveNoticeCard = async (task: Task) => {
    setGeneratingNoticeId(task.id);
    try {
      await document.fonts.ready;
      const week = weeks.find(item => item.id === task.weekId) ?? selectedWeek; const day = week.days[task.day]; const meta = noticeMeta(task);
      const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1540;
      const context = canvas.getContext("2d"); if (!context) throw new Error("当前浏览器无法生成图片");
      const rounded = (x: number, y: number, width: number, height: number, radius: number) => { context.beginPath(); context.roundRect(x, y, width, height, radius); };
      context.fillStyle = "#e9eae5"; context.fillRect(0, 0, canvas.width, canvas.height);
      rounded(44, 44, 992, 1452, 34); context.fillStyle = "#fdfdfb"; context.fill();
      context.fillStyle = "#4e574e"; rounded(76, 78, 98, 38, 19); context.fill(); context.fillStyle = "#fff"; context.font = "700 18px Inter, PingFang SC, Microsoft YaHei"; context.fillText("通告", 105, 104);
      context.fillStyle = "#292c28"; context.font = "700 54px Inter, PingFang SC, Microsoft YaHei"; context.fillText("拍摄通告", 76, 178);
      context.fillStyle = "#858a82"; context.font = "500 22px Inter, PingFang SC, Microsoft YaHei"; context.fillText(`${week.label} · ${week.range}`, 78, 218);
      context.strokeStyle = "#dedfd8"; context.lineWidth = 2; context.beginPath(); context.moveTo(76, 250); context.lineTo(1004, 250); context.stroke();
      const details = [["拍摄达人", meta.talent], ["拍摄时间", `${day.weekday} ${day.date.replace(".", "月")}日 ${task.time}`], ["拍摄条数", meta.count], ["拍摄风格", meta.style], ["拍摄地点", meta.location], ["摄影师", task.person], ["服装参考", meta.clothing], ["妆容参考", meta.makeup]];
      details.forEach(([label, value], index) => { const y = 302 + index * 58; context.fillStyle = "#8b9188"; context.font = "500 21px Inter, PingFang SC, Microsoft YaHei"; context.fillText(label, 78, y); context.fillStyle = "#343833"; context.font = "650 25px Inter, PingFang SC, Microsoft YaHei"; context.fillText(value.slice(0, 28), 242, y); });
      context.fillStyle = "#5d655c"; context.font = "700 24px Inter, PingFang SC, Microsoft YaHei"; context.fillText("造型参考", 78, 790);
      const drawReference = async (kind: NoticeImageKind, x: number, title: string) => {
        rounded(x, 820, 444, 440, 24); context.fillStyle = "#f0f2ec"; context.fill();
        const asset = noticeImages[task.id]?.[kind];
        if (asset) {
          const image = new Image(); image.src = `/api/notices/${task.id}/image?kind=${kind}&v=${asset.version}`; await image.decode();
          const scale = Math.max(444 / image.width, 368 / image.height); const width = image.width * scale; const height = image.height * scale;
          context.save(); rounded(x, 820, 444, 368, 24); context.clip(); context.drawImage(image, x + (444 - width) / 2, 820 + (368 - height) / 2, width, height); context.restore();
        } else { context.fillStyle = "#a0a59c"; context.font = "500 21px Inter, PingFang SC, Microsoft YaHei"; context.fillText("暂无参考图片", x + 145, 1010); }
        context.fillStyle = "#343833"; context.font = "650 23px Inter, PingFang SC, Microsoft YaHei"; context.fillText(title, x + 20, 1228);
      };
      await Promise.all([drawReference("clothing", 76, "服装参考图"), drawReference("makeup", 560, "妆容参考图")]);
      const videoUrls = noticeVideoUrls(meta);
      rounded(76, 1288, 928, 128, 18); context.fillStyle = "#f1f3ed"; context.fill(); context.fillStyle = "#687067"; context.font = "650 20px Inter, PingFang SC, Microsoft YaHei"; context.fillText(`抖音参考视频 · ${videoUrls.length} 条`, 104, 1324);
      context.fillStyle = "#858c83"; context.font = "500 16px Inter, PingFang SC, Microsoft YaHei";
      videoUrls.slice(0, 3).forEach((url, index) => context.fillText(`${index + 1}. ${url.slice(0, 82)}`, 104, 1352 + index * 22));
      if (videoUrls.length > 3) context.fillText(`另有 ${videoUrls.length - 3} 条链接，请在网页通告中查看`, 104, 1400);
      context.fillStyle = "#9a9f96"; context.font = "500 18px Inter, PingFang SC, Microsoft YaHei"; context.fillText("搞点视频拍拍 · 具体拍摄时间以最终通告为准", 76, 1438);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("图片生成失败")), "image/png", 1));
      const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = `${meta.talent.replace(/[\\/:*?"<>|]/g, "-")}-拍摄通告.png`; anchor.click(); URL.revokeObjectURL(anchor.href); setToast("卡片式通告图片已保存");
    } catch (error) { setToast(error instanceof Error ? error.message : "通告图片生成失败"); }
    finally { setGeneratingNoticeId(null); }
  };
  const saveNoticeEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editingNoticeId) return;
    const data = new FormData(event.currentTarget);
    const next = { ...noticeEdits, [editingNoticeId]: { ...noticeEdits[editingNoticeId], talent: String(data.get("talent")), count: String(data.get("count")), style: String(data.get("style")), location: String(data.get("location")), clothing: String(data.get("clothing")), makeup: String(data.get("makeup")) } };
    setNoticeEdits(next); localStorage.setItem("shooting-notice-edits", JSON.stringify(next)); setEditingNoticeId(null); setToast("通告内容已更新");
  };
  const reorderNotice = (targetId: number) => {
    if (!draggedNoticeId || draggedNoticeId === targetId) return;
    const ids = orderedWeekTasks.map(task => task.id).filter(id => id !== draggedNoticeId);
    ids.splice(ids.indexOf(targetId), 0, draggedNoticeId);
    setNoticeOrder(ids); localStorage.setItem("shooting-notice-order", JSON.stringify(ids)); setDraggedNoticeId(null); setToast("通告顺序已调整");
  };
  const saveNoticeVideoLinks = (taskId: number, value: string) => {
    const urls = douyinUrlsFromText(value);
    if (!urls.length) { setToast("请粘贴至少一条有效的抖音视频链接"); return false; }
    const task = tasks.find(item => item.id === taskId); if (!task) return false;
    const meta = noticeMeta(task); const videoUrls = [...new Set([...noticeVideoUrls(meta), ...urls])];
    const next = { ...noticeEdits, [taskId]: { ...meta, videoUrl: undefined, videoUrls } };
    setNoticeEdits(next); localStorage.setItem("shooting-notice-edits", JSON.stringify(next)); setToast(`已保存 ${urls.length} 条抖音参考链接`); return true;
  };
  const deleteNoticeVideoLink = (taskId: number, url: string) => {
    const task = tasks.find(item => item.id === taskId); if (!task) return;
    const meta = { ...noticeMeta(task), videoUrl: undefined, videoUrls: noticeVideoUrls(noticeMeta(task)).filter(item => item !== url) };
    const next = { ...noticeEdits, [taskId]: meta };
    setNoticeEdits(next); localStorage.setItem("shooting-notice-edits", JSON.stringify(next)); setToast("参考视频链接已删除");
  };
  const uploadNoticeImage = async (taskId: number, kind: NoticeImageKind, file?: File) => {
    if (!file) return; setImageUploading({ taskId, kind });
    try {
      const response = await fetch(`/api/notices/${taskId}/image?kind=${kind}`, { method: "PUT", headers: { "Content-Type": file.type, "X-Image-Name": encodeURIComponent(file.name) }, body: file });
      const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error || "图片上传失败");
      setNoticeImages(current => ({ ...current, [taskId]: { ...current[taskId], [kind]: { name: file.name, version: Date.now() } } })); setToast(`${kind === "clothing" ? "服装" : "妆容"}参考图已添加`);
    } catch (error) { setToast(error instanceof Error ? error.message : "图片上传失败"); }
    finally { setImageUploading(null); }
  };
  const deleteNoticeImage = async (taskId: number, kind: NoticeImageKind) => {
    await fetch(`/api/notices/${taskId}/image?kind=${kind}`, { method: "DELETE" });
    setNoticeImages(current => ({ ...current, [taskId]: { ...current[taskId], [kind]: undefined } })); setToast(`${kind === "clothing" ? "服装" : "妆容"}参考图已删除`);
  };
  const editingTask = taskModal.taskId ? tasks.find(task => task.id === taskModal.taskId) : undefined;
  const editingNoticeTask = editingNoticeId ? tasks.find(task => task.id === editingNoticeId) : undefined;
  const applyTaskMove = (id: number, changes: Partial<Pick<Task, "weekId" | "day" | "person" | "time">>, message: string) => {
    saveTasks(tasks.map(task => task.id === id ? { ...task, ...changes } : task));
    if (changes.weekId) setSelectedWeekId(changes.weekId);
    setDraggingTaskId(null); setDropPreview(null); setToast(message);
  };
  const beginTouchDrag = (event: ReactPointerEvent<HTMLButtonElement>, taskId: number) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const next = { taskId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
    pointerDragRef.current = next; setTouchDrag(next); setDropPreview(null);
  };

  useEffect(() => {
    const resetDrag = () => {
      pointerDragRef.current = null;
      setTouchDrag(null);
      setDraggingTaskId(null);
      setDropPreview(null);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const current = pointerDragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const active = current.active || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 2;
      if (active) {
        event.preventDefault();
        setDraggingTaskId(current.taskId);
        setDropPreview(getDropPreview(event.clientX, event.clientY));
      }
      const next = { ...current, x: event.clientX, y: event.clientY, active };
      pointerDragRef.current = next;
      setTouchDrag(next);
    };
    const handlePointerUp = (event: PointerEvent) => {
      const current = pointerDragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.active) { resetDrag(); return; }
      event.preventDefault();
      ignoreClickUntilRef.current = Date.now() + 350;
      const preview = getDropPreview(event.clientX, event.clientY);
      const weekDrop = document.elementsFromPoint(event.clientX, event.clientY)
        .map(element => (element as HTMLElement).closest<HTMLElement>("[data-drop-week]"))
        .find((element): element is HTMLElement => Boolean(element));
      if (preview) applyTaskMove(current.taskId, { weekId: preview.weekId, day: preview.day, person: preview.person, time: preview.time }, `已调整到${preview.dayLabel} ${preview.time} · ${preview.person}`);
      else if (weekDrop?.dataset.dropWeek) applyTaskMove(current.taskId, { weekId: weekDrop.dataset.dropWeek }, "任务拍摄周期已调整");
      else resetDrag();
      pointerDragRef.current = null;
      setTouchDrag(null);
      setDropPreview(null);
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", resetDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", resetDrag);
    };
  }, [tasks]);

  const cloudStatusLabel = cloudStatus === "synced" ? "云端实时" : cloudStatus === "connecting" ? "同步中…" : cloudStatus === "error" ? "同步异常 · 已本机保存" : "本机保存";
  const openWorkspace = (view: "shooting" | "inspiration") => {
    setWorkspaceView(view);
    setCopyView(view === "shooting" ? "notice" : "music");
    window.setTimeout(() => document.getElementById("module-content")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const searchReferenceImages = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!referenceQuery.trim()) return;
    const keyword = encodeURIComponent(referenceQuery.trim());
    const target = referenceSource === "xiaohongshu"
      ? `https://www.xiaohongshu.com/search_result?keyword=${keyword}`
      : referenceSource === "instagram"
        ? `https://www.instagram.com/explore/search/keyword/?q=${keyword}`
        : `https://www.douyin.com/search/${keyword}`;
    window.open(target, "_blank", "noopener,noreferrer");
  };
  const preparePastedReference = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setToast("剪贴板中没有图片"); return; }
    const sourceName = referenceSource === "xiaohongshu" ? "小红书" : "Instagram";
    setReferencePicker({ id: `paste-${Date.now()}`, title: `${sourceName}粘贴图片`, thumbUrl: URL.createObjectURL(file), sourceUrl: "", creditUrl: "", localFile: file });
  };
  const pasteReferenceImage = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const file = Array.from(event.clipboardData.items).find(item => item.type.startsWith("image/"))?.getAsFile();
    if (!file) { setToast("没有检测到图片，请先复制图片再粘贴"); return; }
    event.preventDefault(); preparePastedReference(file);
  };
  const closeReferencePicker = () => {
    if (referencePicker?.thumbUrl.startsWith("blob:")) URL.revokeObjectURL(referencePicker.thumbUrl);
    setReferencePicker(null);
  };
  const addReferenceToNotice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!referencePicker) return;
    const data = new FormData(event.currentTarget); const taskId = Number(data.get("taskId")); const kind = String(data.get("kind")) as NoticeImageKind;
    if (!Number.isFinite(taskId) || !tasks.some(task => task.id === taskId)) { setToast("请先在拍摄工作台新增拍摄安排"); return; }
    setReferenceAdding(true);
    try {
      const response = referencePicker.localFile
        ? await fetch(`/api/notices/${taskId}/image?kind=${kind}`, { method: "PUT", headers: { "Content-Type": referencePicker.localFile.type, "X-Image-Name": encodeURIComponent(referencePicker.title) }, body: referencePicker.localFile })
        : await fetch(`/api/notices/${taskId}/image?kind=${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceUrl: referencePicker.sourceUrl, name: referencePicker.title }) });
      const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error || "参考图添加失败");
      setNoticeImages(current => ({ ...current, [taskId]: { ...current[taskId], [kind]: { name: referencePicker.title, version: Date.now() } } }));
      closeReferencePicker(); setToast(`已添加到通告的${kind === "clothing" ? "服装" : "妆容"}参考`);
    } catch (error) { setToast(error instanceof Error ? error.message : "参考图添加失败"); }
    finally { setReferenceAdding(false); }
  };
  const prepareDouyinVideoReference = () => {
    const urls = douyinUrlsFromText(douyinVideoUrl);
    if (!urls.length) { setToast("请粘贴至少一条有效的抖音视频链接"); return; }
    if (!orderedWeekTasks.length) { setToast("请先在拍摄工作台新增拍摄安排"); return; }
    setVideoReferencePicker(urls);
  };
  const addVideoReferenceToNotice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!videoReferencePicker) return;
    const data = new FormData(event.currentTarget); const taskId = Number(data.get("taskId"));
    if (saveNoticeVideoLinks(taskId, videoReferencePicker.join("\n"))) { setDouyinVideoUrl(""); setVideoReferencePicker(null); }
  };

  return <main className="app-shell"><section className="workspace">
    <header className="topbar"><div className="brand"><span className="brand-dot" />搞点视频拍拍</div><div className={`top-note sync-${cloudStatus}`}><span className="live-dot" /> {cloudStatusLabel}</div></header>
    {workspaceView === "home" && <section className="module-intro"><p>SELECT A WORKSPACE</p><h1>今天，从哪一块开始？</h1><span>选择工作台后再展开内容，保持首页简洁专注。</span></section>}
    <nav className={`module-switch ${workspaceView === "home" ? "home" : ""}`} aria-label="首页功能分区">
      <button className={workspaceView === "shooting" ? "active" : ""} onClick={() => openWorkspace("shooting")}><span>01</span><div><strong>拍摄工作台</strong><small>拍摄排期 · 拍摄通告</small></div><i>→</i></button>
      <button className={workspaceView === "inspiration" ? "active" : ""} onClick={() => openWorkspace("inspiration")}><span>02</span><div><strong>灵感工作台</strong><small>音乐榜 · 颜值榜 · 文案整理</small></div><i>→</i></button>
    </nav>
    {workspaceView !== "home" && <div id="module-content" className={`split-home view-${workspaceView} ${mediaUploadEnabled ? "" : "media-disabled"}`}>
      <section className="schedule-pane">
        <div className="pane-heading"><div><p className="eyebrow">SCHEDULE · {selectedWeek.range}</p><h1>拍摄排期</h1><p className="subtitle">{selectedWeek.label}共 {weekTasks.length} 场 · {people.length} 位摄影师</p></div><div className="heading-actions"><button className="outline-btn text-schedule-trigger" onClick={() => setTextScheduleOpen(true)}>⌁ 文本录入</button><button className="outline-btn" onClick={() => setPeopleModal(true)}>管理摄影师</button><button className="primary-btn" onClick={() => setTaskModal({ open: true, day: 0, person: people[0], taskId: null })}>＋ 新增拍摄</button></div></div>
        <div className="week-rail"><div className="week-tabs">{weeks.map(week => <button key={week.id} data-drop-week={week.id} className={`${selectedWeekId === week.id ? "active" : ""} ${draggingTaskId ? "drop-ready" : ""}`} onClick={() => setSelectedWeekId(week.id)}><b>{week.label}</b><span>{week.range}</span></button>)}</div><div className="week-actions"><button className="remove-week" onClick={removeSelectedWeek}>− 删除本周</button><button className="add-week" onClick={addWeek}>＋ 添加下一周</button></div></div>
        <div className="schedule-tip"><em>{draggingTaskId ? (dropPreview ? `松手放到 ${dropPreview.dayLabel} ${dropPreview.time} · ${dropPreview.person}` : "拖到任意日期的任意位置") : "按住卡片上下拖动调整时间 · 每日 13:00—22:30"}</em></div>
        <div className="schedule-scroll" key={selectedWeekId}><div className="schedule dynamic-schedule">
          <div className="schedule-head" style={gridStyle}><div>日期</div>{people.map(person => <div key={person}>{person}</div>)}</div>
          {selectedWeek.days.map((day, dayIndex) => <div className={`day-row ${selectedWeekId === baseWeekId && dayIndex === 0 ? "is-today" : ""}`} style={gridStyle} key={day.weekday}>
            <div className="day-label"><b>{day.weekday}</b><span>{day.date}</span>{selectedWeekId === baseWeekId && dayIndex === 0 && <i>今天</i>}<div className="day-time-scale" aria-hidden="true"><span>13:00</span><span>15:30</span><span>18:00</span><span>20:30</span><span>22:30</span></div></div>
            {people.map(person => { const list = weekTasks.filter(task => task.day === dayIndex && task.person === person).sort((a, b) => a.time.localeCompare(b.time)); const isPreview = dropPreview?.weekId === selectedWeekId && dropPreview.day === dayIndex && dropPreview.person === person; return <div className={`person-cell timeline-cell ${draggingTaskId ? "is-drop-zone" : ""} ${isPreview ? "is-drop-preview" : ""}`} data-drop-cell="true" data-week-id={selectedWeekId} data-day={dayIndex} data-day-label={day.weekday} data-person={person} key={person}>{list.map(task => <button type="button" draggable={false} data-task-id={task.id} style={{ top: taskTop(task.time) }} className={`task-card ${draggingTaskId === task.id ? "dragging" : ""} ${touchDrag?.active && touchDrag.taskId === task.id ? "touch-dragging" : ""}`} onDragStart={event => event.preventDefault()} onPointerDown={event => beginTouchDrag(event, task.id)} onClick={() => { if (Date.now() < ignoreClickUntilRef.current) return; setTaskModal({ open: true, day: task.day, person: task.person, taskId: task.id }); }} key={task.id}><span className="drag-grip" aria-hidden="true">⋮⋮</span><span className="task-time">{task.time}</span><strong>{task.title}</strong></button>)}{isPreview && dropPreview && <div className="drop-surface" aria-hidden="true"><span className="drop-range top">13:00</span><span className="drop-range bottom">22:30</span><div className="drop-time-indicator" style={{ top: `${((dropPreview.minute - timelineStart) / timelineDuration) * 100}%` }}><b>{dropPreview.time}</b></div></div>}<button className="timeline-add" onClick={() => setTaskModal({ open: true, day: dayIndex, person, taskId: null })}>＋</button></div>; })}
          </div>)}
        </div></div>
        <p className="footnote">具体拍摄时间以视频群内最终通告为准 · 改期请至少提前两天协调</p>
      </section>

      <section className="copy-pane"><div className="pane-heading copy-heading"><div><p className="eyebrow">{workspaceView === "shooting" ? "SHOOT NOTICE" : "TREND RADAR"}</p><h2>{workspaceView === "shooting" ? "拍摄通告" : "音乐榜 · 颜值榜"}</h2><p className="subtitle">{workspaceView === "shooting" ? "排期生成通告，内容可编辑、复制与拖动排序。" : "自动更新颜值与音乐热点，并整理成可直接使用的文案。"}</p></div>{workspaceView === "inspiration" && <div className="live-tools"><span className="live-status"><i />{hotUpdatedAt ? `${hotUpdatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 已更新` : "实时同步"}</span><button className="outline-btn" onClick={() => fetchHot(false)} disabled={hotLoading}>{hotLoading ? "同步中…" : "↻ 刷新"}</button></div>}</div>
        <div className={`platform-tabs trend-tabs ${workspaceView === "shooting" ? "notice-only" : ""}`} role="tablist">{workspaceView === "inspiration" ? <><button className={copyView === "music" ? "active" : ""} onClick={() => setCopyView("music")}><span className="platform-icon music-icon">乐</span>音乐榜<b>{musicItems.length}</b></button><button className={copyView === "beauty" ? "active" : ""} onClick={() => setCopyView("beauty")}><span className="platform-icon beauty-icon">颜</span>颜值榜<b>{beautyItems.length}</b></button><button className={copyView === "reference" ? "active" : ""} onClick={() => setCopyView("reference")}><span className="platform-icon reference-icon">图</span>服装与妆造<b>3</b></button><button className={copyView === "auto" ? "active" : ""} onClick={() => setCopyView("auto")}><span className="platform-icon auto-icon">采</span>文案收集<b>{autoBeautyCopies.length}</b></button><button className={copyView === "saved" ? "active" : ""} onClick={() => setCopyView("saved")}><span className="platform-icon saved-icon">稿</span>已整理<b>{copies.length}</b></button></> : <button className="active" onClick={() => setCopyView("notice")}><span className="platform-icon notice-icon">告</span>本周拍摄通告<b>{weekTasks.length}</b></button>}</div>
        <div className="copy-list">{copyView === "music" && rankingPanel(musicItems, "音乐")}{copyView === "beauty" && rankingPanel(beautyItems, "颜值")}
        {copyView === "reference" && <div className="reference-browser">
          <form className="reference-search" onSubmit={searchReferenceImages}>
            <div className="reference-source" role="group" aria-label="灵感搜索来源"><button type="button" className={referenceSource === "xiaohongshu" ? "active xhs" : ""} onClick={() => setReferenceSource("xiaohongshu")}>小红书</button><button type="button" className={referenceSource === "instagram" ? "active instagram" : ""} onClick={() => setReferenceSource("instagram")}>Instagram</button><button type="button" className={referenceSource === "douyin" ? "active douyin" : ""} onClick={() => setReferenceSource("douyin")}>抖音搜索</button></div>
            {referenceSource !== "douyin" && <div className="reference-kind" role="group" aria-label="参考图类型"><button type="button" className={referenceKind === "clothing" ? "active" : ""} onClick={() => setReferenceKind("clothing")}>服装穿搭</button><button type="button" className={referenceKind === "makeup" ? "active" : ""} onClick={() => setReferenceKind("makeup")}>妆容妆照</button></div>}
            <div className="reference-searchbar"><input value={referenceQuery} onChange={event => setReferenceQuery(event.target.value)} placeholder={referenceSource === "douyin" ? "搜索抖音参考视频关键词…" : referenceKind === "clothing" ? "搜索：通勤穿搭、法式裙装、运动造型…" : "搜索：清透妆、复古妆、氛围妆照…"} aria-label="搜索服装、妆容或抖音视频" /><button>{`去${referenceSource === "xiaohongshu" ? "小红书" : referenceSource === "instagram" ? " Instagram" : "抖音"}搜索 ↗`}</button></div>
          </form>
          {referenceSource === "douyin" ? <div className="douyin-reference-panel"><div className="social-source-mark douyin"><span>抖</span><div><b>抖音参考视频链接</b><p>可一次粘贴多条视频链接或多段抖音分享文字。</p></div></div><div className="douyin-link-input"><textarea rows={5} value={douyinVideoUrl} onChange={event => setDouyinVideoUrl(event.target.value)} placeholder={`粘贴多条抖音链接，例如：\nhttps://v.douyin.com/...\nhttps://www.douyin.com/video/...`} aria-label="粘贴多个抖音参考视频链接" /><button type="button" onClick={prepareDouyinVideoReference}>加入拍摄通告</button></div><p className="social-help">这里只保存链接，不上传视频文件；所有协作者均可点击链接跳转抖音查看。</p></div> : <div className="social-reference-panel"><div className={`social-source-mark ${referenceSource}`}><span>{referenceSource === "xiaohongshu" ? "RED" : "IG"}</span><div><b>{referenceSource === "xiaohongshu" ? "小红书图片" : "Instagram 图片"}</b><p>在平台内复制喜欢的图片，然后回到这里直接粘贴。</p></div></div><div className="clipboard-paste-zone" tabIndex={0} role="button" onPaste={pasteReferenceImage} aria-label="点击后粘贴复制的图片"><span>⌘V</span><b>点击这里，然后粘贴图片</b><small>Windows 按 Ctrl + V · Mac 按 Command + V</small></div><label className="paste-file-fallback">手机端或无法复制图片？从相册选择<input type="file" accept="image/*" onChange={event => preparePastedReference(event.target.files?.[0])} /></label><p className="social-help">粘贴后选择对应拍摄通告以及“服装参考”或“妆容参考”。</p></div>}
          <p className="reference-license">小红书与 Instagram 用于服装、妆容图片；抖音用于参考视频链接。</p>
        </div>}
        {copyView === "auto" && (autoBeautyCopies.length ? <><div className="auto-copy-note"><span>自动采集</span><div><b>颜值热点文案已整理</b><p>每分钟根据公开抖音颜值热词更新并去重，不冒充原视频作者文案。</p></div></div>{autoBeautyCopies.map(item => <article className="copy-card auto-copy-card" key={item.id}><div className="copy-card-top"><span className="copy-platform">{item.source}</span><span>{item.createdAt}</span></div><h3>{item.title}</h3><p className="formatted-copy">{item.content}</p><div className="copy-tags">{item.tags}</div><div className="copy-actions"><button onClick={() => copyText(item)}>复制文案</button><button onClick={() => saveAutoCopy(item)}>保存到已整理</button></div></article>)}</> : <div className="copy-empty"><span>采</span><h3>正在等待颜值热点</h3><p>榜单刷新后会自动生成整理文案。</p><button onClick={() => fetchHot(false)}>立即刷新</button></div>)}
        {copyView === "saved" && (copies.length ? <><button className="manual-add" onClick={() => setCopyModal(true)}>＋ 手动收集一条</button>{copies.map(item => <article className="copy-card" key={item.id}><div className="copy-card-top"><span className="copy-platform">{item.source ?? "抖音热点"}</span><span>{item.createdAt}</span></div><h3>{item.title}</h3><p className="formatted-copy">{item.content}</p><div className="copy-tags">{item.tags}</div><div className="copy-actions"><button onClick={() => copyText(item)}>复制全文</button><button onClick={() => { saveCopies(copies.filter(copy => copy.id !== item.id)); setToast("文案已删除"); }}>删除</button></div></article>)}</> : <div className="copy-empty"><span>＋</span><h3>还没有整理好的文案</h3><p>从音乐榜或颜值榜选择灵感，生成拍摄框架。</p><button onClick={() => setCopyView("music")}>去看音乐榜</button></div>)}
        {copyView === "notice" && (weekTasks.length ? <div className="notice-list"><button className="copy-all-notices" onClick={copyAllNotices}>复制本周全部通告</button>{orderedWeekTasks.map(task => {
          const day = selectedWeek.days[task.day]; const meta = noticeMeta(task); const clothingImage = noticeImages[task.id]?.clothing; const makeupImage = noticeImages[task.id]?.makeup; const clothingUploading = imageUploading?.taskId === task.id && imageUploading.kind === "clothing"; const makeupUploading = imageUploading?.taskId === task.id && imageUploading.kind === "makeup";
          return <article className={`notice-card ${draggedNoticeId === task.id ? "notice-dragging" : ""}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={event => { event.preventDefault(); reorderNotice(task.id); }} key={task.id}>
            <div className="notice-card-head" draggable onDragStart={event => { setDraggedNoticeId(task.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDraggedNoticeId(null)}><div><span><i className="notice-grip">⋮⋮</i> SHOOT NOTICE</span><b>{day.weekday} · {day.date}</b></div><div className="notice-head-actions"><button className="notice-image-save" disabled={generatingNoticeId === task.id} onClick={() => saveNoticeCard(task)}>{generatingNoticeId === task.id ? "生成中…" : "保存图片"}</button><button className="notice-edit" onClick={() => setEditingNoticeId(task.id)}>编辑</button><button onClick={() => copyNotice(task)}>复制</button></div></div>
            <div className="notice-body"><p><span>拍摄达人</span><strong>{meta.talent}</strong></p><p><span>拍摄时间</span><strong>{day.weekday} {day.date.replace(".", "月")}日 {task.time}</strong></p><p><span>拍摄条数</span><strong>{meta.count}</strong></p><p><span>拍摄风格</span><strong>{meta.style}</strong></p><p><span>拍摄地点</span><strong>{meta.location}</strong></p><p><span>服装参考</span><strong>{meta.clothing}</strong></p><p><span>妆容参考</span><strong>{meta.makeup}</strong></p><p><span>摄影师</span><strong>{task.person}</strong></p></div>
            <div className="notice-reference-grid"><div className="notice-reference"><b>服装参考图</b>{clothingImage && <div className="notice-image"><img draggable={false} src={`/api/notices/${task.id}/image?kind=clothing&v=${clothingImage.version}`} alt={`${meta.talent}的服装参考`} /><div><span>{clothingImage.name}</span><button onClick={() => deleteNoticeImage(task.id, "clothing")}>删除</button></div></div>}<label className={`notice-video-add ${clothingUploading ? "uploading" : ""}`}>{clothingUploading ? "图片上传中…" : clothingImage ? "更换服装图" : "＋ 添加服装图"}<input type="file" accept="image/*" disabled={clothingUploading} onChange={event => uploadNoticeImage(task.id, "clothing", event.target.files?.[0])} /></label></div><div className="notice-reference"><b>妆容参考图</b>{makeupImage && <div className="notice-image"><img draggable={false} src={`/api/notices/${task.id}/image?kind=makeup&v=${makeupImage.version}`} alt={`${meta.talent}的妆容参考`} /><div><span>{makeupImage.name}</span><button onClick={() => deleteNoticeImage(task.id, "makeup")}>删除</button></div></div>}<label className={`notice-video-add ${makeupUploading ? "uploading" : ""}`}>{makeupUploading ? "图片上传中…" : makeupImage ? "更换妆容图" : "＋ 添加妆容图"}<input type="file" accept="image/*" disabled={makeupUploading} onChange={event => uploadNoticeImage(task.id, "makeup", event.target.files?.[0])} /></label></div></div>
            <div className="notice-video-title">抖音参考视频</div>
            {noticeVideoUrls(meta).map((url, index) => <div className="notice-video-link" key={url}><a href={url} target="_blank" rel="noopener noreferrer"><span>抖音</span><div><b>打开参考视频 {index + 1}</b><small>{url}</small></div><i>↗</i></a><button onClick={() => deleteNoticeVideoLink(task.id, url)}>删除链接</button></div>)}
            <form className="notice-video-link-form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); if (saveNoticeVideoLinks(task.id, String(data.get("videoUrls")))) event.currentTarget.reset(); }}><textarea name="videoUrls" rows={2} placeholder="可一次粘贴多条抖音链接或多段分享文字" aria-label={`${meta.talent}的抖音参考视频链接`} required /><button>添加链接</button></form>
          </article>;
        })}</div> : <div className="copy-empty"><span>告</span><h3>本周还没有拍摄通告</h3><p>先在左侧新增拍摄安排，通告卡片会自动生成。</p></div>)}</div><p className="data-source">{copyView === "notice" ? "服装妆容参考图可增删 · 抖音参考视频以共享链接保存" : copyView === "reference" ? "从小红书、Instagram 与抖音收集拍摄参考" : copyView === "auto" ? "公开颜值热点标题自动提炼 · 非原视频逐字文案" : copyView === "saved" ? "已整理的音乐与颜值灵感" : "仅展示音乐、舞蹈、妆容、穿搭与颜值内容"}</p>
      </section>
    </div>}
  </section>

  {taskModal.open && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setTaskModal({ ...taskModal, open: false })}><form className="modal" onSubmit={addTask}><div className="modal-title"><div><p className="eyebrow">{editingTask ? "EDIT SHOOT" : "NEW SHOOT"} · {selectedWeek.label}</p><h2>{editingTask ? "编辑拍摄安排" : "新增拍摄安排"}</h2></div><button type="button" className="close" onClick={() => setTaskModal({ ...taskModal, open: false })}>×</button></div><div className="form-grid"><div className="field full"><label>主播 · 内容 / 嘉宾</label><input name="title" placeholder="例如：小羊 · 新品口播" defaultValue={editingTask?.title ?? ""} required autoFocus /></div><div className="field"><label>拍摄日期</label><select name="day" defaultValue={editingTask?.day ?? taskModal.day}>{selectedWeek.days.map((day, index) => <option value={index} key={day.weekday}>{day.weekday} · {day.date}</option>)}</select></div><div className="field"><label>拍摄时间 · 13:00—22:30</label><input name="time" type="time" min="13:00" max="22:30" step="300" defaultValue={editingTask ? timelineTime(editingTask.time) : "16:00"} required /></div><div className="field"><label>摄影师</label><select name="person" defaultValue={editingTask?.person ?? taskModal.person}>{people.map(person => <option key={person}>{person}</option>)}</select></div></div><div className={`modal-actions ${editingTask ? "editing-actions" : ""}`}>{editingTask && <button type="button" className="delete-btn" onClick={() => { saveTasks(tasks.filter(task => task.id !== editingTask.id)); setTaskModal({ ...taskModal, open: false }); setToast("拍摄安排已删除"); }}>删除安排</button>}<span className="action-spacer" /><button type="button" className="cancel-btn" onClick={() => setTaskModal({ ...taskModal, open: false })}>取消</button><button className="primary-btn">{editingTask ? "保存更改" : "加入排期"}</button></div></form></div>}

  {textScheduleOpen && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setTextScheduleOpen(false)}><div className="modal text-schedule-modal"><div className="modal-title"><div><p className="eyebrow">QUICK ADD · {selectedWeek.label}</p><h2>发送文本，直接排期</h2><p className="subtitle">只写拍摄对象或内容即可。系统先放入空闲位置，你再拖动整理。</p></div><button type="button" className="close" onClick={() => setTextScheduleOpen(false)}>×</button></div><label className="text-schedule-input"><span>每行输入一条</span><textarea rows={6} value={scheduleText} onChange={event => setScheduleText(event.target.value)} placeholder={`小羊（辛诗婷）\n之之（张馨之）\n咩咩（杨蔓梓）`} autoFocus /></label><div className="text-schedule-help"><span>不用写周几和时间</span><span>不用指定摄影师</span><span>导入后可直接拖动</span></div><div className="text-schedule-results"><div className="text-schedule-summary"><b>识别结果</b><span>{parsedScheduleItems.filter(item => item.issues.length === 0).length} 条可放入 · {parsedScheduleItems.filter(item => item.issues.length > 0).length} 条需补充</span></div>{parsedScheduleItems.length ? parsedScheduleItems.map((item, index) => <article className={item.issues.length ? "has-issue" : "is-ready"} key={`${item.source}-${index}`}><i>{item.issues.length ? "!" : "✓"}</i><div><b>{item.issues.length ? item.source : item.title}</b><p>{item.issues.length ? item.issues.join(" · ") : item.day >= 0 && item.time && item.person ? `${selectedWeek.days[item.day]?.weekday} ${item.time} · ${item.person}` : "将自动寻找空闲位置 · 导入后可拖动调整"}</p></div></article>) : <div className="text-schedule-empty">输入“小羊（辛诗婷）”即可自动识别</div>}</div><div className="modal-actions"><button type="button" className="cancel-btn" onClick={() => setTextScheduleOpen(false)}>取消</button><button type="button" className="primary-btn" disabled={!parsedScheduleItems.some(item => item.issues.length === 0)} onClick={importTextSchedule}>放入排期</button></div></div></div>}

  {editingNoticeTask && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setEditingNoticeId(null)}><form className="modal notice-edit-modal" onSubmit={saveNoticeEdit}><div className="modal-title"><div><p className="eyebrow">EDIT NOTICE</p><h2>编辑拍摄通告</h2><p className="subtitle">日期、时间与摄影师跟随左侧排期。</p></div><button type="button" className="close" onClick={() => setEditingNoticeId(null)}>×</button></div><div className="form-grid"><div className="field"><label>拍摄达人</label><input name="talent" defaultValue={noticeMeta(editingNoticeTask).talent} required autoFocus /></div><div className="field"><label>拍摄条数</label><input name="count" type="number" min="1" defaultValue={noticeMeta(editingNoticeTask).count} required /></div><div className="field"><label>拍摄风格</label><input name="style" defaultValue={noticeMeta(editingNoticeTask).style} required /></div><div className="field"><label>拍摄地点</label><input name="location" defaultValue={noticeMeta(editingNoticeTask).location} required /></div><div className="field"><label>服装参考</label><input name="clothing" defaultValue={noticeMeta(editingNoticeTask).clothing} placeholder="例如：简约日常、浅色系" required /></div><div className="field"><label>妆容参考</label><input name="makeup" defaultValue={noticeMeta(editingNoticeTask).makeup} placeholder="例如：自然清透、轻欧美" required /></div></div><div className="modal-actions"><button type="button" className="cancel-btn" onClick={() => setEditingNoticeId(null)}>取消</button><button className="primary-btn">保存通告</button></div></form></div>}

  {peopleModal && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setPeopleModal(false)}><div className="modal people-modal"><div className="modal-title"><div><p className="eyebrow">TEAM</p><h2>管理摄影师</h2><p className="subtitle">可批量添加，也可勾选多位后统一移除。</p></div><button className="close" onClick={() => setPeopleModal(false)}>×</button></div><div className="people-toolbar"><button onClick={() => setSelectedPeople(selectedPeople.length === people.length ? [] : [...people])}>{selectedPeople.length === people.length ? "取消全选" : "全选"}</button><span>已选 {selectedPeople.length} 位</span><button className="bulk-remove" onClick={removeSelectedPeople}>移除所选</button></div><div className="people-list">{people.map(person => <label className={`people-item ${selectedPeople.includes(person) ? "selected" : ""}`} key={person}><input type="checkbox" checked={selectedPeople.includes(person)} onChange={() => setSelectedPeople(selectedPeople.includes(person) ? selectedPeople.filter(name => name !== person) : [...selectedPeople, person])} /><span className="person-avatar">{person.slice(-1)}</span><div><b>{person}</b><small>{tasks.filter(task => task.person === person).length} 条拍摄安排</small></div></label>)}</div><form className="add-person-form" onSubmit={addPerson}><input name="name" placeholder="输入多个姓名，用逗号或空格分隔" required /><button className="primary-btn">＋ 批量添加</button></form></div></div>}

  {copyModal && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setCopyModal(false)}><form className="modal copy-modal" onSubmit={addCopy}><div className="modal-title"><div><p className="eyebrow">NEW COPY</p><h2>收集一条文案</h2></div><button type="button" className="close" onClick={() => setCopyModal(false)}>×</button></div><div className="form-grid"><div className="field full"><label>标题</label><input name="title" placeholder="给灵感起个名字" required /></div><div className="field full"><label>文案正文</label><textarea name="content" rows={6} placeholder="粘贴或写下文案内容……" required /></div><div className="field full"><label>话题标签</label><input name="tags" placeholder="#拍摄日常 #视频创作" /></div></div><div className="modal-actions"><button type="button" className="cancel-btn" onClick={() => setCopyModal(false)}>取消</button><button className="primary-btn">保存文案</button></div></form></div>}
  {referencePicker && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !referenceAdding && setReferencePicker(null)}><form className="modal reference-picker-modal" onSubmit={addReferenceToNotice}><div className="modal-title"><div><p className="eyebrow">ADD TO NOTICE</p><h2>添加到拍摄通告</h2><p className="subtitle">选择拍摄任务和参考图类型。</p></div><button type="button" className="close" disabled={referenceAdding} onClick={() => setReferencePicker(null)}>×</button></div><div className="reference-picker-preview"><img src={referencePicker.thumbUrl} alt={referencePicker.title} /><span>{referencePicker.title}</span></div><div className="form-grid"><div className="field full"><label>目标拍摄通告</label><select name="taskId" defaultValue={orderedWeekTasks[0]?.id} required>{orderedWeekTasks.map(task => { const day = selectedWeek.days[task.day]; return <option value={task.id} key={task.id}>{day.weekday} {day.date} · {task.time} · {task.title}</option>; })}</select></div><div className="field full"><label>加入位置</label><select name="kind" defaultValue={referenceKind}><option value="clothing">服装参考图</option><option value="makeup">妆容参考图</option></select></div></div><div className="modal-actions"><button type="button" className="cancel-btn" disabled={referenceAdding} onClick={() => setReferencePicker(null)}>取消</button><button className="primary-btn" disabled={referenceAdding}>{referenceAdding ? "正在添加…" : "确认添加"}</button></div></form></div>}
  {videoReferencePicker && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setVideoReferencePicker(null)}><form className="modal video-reference-picker" onSubmit={addVideoReferenceToNotice}><div className="modal-title"><div><p className="eyebrow">DOUYIN REFERENCE</p><h2>加入 {videoReferencePicker.length} 条参考视频</h2><p className="subtitle">链接会云端同步，所有协作者均可点击查看。</p></div><button type="button" className="close" onClick={() => setVideoReferencePicker(null)}>×</button></div><div className="video-reference-preview-list">{videoReferencePicker.map((url, index) => <a className="video-reference-preview" href={url} target="_blank" rel="noopener noreferrer" key={url}><span>抖</span><div><b>预览链接 {index + 1}</b><small>{url}</small></div><i>↗</i></a>)}</div><div className="field full"><label>目标拍摄通告</label><select name="taskId" defaultValue={orderedWeekTasks[0]?.id} required>{orderedWeekTasks.map(task => { const day = selectedWeek.days[task.day]; return <option value={task.id} key={task.id}>{day.weekday} {day.date} · {task.time} · {task.title}</option>; })}</select></div><div className="modal-actions"><button type="button" className="cancel-btn" onClick={() => setVideoReferencePicker(null)}>取消</button><button className="primary-btn">全部保存到通告</button></div></form></div>}
  {toast && <div className="toast" role="status">{toast}</div>}
  {touchDrag?.active && <div className="touch-drag-ghost" style={{ left: touchDrag.x, top: touchDrag.y }}>{tasks.find(task => task.id === touchDrag.taskId)?.title}<small>拖到目标位置</small></div>}
  </main>;
}
