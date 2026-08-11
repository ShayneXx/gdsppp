"use client";

import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseConfigured } from "../lib/supabase";

type Status = "confirmed" | "pending";
type Task = { id: number; weekId: string; day: number; person: string; time: string; title: string; status: Status };
type CopyItem = { id: number; title: string; content: string; tags: string; createdAt: string; source?: string };
type HotItem = { rank: number; title: string; hot: number; url: string };
type Week = { id: string; label: string; range: string; days: { weekday: string; date: string }[] };
type PointerDragState = { taskId: number; pointerId: number; startX: number; startY: number; x: number; y: number; active: boolean };
type DropPreview = { weekId: string; day: number; dayLabel: string; person: string; time: string; minute: number };
type NoticeMeta = { talent: string; count: string; style: string; location: string; clothing: string; makeup: string };
type NoticeVideo = { name: string; version: number };
type NoticeImageKind = "clothing" | "makeup";
type WorkspacePayload = { weeks: Week[]; people: string[]; tasks: Task[]; copies: CopyItem[]; noticeEdits: Record<number, NoticeMeta>; noticeOrder: number[] };
type CloudStatus = "connecting" | "synced" | "local" | "error";

const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六"];
const baseWeekId = "2026-08-10";
const timelineStart = 13 * 60;
const timelineEnd = 22 * 60 + 30;
const timelineDuration = timelineEnd - timelineStart;
const mediaUploadEnabled = process.env.NEXT_PUBLIC_MEDIA_UPLOAD !== "disabled";

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
  const [copyView, setCopyView] = useState<"music" | "beauty" | "saved" | "notice">("music");
  const [musicItems, setMusicItems] = useState<HotItem[]>([]);
  const [beautyItems, setBeautyItems] = useState<HotItem[]>([]);
  const [hotLoading, setHotLoading] = useState(true);
  const [hotUpdatedAt, setHotUpdatedAt] = useState<Date | null>(null);
  const [taskModal, setTaskModal] = useState<{ open: boolean; day: number; person: string; taskId: number | null }>({ open: false, day: 0, person: seedPeople[0], taskId: null });
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
  const [noticeVideos, setNoticeVideos] = useState<Record<number, NoticeVideo>>({});
  const [videoUploadingId, setVideoUploadingId] = useState<number | null>(null);
  const [noticeImages, setNoticeImages] = useState<Record<number, Partial<Record<NoticeImageKind, NoticeVideo>>>>({});
  const [imageUploading, setImageUploading] = useState<{ taskId: number; kind: NoticeImageKind } | null>(null);
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
  const orderedWeekTasks = useMemo(() => [...weekTasks].sort((a, b) => {
    const aIndex = noticeOrder.indexOf(a.id); const bIndex = noticeOrder.indexOf(b.id);
    if (aIndex >= 0 || bIndex >= 0) return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
    return a.day - b.day || a.time.localeCompare(b.time);
  }), [weekTasks, noticeOrder]);
  useEffect(() => {
    if (copyView !== "notice") return;
    Promise.all(weekTasks.map(async task => {
      const [video, clothing, makeup] = await Promise.all([fetch(`/api/notices/${task.id}/video`, { method: "HEAD" }), fetch(`/api/notices/${task.id}/image?kind=clothing`, { method: "HEAD" }), fetch(`/api/notices/${task.id}/image?kind=makeup`, { method: "HEAD" })]);
      const imageMeta = (response: Response, fallback: string) => response.ok ? { name: decodeURIComponent(response.headers.get("x-image-name") ?? fallback), version: Date.now() } : undefined;
      return { taskId: task.id, video: video.ok ? { name: decodeURIComponent(video.headers.get("x-video-name") ?? "拍摄参考视频"), version: Date.now() } : null, images: { clothing: imageMeta(clothing, "服装参考图"), makeup: imageMeta(makeup, "妆容参考图") } };
    })).then(items => { setNoticeVideos(Object.fromEntries(items.filter(item => item.video).map(item => [item.taskId, item.video]))); setNoticeImages(Object.fromEntries(items.map(item => [item.taskId, item.images]))); }).catch(() => undefined);
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
  const addCopy = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    saveCopies([{ id: Date.now(), title: String(data.get("title")), content: String(data.get("content")), tags: String(data.get("tags")), createdAt: "刚刚", source: "手动收集" }, ...copies]); setCopyView("saved"); setCopyModal(false); setToast("文案已收进灵感库");
  };
  const organizeHot = (item: HotItem, category: "音乐" | "颜值") => {
    const keyword = item.title.replace(/[“”"']/g, "");
    saveCopies([{ id: Date.now(), title: `${category}热点借势｜${keyword}`, content: category === "音乐" ? `音乐切入：围绕「${keyword}」设计卡点、转场或情绪片段。\n\n拍摄建议：前三秒直接进入副歌或记忆点，用人物动作与节奏完成画面变化。\n\n收尾：你最近循环的是哪一首？` : `颜值切入：围绕「${keyword}」设计妆容、穿搭或氛围感画面。\n\n拍摄建议：先给细节特写，再切完整造型，用自然光与近景突出人物状态。\n\n收尾：这套风格你会尝试吗？`, tags: `#${keyword.slice(0, 12)} #${category}热点 #抖音灵感`, createdAt: "刚刚", source: `${category}榜第 ${item.rank} 名` }, ...copies]); setCopyView("saved"); setToast(`${category}热点已整理成文案框架`);
  };
  const rankingPanel = (items: HotItem[], category: "音乐" | "颜值") => hotLoading ? <div className="hot-skeleton">{[1,2,3,4,5].map(i => <i key={i} />)}</div> : items.length ? <div className="hot-list">{items.map(item => <article className="hot-card" key={`${category}-${item.rank}-${item.title}`}><span className="hot-rank">{String(item.rank).padStart(2,"0")}</span><a className="hot-link" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`前往抖音查看热点：${item.title}`}><span><h3>{item.title}</h3><p>{(item.hot / 10000).toFixed(1)} 万热度 · {category}灵感</p></span><i aria-hidden="true">↗</i></a><button onClick={() => organizeHot(item, cat…1558 tokens truncated…();
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

  return <main className="app-shell"><section className="workspace">
    <header className="topbar"><div className="brand"><span className="brand-dot" />搞点视频拍拍</div><div className={`top-note sync-${cloudStatus}`}><span className="live-dot" /> {cloudStatusLabel}</div></header>
    <div className={`split-home ${mediaUploadEnabled ? "" : "media-disabled"}`}>
      <section className="schedule-pane">
        <div className="pane-heading"><div><p className="eyebrow">SCHEDULE · {selectedWeek.range}</p><h1>拍摄排期</h1><p className="subtitle">{selectedWeek.label}共 {weekTasks.length} 场 · {people.length} 位摄影师</p></div><div className="heading-actions"><button className="outline-btn" onClick={() => setPeopleModal(true)}>管理摄影师</button><button className="primary-btn" onClick={() => setTaskModal({ open: true, day: 0, person: people[0], taskId: null })}>＋ 新增拍摄</button></div></div>
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

      <section className="copy-pane"><div className="pane-heading copy-heading"><div><p className="eyebrow">TREND RADAR</p><h2>音乐榜 · 颜值榜</h2><p className="subtitle">仅保留音乐、舞蹈、妆容、穿搭与颜值类灵感。</p></div><div className="live-tools"><span className="live-status"><i />{hotUpdatedAt ? `${hotUpdatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 已更新` : "实时同步"}</span><button className="outline-btn" onClick={() => fetchHot(false)} disabled={hotLoading}>{hotLoading ? "同步中…" : "↻ 刷新"}</button></div></div>
        <div className="platform-tabs trend-tabs" role="tablist"><button className={copyView === "music" ? "active" : ""} onClick={() => setCopyView("music")}><span className="platform-icon music-icon">乐</span>音乐榜<b>{musicItems.length}</b></button><button className={copyView === "beauty" ? "active" : ""} onClick={() => setCopyView("beauty")}><span className="platform-icon beauty-icon">颜</span>颜值榜<b>{beautyItems.length}</b></button><button className={copyView === "saved" ? "active" : ""} onClick={() => setCopyView("saved")}><span className="platform-icon saved-icon">稿</span>已整理<b>{copies.length}</b></button><button className={copyView === "notice" ? "active" : ""} onClick={() => setCopyView("notice")}><span className="platform-icon notice-icon">告</span>拍摄通告<b>{weekTasks.length}</b></button></div>
        <div className="copy-list">{copyView === "music" && rankingPanel(musicItems, "音乐")}{copyView === "beauty" && rankingPanel(beautyItems, "颜值")}
        {copyView === "saved" && (copies.length ? <><button className="manual-add" onClick={() => setCopyModal(true)}>＋ 手动收集一条</button>{copies.map(item => <article className="copy-card" key={item.id}><div className="copy-card-top"><span className="copy-platform">{item.source ?? "抖音热点"}</span><span>{item.createdAt}</span></div><h3>{item.title}</h3><p className="formatted-copy">{item.content}</p><div className="copy-tags">{item.tags}</div><div className="copy-actions"><button onClick={() => copyText(item)}>复制全文</button><button onClick={() => { saveCopies(copies.filter(copy => copy.id !== item.id)); setToast("文案已删除"); }}>删除</button></div></article>)}</> : <div className="copy-empty"><span>＋</span><h3>还没有整理好的文案</h3><p>从音乐榜或颜值榜选择灵感，生成拍摄框架。</p><button onClick={() => setCopyView("music")}>去看音乐榜</button></div>)}
        {copyView === "notice" && (weekTasks.length ? <div className="notice-list"><button className="copy-all-notices" onClick={copyAllNotices}>复制本周全部通告</button>{orderedWeekTasks.map(task => { const day = selectedWeek.days[task.day]; const meta = noticeMeta(task); const video = noticeVideos[task.id]; const clothingImage = noticeImages[task.id]?.clothing; const makeupImage = noticeImages[task.id]?.makeup; const clothingUploading = imageUploading?.taskId === task.id && imageUploading.kind === "clothing"; const makeupUploading = imageUploading?.taskId === task.id && imageUploading.kind === "makeup"; return <article className={`notice-card ${draggedNoticeId === task.id ? "notice-dragging" : ""}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={event => { event.preventDefault(); reorderNotice(task.id); }} key={task.id}><div className="notice-card-head" draggable onDragStart={event => { setDraggedNoticeId(task.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDraggedNoticeId(null)}><div><span><i className="notice-grip">⋮⋮</i> SHOOT NOTICE</span><b>{day.weekday} · {day.date}</b></div><div className="notice-head-actions"><button className="notice-edit" onClick={() => setEditingNoticeId(task.id)}>编辑</button><button onClick={() => copyNotice(task)}>复制</button></div></div><div className="notice-body"><p><span>拍摄达人</span><strong>{meta.talent}</strong></p><p><span>拍摄时间</span><strong>{day.weekday} {day.date.replace(".", "月")}日 {task.time}</strong></p><p><span>拍摄条数</span><strong>{meta.count}</strong></p><p><span>拍摄风格</span><strong>{meta.style}</strong></p><p><span>拍摄地点</span><strong>{meta.location}</strong></p><p><span>服装参考</span><strong>{meta.clothing}</strong></p><p><span>妆容参考</span><strong>{meta.makeup}</strong></p><p><span>摄影师</span><strong>{task.person}</strong></p></div><div className="notice-reference-grid"><div className="notice-reference"><b>服装参考图</b>{clothingImage && <div className="notice-image"><img draggable={false} src={`/api/notices/${task.id}/image?kind=clothing&v=${clothingImage.version}`} alt={`${meta.talent}的服装参考`} /><div><span>{clothingImage.name}</span><button onClick={() => deleteNoticeImage(task.id, "clothing")}>删除</button></div></div>}<label className={`notice-video-add ${clothingUploading ? "uploading" : ""}`}>{clothingUploading ? "图片上传中…" : clothingImage ? "更换服装图" : "＋ 添加服装图"}<input type="file" accept="image/*" disabled={clothingUploading} onChange={event => uploadNoticeImage(task.id, "clothing", event.target.files?.[0])} /></label></div><div className="notice-reference"><b>妆容参考图</b>{makeupImage && <div className="notice-image"><img draggable={false} src={`/api/notices/${task.id}/image?kind=makeup&v=${makeupImage.version}`} alt={`${meta.talent}的妆容参考`} /><div><span>{makeupImage.name}</span><button onClick={() => deleteNoticeImage(task.id, "makeup")}>删除</button></div></div>}<label className={`notice-video-add ${makeupUploading ? "uploading" : ""}`}>{makeupUploading ? "图片上传中…" : makeupImage ? "更换妆容图" : "＋ 添加妆容图"}<input type="file" accept="image/*" disabled={makeupUploading} onChange={event => uploadNoticeImage(task.id, "makeup", event.target.files?.[0])} /></label></div></div>{video && <div className="notice-video"><video controls draggable={false} preload="metadata" src={`/api/notices/${task.id}/video?v=${video.version}`} /><div><span>{video.name}</span><button onClick={() => deleteNoticeVideo(task.id)}>删除视频</button></div></div>}<label className={`notice-video-add notice-video-control ${videoUploadingId === task.id ? "uploading" : ""}`}>{videoUploadingId === task.id ? "视频上传中…" : video ? "更换视频" : "＋ 添加视频"}<input type="file" accept="video/*" disabled={videoUploadingId === task.id} onChange={event => uploadNoticeVideo(task.id, event.target.files?.[0])} /></label></article>; })}</div> : <div className="copy-empty"><span>告</span><h3>本周还没有拍摄通告</h3><p>先在左侧新增拍摄安排，通告卡片会自动生成。</p></div>)}</div><p className="data-source">{copyView === "notice" ? "服装与妆容参考图可分别上传、预览和更换" : copyView === "saved" ? "已整理的音乐与颜值灵感" : "仅展示音乐、舞蹈、妆容、穿搭与颜值内容"}</p>
      </section>
    </div>
  </section>

  {taskModal.open && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setTaskModal({ ...taskModal, open: false })}><form className="modal" onSubmit={addTask}><div className="modal-title"><div><p className="eyebrow">{editingTask ? "EDIT SHOOT" : "NEW SHOOT"} · {selectedWeek.label}</p><h2>{editingTask ? "编辑拍摄安排" : "新增拍摄安排"}</h2></div><button type="button" className="close" onClick={() => setTaskModal({ ...taskModal, open: false })}>×</button></div><div className="form-grid"><div className="field full"><label>主播 · 内容 / 嘉宾</label><input name="title" placeholder="例如：小羊 · 新品口播" defaultValue={editingTask?.title ?? ""} required autoFocus /></div><div className="field"><label>拍摄日期</label><select name="day" defaultValue={editingTask?.day ?? taskModal.day}>{selectedWeek.days.map((day, index) => <option value={index} key={day.weekday}>{day.weekday} · {day.date}</option>)}</select></div><div className="field"><label>拍摄时间 · 13:00—22:30</label><input name="time" type="time" min="13:00" max="22:30" step="300" defaultValue={editingTask ? timelineTime(editingTask.time) : "16:00"} required /></div><div className="field"><label>摄影师</label><select name="person" defaultValue={editingTask?.person ?? taskModal.person}>{people.map(person => <option key={person}>{person}</option>)}</select></div></div><div className={`modal-actions ${editingTask ? "editing-actions" : ""}`}>{editingTask && <button type="button" className="delete-btn" onClick={() => { saveTasks(tasks.filter(task => task.id !== editingTask.id)); setTaskModal({ ...taskModal, open: false }); setToast("拍摄安排已删除"); }}>删除安排</button>}<span className="action-spacer" /><button type="button" className="cancel-btn" onClick={() => setTaskModal({ ...taskModal, open: false })}>取消</button><button className="primary-btn">{editingTask ? "保存更改" : "加入排期"}</button></div></form></div>}

  {editingNoticeTask && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setEditingNoticeId(null)}><form className="modal notice-edit-modal" onSubmit={saveNoticeEdit}><div className="modal-title"><div><p className="eyebrow">EDIT NOTICE</p><h2>编辑拍摄通告</h2><p className="subtitle">日期、时间与摄影师跟随左侧排期。</p></div><button type="button" className="close" onClick={() => setEditingNoticeId(null)}>×</button></div><div className="form-grid"><div className="field"><label>拍摄达人</label><input name="talent" defaultValue={noticeMeta(editingNoticeTask).talent} required autoFocus /></div><div className="field"><label>拍摄条数</label><input name="count" type="number" min="1" defaultValue={noticeMeta(editingNoticeTask).count} required /></div><div className="field"><label>拍摄风格</label><input name="style" defaultValue={noticeMeta(editingNoticeTask).style} required /></div><div className="field"><label>拍摄地点</label><input name="location" defaultValue={noticeMeta(editingNoticeTask).location} required /></div><div className="field"><label>服装参考</label><input name="clothing" defaultValue={noticeMeta(editingNoticeTask).clothing} placeholder="例如：简约日常、浅色系" required /></div><div className="field"><label>妆容参考</label><input name="makeup" defaultValue={noticeMeta(editingNoticeTask).makeup} placeholder="例如：自然清透、轻欧美" required /></div></div><div className="modal-actions"><button type="button" className="cancel-btn" onClick={() => setEditingNoticeId(null)}>取消</button><button className="primary-btn">保存通告</button></div></form></div>}

  {peopleModal && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setPeopleModal(false)}><div className="modal people-modal"><div className="modal-title"><div><p className="eyebrow">TEAM</p><h2>管理摄影师</h2><p className="subtitle">可批量添加，也可勾选多位后统一移除。</p></div><button className="close" onClick={() => setPeopleModal(false)}>×</button></div><div className="people-toolbar"><button onClick={() => setSelectedPeople(selectedPeople.length === people.length ? [] : [...people])}>{selectedPeople.length === people.length ? "取消全选" : "全选"}</button><span>已选 {selectedPeople.length} 位</span><button className="bulk-remove" onClick={removeSelectedPeople}>移除所选</button></div><div className="people-list">{people.map(person => <label className={`people-item ${selectedPeople.includes(person) ? "selected" : ""}`} key={person}><input type="checkbox" checked={selectedPeople.includes(person)} onChange={() => setSelectedPeople(selectedPeople.includes(person) ? selectedPeople.filter(name => name !== person) : [...selectedPeople, person])} /><span className="person-avatar">{person.slice(-1)}</span><div><b>{person}</b><small>{tasks.filter(task => task.person === person).length} 条拍摄安排</small></div></label>)}</div><form className="add-person-form" onSubmit={addPerson}><input name="name" placeholder="输入多个姓名，用逗号或空格分隔" required /><button className="primary-btn">＋ 批量添加</button></form></div></div>}

  {copyModal && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setCopyModal(false)}><form className="modal copy-modal" onSubmit={addCopy}><div className="modal-title"><div><p className="eyebrow">NEW COPY</p><h2>收集一条文案</h2></div><button type="button" className="close" onClick={() => setCopyModal(false)}>×</button></div><div className="form-grid"><div className="field full"><label>标题</label><input name="title" placeholder="给灵感起个名字" required /></div><div className="field full"><label>文案正文</label><textarea name="content" rows={6} placeholder="粘贴或写下文案内容……" required /></div><div className="field full"><label>话题标签</label><input name="tags" placeholder="#拍摄日常 #视频创作" /></div></div><div className="modal-actions"><button type="button" className="cancel-btn" onClick={() => setCopyModal(false)}>取消</button><button className="primary-btn">保存文案</button></div></form></div>}
  {toast && <div className="toast" role="status">{toast}</div>}
  {touchDrag?.active && <div className="touch-drag-ghost" style={{ left: touchDrag.x, top: touchDrag.y }}>{tasks.find(task => task.id === touchDrag.taskId)?.title}<small>拖到目标位置</small></div>}
  </main>;
}
