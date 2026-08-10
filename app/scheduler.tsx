"use client";

import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

type Status = "confirmed" | "pending";
type Task = { id: number; weekId: string; day: number; person: string; time: string; title: string; status: Status };
type CopyItem = { id: number; title: string; content: string; tags: string; createdAt: string; source?: string };
type HotItem = { rank: number; title: string; hot: number };
type Week = { id: string; label: string; range: string; days: { weekday: string; date: string }[] };
type PointerDragState = { taskId: number; pointerId: number; startX: number; startY: number; x: number; y: number; active: boolean };
type DropPreview = { weekId: string; day: number; dayLabel: string; person: string; time: string; minute: number };
type NoticeMeta = { talent: string; count: string; style: string; location: string; clothing: string; makeup: string };
type NoticeVideo = { name: string; version: number };
type NoticeImageKind = "clothing" | "makeup";

const weekdays = ["å‘¨ä¸€", "å‘¨äºŒ", "å‘¨ä¸‰", "å‘¨å››", "å‘¨äº”", "å‘¨å…­"];
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
  const label = index === 0 ? "æœ¬å‘¨" : index === 1 ? "ä¸‹å‘¨" : index === 2 ? "ä¸‹ä¸‹å‘¨" : `ç¬¬ ${index + 1} å‘¨`;
  return { id: startId, label, range: `${dates[0].date}â€”${dates[5].date}`, days: dates };
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
    dayLabel: cell.dataset.dayLabel ?? "ç›®æ ‡æ—¥æœŸ",
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
const seedPeople = ["æ˜Ÿå²©", "å¤§å¼º"];
const seedTasks: Task[] = [
  { id: 1, weekId: baseWeekId, day: 0, person: "æ˜Ÿå²©", time: "16:00", title: "çŒªçŒª Â· å°å¿µå¾—å¿—", status: "confirmed" },
  { id: 2, weekId: baseWeekId, day: 0, person: "å¤§å¼º", time: "16:00", title: "ä¸ä¸ Â· éƒ‘å©·å©·", status: "confirmed" },
  { id: 3, weekId: baseWeekId, day: 1, person: "å¤§å¼º", time: "20:00", title: "å°ç¾Š Â· è¾›è¯—å©·", status: "pending" },
  { id: 4, weekId: baseWeekId, day: 2, person: "æ˜Ÿå²©", time: "20:00", title: "ä¹‹ä¹‹ Â· å¼ é¦¨ä¹‹", status: "confirmed" },
  { id: 5, weekId: baseWeekId, day: 3, person: "å¤§å¼º", time: "16:00", title: "å’©å’© Â· æ¨è”“æ¢“", status: "confirmed" },
];
const seedCopies: CopyItem[] = [{ id: 101, title: "æ‹æ‘„èŠ±çµ®ï½œä¸‰ç§’æŠ“ä½æ³¨æ„åŠ›", content: "é•œå¤´ä¸€å¼€ï¼Œä»Šå¤©çš„å¿«ä¹å°±æœ‰äº†ã€‚åŸæ¥ä¸€æ¡è‡ªç„¶æ¾å¼›çš„è§†é¢‘ï¼ŒèƒŒåè—ç€è¿™ä¹ˆå¤šå°é»˜å¥‘ã€‚", tags: "#æ‹æ‘„èŠ±çµ® #æ—¥å¸¸è®°å½•", createdAt: "ä»Šå¤© 10:24", source: "æ‰‹åŠ¨æ”¶é›†" }];

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

  useEffect(() => {
    try {
      const savedWeeks = localStorage.getItem("shooting-schedule-weeks");
      const savedPeople = localStorage.getItem("shooting-schedule-people");
      const savedTasks = localStorage.getItem("shooting-schedule-tasks");
      const savedCopies = localStorage.getItem("shooting-copy-library");
      const savedNoticeEdits = localStorage.getItem("shooting-notice-edits");
      const savedNoticeOrder = localStorage.getItem("shooting-notice-order");
      if (savedWeeks) setWeeks(JSON.parse(savedWeeks));
      if (savedPeople) setPeople(JSON.parse(savedPeople));
      if (savedTasks) setTasks((JSON.parse(savedTasks) as Omit<Task, "weekId">[]).map(task => ({ ...task, weekId: (task as Task).weekId ?? baseWeekId })));
      if (savedCopies) setCopies(JSON.parse(savedCopies));
      if (savedNoticeEdits) setNoticeEdits(JSON.parse(savedNoticeEdits));
      if (savedNoticeOrder) setNoticeOrder(JSON.parse(savedNoticeOrder));
    } catch { /* ä¿ç•™ç¤ºä¾‹æ•°æ® */ }
  }, []);

  const fetchHot = async (silent = false) => {
    if (!silent) setHotLoading(true);
    try { const response = await fetch(`/api/hot?t=${Date.now()}`, { cache: "no-store" }); const result = await response.json() as { musicItems?: HotItem[]; beautyItems?: HotItem[]; updatedAt?: string }; setMusicItems(result.musicItems ?? []); setBeautyItems(result.beautyItems ?? []); setHotUpdatedAt(result.updatedAt ? new Date(result.updatedAt) : new Date()); }
    catch { setToast("çƒ­ç‚¹æš‚æ—¶æœªèƒ½åˆ·æ–°"); }
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
      return { taskId: task.id, video: video.ok ? { name: decodeURIComponent(video.headers.get("x-video-name") ?? "æ‹æ‘„å‚è€ƒè§†é¢‘"), version: Date.now() } : null, images: { clothing: imageMeta(clothing, "æœè£…å‚è€ƒå›¾"), makeup: imageMeta(makeup, "å¦†å®¹å‚è€ƒå›¾") } };
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
    saveWeeks([...weeks, next]); setSelectedWeekId(next.id); setToast(`${next.label}å·²åŠ å…¥æ’æœŸ`);
  };
  const removeSelectedWeek = () => {
    if (weeks.length === 1) { setToast("è‡³å°‘ä¿ç•™ä¸€ä¸ªæ‹æ‘„å‘¨"); return; }
    const count = tasks.filter(task => task.weekId === selectedWeekId).length;
    if (!window.confirm(count ? `åˆ é™¤${selectedWeek.label}ä¼šåŒæ—¶åˆ é™¤å…¶ä¸­ ${count} æ¡æ‹æ‘„å®‰æ’ï¼Œæ˜¯å¦ç»§ç»­ï¼Ÿ` : `ç¡®è®¤åˆ é™¤${selectedWeek.label}ï¼Ÿ`)) return;
    const remaining = weeks.filter(week => week.id !== selectedWeekId).map((week, index) => makeWeek(week.id, index));
    saveWeeks(remaining); saveTasks(tasks.filter(task => task.weekId !== selectedWeekId));
    setSelectedWeekId(remaining[Math.max(0, weeks.findIndex(week => week.id === selectedWeekId) - 1)]?.id ?? remaining[0].id);
    setToast("æ‹æ‘„å‘¨å·²åˆ é™¤");
  };
  const addPerson = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const names = String(data.get("name")).split(/[ï¼Œ,ã€\s]+/).map(name => name.trim()).filter(Boolean);
    const fresh = [...new Set(names)].filter(name => !people.includes(name));
    if (!fresh.length) { setToast("æ²¡æœ‰å¯æ–°å¢çš„æ‘„å½±å¸ˆ"); return; }
    savePeople([...people, ...fresh]); setToast(`å·²æ–°å¢ ${fresh.length} ä½æ‘„å½±å¸ˆ`); event.currentTarget.reset();
  };
  const removeSelectedPeople = () => {
    if (!selectedPeople.length) { setToast("è¯·å…ˆå‹¾é€‰è¦ç§»é™¤çš„æ‘„å½±å¸ˆ"); return; }
    if (people.length - selectedPeople.length < 1) { setToast("è‡³å°‘ä¿ç•™ä¸€ä½æ‘„å½±å¸ˆ"); return; }
    const assigned = tasks.filter(task => selectedPeople.includes(task.person)).length;
    const message = assigned ? `ç§»é™¤æ‰€é€‰ ${selectedPeople.length} ä½æ‘„å½±å¸ˆä¼šåŒæ—¶åˆ é™¤ ${assigned} æ¡æ‹æ‘„å®‰æ’ï¼Œæ˜¯å¦ç»§ç»­ï¼Ÿ` : `ç¡®è®¤ç§»é™¤æ‰€é€‰ ${selectedPeople.length} ä½æ‘„å½±å¸ˆï¼Ÿ`;
    if (!window.confirm(message)) return;
    savePeople(people.filter(person => !selectedPeople.includes(person)));
    saveTasks(tasks.filter(task => !selectedPeople.includes(task.person)));
    setSelectedPeople([]); setToast("æ‰€é€‰æ‘„å½±å¸ˆå·²ç§»é™¤");
  };
  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const values = { weekId: selectedWeekId, day: Number(data.get("day")), person: String(data.get("person")), time: String(data.get("time")), title: String(data.get("title")), status: tasks.find(task => task.id === taskModal.taskId)?.status ?? "pending" as Status };
    if (taskModal.taskId) { saveTasks(tasks.map(task => task.id === taskModal.taskId ? { ...task, ...values } : task)); setToast("æ‹æ‘„å®‰æ’å·²æ›´æ–°"); }
    else { saveTasks([...tasks, { id: Date.now(), ...values }]); setToast(`å·²åŠ å…¥${selectedWeek.label}æ’æœŸ`); }
    setTaskModal({ ...taskModal, open: false });
  };
  const addCopy = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    saveCopies([{ id: Date.now(), title: String(data.get("title")), content: String(data.get("content")), tags: String(data.get("tags")), createdAt: "åˆšåˆš", source: "æ‰‹åŠ¨æ”¶é›†" }, ...copies]); setCopyView("saved"); setCopyModal(false); setToast("æ–‡æ¡ˆå·²æ”¶è¿›çµæ„Ÿåº“");
  };
  const organizeHot = (item: HotItem, category: "éŸ³ä¹" | "é¢œå€¼") => {
    const keyword = item.title.replace(/[â€œâ€"']/g, "");
    saveCopies([{ id: Date.now(), title: `${category}çƒ­ç‚¹ãOx¶‰Ëkºwµçd¹İ••­‘…åô‘…Ñ„µÁ•ÉÍ½¸õíÁ•ÉÍ½¹ô­•äõíÁ•ÉÍ½¹ôùí±¥ÍĞ¹µ…À¡Ñ…Í¬€ôø€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ‘É……‰±”õí™…±Í•ô‘…Ñ„µÑ…Í¬µ¥õíÑ…Í¬¹¥‘ôÍÑå±”õíìÑ½ÀèÑ…Í­Q½À¡Ñ…Í¬¹Ñ¥µ”¤õô±…ÍÍ9…µ”õíÑ…Í¬µ…É€‘í‘É…¥¹Q…Í­%€ôôôÑ…Í¬¹¥€ü€‰‘É…¥¹œˆ€è€ˆ‰ô€‘íÑ½Õ¡É…œü¹…Ñ¥Ù”€˜˜Ñ½Õ¡É…œ¹Ñ…Í­%€ôôôÑ…Í¬¹¥€ü€‰Ñ½Õ µ‘É…¥¹œˆ€è€ˆ‰õô½¹É…MÑ…ÉĞõí•Ù•¹Ğ€ôø•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¥ô½¹A½¥¹Ñ•É½İ¸õí•Ù•¹Ğ€ôø‰•¥¹Q½Õ¡É…œ¡•Ù•¹Ğ°Ñ…Í¬¹¥¥ô½¹±¥¬õì ¤€ôøì¥˜€¡…Ñ”¹¹½Ü ¤€ğ¥¹½É•±¥­U¹Ñ¥±I•˜¹ÕÉÉ•¹Ğ¤É•ÑÕÉ¸ìÍ•ÑQ…Í­5½‘…°¡ì½Á•¸èÑÉÕ”°‘…äèÑ…Í¬¹‘…ä°Á•ÉÍ½¸èÑ…Í¬¹Á•ÉÍ½¸°Ñ…Í­%èÑ…Í¬¹¥ô¤ìõô­•äõíÑ…Í¬¹¥‘ôøñÍÁ…¸±…ÍÍ9…µ”ô‰‘É…œµÉ¥Àˆ…É¥„µ¡¥‘‘•¸ô‰ÑÉÕ”ˆûŠ.»Š.¸ğ½ÍÁ…¸øñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ…Í¬µÑ¥µ”ˆùíÑ…Í¬¹Ñ¥µ•ôğ½ÍÁ…¸øñÍÑÉ½¹œùíÑ…Í¬¹Ñ¥Ñ±•ôğ½ÍÑÉ½¹œøğ½‰ÕÑÑ½¸ø¥õí¥ÍAÉ•Ù¥•Ü€˜˜‘É½ÁAÉ•Ù¥•Ü€˜˜€ñ‘¥Ø±…ÍÍ9…µ”ô‰‘É½ÀµÍÕÉ™…”ˆ…É¥„µ¡¥‘‘•¸ô‰ÑÉÕ”ˆøñÍÁ…¸±…ÍÍ9…µ”ô‰‘É½ÀµÉ…¹”Ñ½ÀˆøÄÌèÀÀğ½ÍÁ…¸øñÍÁ…¸±…ÍÍ9…µ”ô‰‘É½ÀµÉ…¹”‰½ÑÑ½´ˆøÈÈèÌÀğ½ÍÁ…¸øñ‘¥Ø±…ÍÍ9…µ”ô‰‘É½ÀµÑ¥µ”µ¥¹‘¥…Ñ½ÈˆÍÑå±”õíìÑ½Àè€‘ì ¡‘É½ÁAÉ•Ù¥•Ü¹µ¥¹ÕÑ”€´Ñ¥µ•±¥¹•MÑ…ÉĞ¤€¼Ñ¥µ•±¥¹•ÕÉ…Ñ¥½¸¤€¨€ÄÀÁô•€õôøñˆùí‘É½ÁAÉ•Ù¥•Ü¹Ñ¥µ•ôğ½ˆøğ½‘¥Øøğ½‘¥Øùôñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰Ñ¥µ•±¥¹”µ…‘ˆ½¹±¥¬õì ¤€ôøÍ•ÑQ…Í­5½‘…°¡ì½Á•¸èÑÉÕ”°‘…äè‘…å%¹‘•à°Á•ÉÍ½¸°Ñ…Í­%è¹Õ±°ô¥ôû¾ò,ğ½‰ÕÑÑ½¸øğ½‘¥Øøìô¥ô(€€€€€€€€€€ğ½‘¥Øø¥ô(€€€€€€€€ğ½‘¥Øøğ½‘¥Øø(€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰™½½Ñ¹½Ñ”ˆû–ß’öOš.7šFš^Û¦^Ó’î—¢¦ŠGú“–šrî#¦k–F+’âë–ƒ
ÜƒšRçšr¢¾ß¢Ï–ÂGš>C–&7’â“–’§–6?¢Âğ½Àø(€€€€€€ğ½Í•Ñ¥½¸ø((€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰½ÁäµÁ…¹”ˆøñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹”µ¡•…‘¥¹œ½Áäµ¡•…‘¥¹œˆøñ‘¥ØøñÀ±…ÍÍ9…µ”ô‰•å•‰É½ÜˆùQI9IHğ½Àøñ Èû¦~Ï’æCššpƒ
Üƒ¦Šs–óššpğ½ ÈøñÀ±…ÍÍ9…µ”ô‰ÍÕ‰Ñ¥Ñ±”ˆû’î’şwVg¦~Ï’æC¢"{¢æ#–š–ºç¦ÿšB·’â;¦Šs–óÆï×šğ½Àøğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰±¥Ù”µÑ½½±ÌˆøñÍÁ…¸±…ÍÍ9…µ”ô‰±¥Ù”µÍÑ…ÑÕÌˆøñ¤€¼ùí¡½ÑUÁ‘…Ñ•‘Ğ€ü€‘í¡½ÑUÁ‘…Ñ•‘Ğ¹Ñ½1½…±•Q¥µ•MÑÉ¥¹œ ‰é µ8ˆ°ì¡½ÕÈè€ˆÈµ‘¥¥Ğˆ°µ¥¹ÕÑ”è€ˆÈµ‘¥¥Ğˆô¥ôƒ–ŞËšnÓšZÁ€€è€‹–º{š^Û–B3š¶”‰ôğ½ÍÁ…¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰½ÕÑ±¥¹”µ‰Ñ¸ˆ½¹±¥¬õì ¤€ôø™•Ñ¡!½Ğ¡™…±Í”¥ô‘¥Í…‰±•õí¡½Ñ1½…‘¥¹ôùí¡½Ñ1½…‘¥¹œ€ü€‹–B3š¶—’â·Š˜ˆ€è€‹Šìƒ–"ßšZÀ‰ôğ½‰ÕÑÑ½¸øğ½‘¥Øøğ½‘¥Øø(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á±…Ñ™½É´µÑ…‰ÌÑÉ•¹µÑ…‰ÌˆÉ½±”ô‰Ñ…‰±¥ÍĞˆøñ‰ÕÑÑ½¸±…ÍÍ9…µ”õí½ÁåY¥•Ü€ôôô€‰µÕÍ¥Œˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô½¹±¥¬õì ¤€ôøÍ•Ñ½ÁåY¥•Ü ‰µÕÍ¥Œˆ¥ôøñÍÁ…¸±…ÍÍ9…µ”ô‰Á±…Ñ™½É´µ¥½¸µÕÍ¥Œµ¥½¸ˆû’æ@ğ½ÍÁ…¸û¦~Ï’æCššpñˆùíµÕÍ¥%Ñ•µÌ¹±•¹Ñ¡ôğ½ˆøğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”õí½ÁåY¥•Ü€ôôô€‰‰•…ÕÑäˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô½¹±¥¬õì ¤€ôøÍ•Ñ½ÁåY¥•Ü ‰‰•…ÕÑäˆ¥ôøñÍÁ…¸±…ÍÍ9…µ”ô‰Á±…Ñ™½É´µ¥½¸‰•…ÕÑäµ¥½¸ˆû¦Špğ½ÍÁ…¸û¦Šs–óššpñˆùí‰•…ÕÑå%Ñ•µÌ¹±•¹Ñ¡ôğ½ˆøğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”õí½ÁåY¥•Ü€ôôô€‰Í…Ù•ˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô½¹±¥¬õì ¤€ôøÍ•Ñ½ÁåY¥•Ü ‰Í…Ù•ˆ¥ôøñÍÁ…¸±…ÍÍ9…µ”ô‰Á±…Ñ™½É´µ¥½¸Í…Ù•µ¥½¸ˆû¢üğ½ÍÁ…¸û–ŞËšVÓBñˆùí½Á¥•Ì¹±•¹Ñ¡ôğ½ˆøğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”õí½ÁåY¥•Ü€ôôô€‰¹½Ñ¥”ˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô½¹±¥¬õì ¤€ôøÍ•Ñ½ÁåY¥•Ü ‰¹½Ñ¥”ˆ¥ôøñÍÁ…¸±…ÍÍ9…µ”ô‰Á±…Ñ™½É´µ¥½¸¹½Ñ¥”µ¥½¸ˆû–F(ğ½ÍÁ…¸ûš.7šF¦k–F(ñˆùíİ••­Q…Í­Ì¹±•¹Ñ¡ôğ½ˆøğ½‰ÕÑÑ½¸øğ½‘¥Øø(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½Áäµ±¥ÍĞˆùí½ÁåY¥•Ü€ôôô€‰µÕÍ¥Œˆ€˜˜É…¹­¥¹A…¹•°¡µÕÍ¥%Ñ•µÌ°€‹¦~Ï’æ@ˆ¥õí½ÁåY¥•Ü€ôôô€‰‰•…ÕÑäˆ€˜˜É…¹­¥¹A…¹•°¡‰•…ÕÑå%Ñ•µÌ°€‹¦Šs–ğˆ¥ô(€€€€€€€í½ÁåY¥•Ü€ôôô€‰Í…Ù•ˆ€˜˜€¡½Á¥•Ì¹±•¹Ñ €ü€ğøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰µ…¹Õ…°µ…‘ˆ½¹±¥¬õì ¤€ôøÍ•Ñ½Áå5½‘…°¡ÑÉÕ”¥ôû¾ò,ƒš&/–*£šRÛ¦n’âšv„ğ½‰ÕÑÑ½¸ùí½Á¥•Ì¹µ…À¡¥Ñ•´€ôø€ñ…ÉÑ¥±”±…ÍÍ9…µ”ô‰½Áäµ…Éˆ­•äõí¥Ñ•´¹¥‘ôøñ‘¥Ø±…ÍÍ9…µ”ô‰½Áäµ…ÉµÑ½ÀˆøñÍÁ…¸±…ÍÍ9…µ”ô‰½ÁäµÁ±…Ñ™½É´ˆùí¥Ñ•´¹Í½ÕÉ”€üü€‹š*[¦~Ï·
ä‰ôğ½ÍÁ…¸øñÍÁ…¸ùí¥Ñ•´¹É•…Ñ•‘Ñôğ½ÍÁ…¸øğ½‘¥Øøñ Ìùí¥Ñ•´¹Ñ¥Ñ±•ôğ½ ÌøñÀ±…ÍÍ9…µ”ô‰™½Éµ…ÑÑ•µ½Áäˆùí¥Ñ•´¹½¹Ñ•¹Ñôğ½Àøñ‘¥Ø±…ÍÍ9…µ”ô‰½ÁäµÑ…Ìˆùí¥Ñ•´¹Ñ…Íôğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰½Áäµ…Ñ¥½¹Ìˆøñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôø½ÁåQ•áĞ¡¥Ñ•´¥ôû–’7–"Û–£šZğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôøìÍ…Ù•½Á¥•Ì¡½Á¥•Ì¹™¥±Ñ•È¡½Áä€ôø½Áä¹¥€„ôô¥Ñ•´¹¥¤¤ìÍ•ÑQ½…ÍĞ ‹šZš†#–ŞË–"ƒ¦fˆ¤ìõôû–"ƒ¦fğ½‰ÕÑÑ½¸øğ½‘¥Øøğ½…ÉÑ¥±”ø¥ôğ¼ø€è€ñ‘¥Ø±…ÍÍ9…µ”ô‰½Áäµ•µÁÑäˆøñÍÁ…¸û¾ò,ğ½ÍÁ…¸øñ Ìû¢şcšÊ‡šr'šVÓB––÷jšZš† ğ½ ÌøñÀû’î;¦~Ï’æCššsš"[¦Šs–óššs¦'š.§×š¾ò3Rš"Cš.7šFš†šzÛğ½Àøñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôøÍ•Ñ½ÁåY¥•Ü ‰µÕÍ¥Œˆ¥ôû–:ïr/¦~Ï’æCššpğ½‰ÕÑÑ½¸øğ½‘¥Øø¥ô(€€€€€€€í½ÁåY¥•Ü€ôôô€‰¹½Ñ¥”ˆ€˜˜€¡İ••­Q…Í­Ì¹±•¹Ñ €ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰¹½Ñ¥”µ±¥ÍĞˆøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰½Áäµ…±°µ¹½Ñ¥•Ìˆ½¹±¥¬õí½Áå±±9½Ñ¥•Íôû–’7–"Ûšr³–F£–£¦£¦k–F(ğ½‰ÕÑÑ½¸ùí½É‘•É•‘]••­Q…Í­Ì¹µ…À¡Ñ…Í¬€ôøì½¹ÍĞ‘…ä€ôÍ•±•Ñ•‘]••¬¹‘…åÍmÑ…Í¬¹‘…åtì½¹ÍĞµ•Ñ„€ô¹½Ñ¥•5•Ñ„¡Ñ…Í¬¤ì½¹ÍĞÙ¥‘•¼€ô¹½Ñ¥•Y¥‘•½ÍmÑ…Í¬¹¥‘tì½¹ÍĞ±½Ñ¡¥¹%µ…”€ô¹½Ñ¥•%µ…•ÍmÑ…Í¬¹¥‘tü¹±½Ñ¡¥¹œì½¹ÍĞµ…­•ÕÁ%µ…”€ô¹½Ñ¥•%µ…•ÍmÑ…Í¬¹¥‘tü¹µ…­•ÕÀì½¹ÍĞ±½Ñ¡¥¹UÁ±½…‘¥¹œ€ô¥µ…•UÁ±½…‘¥¹œü¹Ñ…Í­%€ôôôÑ…Í¬¹¥€˜˜¥µ…•UÁ±½…‘¥¹œ¹­¥¹€ôôô€‰±½Ñ¡¥¹œˆì½¹ÍĞµ…­•ÕÁUÁ±½…‘¥¹œ€ô¥µ…•UÁ±½…‘¥¹œü¹Ñ…Í­%€ôôôÑ…Í¬¹¥€˜˜¥µ…•UÁ±½…‘¥¹œ¹­¥¹€ôôô€‰µ…­•ÕÀˆìÉ•ÑÕÉ¸€ñ…ÉÑ¥±”±…ÍÍ9…µ”õí¹½Ñ¥”µ…É€‘í‘É…•‘9½Ñ¥•%€ôôôÑ…Í¬¹¥€ü€‰¹½Ñ¥”µ‘É…¥¹œˆ€è€ˆ‰õô½¹É…=Ù•Èõí•Ù•¹Ğ€ôøì•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¤ì•Ù•¹Ğ¹‘…Ñ…QÉ…¹Í™•È¹‘É½Á™™•Ğ€ô€‰µ½Ù”ˆìõô½¹É½Àõí•Ù•¹Ğ€ôøì•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¤ìÉ•½É‘•É9½Ñ¥”¡Ñ…Í¬¹¥¤ìõô­•äõíÑ…Í¬¹¥‘ôøñ‘¥Ø±…ÍÍ9…µ”ô‰¹½Ñ¥”µ…Éµ¡•…ˆ‘É……‰±”½¹É…MÑ…ÉĞõí•Ù•¹Ğ€ôøìÍ•ÑÉ…•‘9½Ñ¥•%¡Ñ…Í¬¹¥¤ì•Ù•¹Ğ¹‘…Ñ…QÉ…¹Í™•È¹•™™•Ñ±±½İ•€ô€‰µ½Ù”ˆìõô½¹É…¹õì ¤€ôøÍ•ÑÉ…•‘9½Ñ¥•%¡¹Õ±°¥ôøñ‘¥ØøñÍÁ…¸øñ¤±…ÍÍ9…µ”ô‰¹½Ñ¥”µÉ¥ÀˆûŠ.»Š.¸ğ½¤øM!==P9=Q%ğ½ÍÁ…¸øñˆùí‘…ä¹İ••­‘…åôƒ
Üí‘…ä¹‘…Ñ•ôğ½ˆøğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰¹½Ñ¥”µ¡•…µ…Ñ¥½¹Ìˆøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰¹½Ñ¥”µ•‘¥Ğˆ½¹±¥¬õì ¤€ôøÍ•Ñ‘¥Ñ¥¹9½Ñ¥•%¡Ñ…Í¬¹¥¥ôûò[¢úDğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôø½Áå9½Ñ¥”¡Ñ…Í¬¥ôû–’7–"Øğ½‰ÕÑÑ½¸øğ½‘¥Øøğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰¹½Ñ¥”µ‰½‘äˆøñÀøñÍÁ…¸ûš.7šF¢úû’êèğ½ÍÁ…¸øñÍÑÉ½¹œùíµ•Ñ„¹Ñ…±•¹Ñôğ½ÍÑÉ½¹œøğ½ÀøñÀøñÍÁ…¸ûš.7šFš^Û¦^Ğğ½ÍÁ…¸øñÍÑÉ½¹œùí‘…ä¹İ••­‘…åôí‘…ä¹‘…Ñ”¹É•Á±…” ˆ¸ˆ°€‹šr ˆ¥÷š^”íÑ…Í¬¹Ñ¥µ•ôğ½ÍÑÉ½¹œøğ½ÀøñÀøñÍÁ…¸ûš.7šFšv‡šVÀğ½ÍÁ…¸øñÍÑÉ½¹œùíµ•Ñ„¹½Õ¹Ñôğ½ÍÑÉ½¹œøğ½ÀøñÀøñÍÁ…¸ûš.7šF¦;š‚ğğ½ÍÁ…¸øñÍÑÉ½¹œùíµ•Ñ„¹ÍÑå±•ôğ½ÍÑÉ½¹œøğ½ÀøñÀøñÍÁ…¸ûš.7šF–rÃ
äğ½ÍÁ…¸øñÍÑÉ½¹œùíµ•Ñ„¹±½…Ñ¥½¹ôğ½ÍÑÉ½¹œøğ½ÀøñÀøñÍÁ…¸ûšr7¢–>¢ğ½ÍÁ…¸øñÍÑÉ½¹œùíµ•Ñ„¹±½Ñ¡¥¹ôğ½ÍÑÉ½¹œøğ½ÀøñÀøñÍÁ…¸û–š–ºç–>¢ğ½ÍÁ…¸øñÍÑÉ½¹œùíµ•Ñ„¹µ…­•ÕÁôğ½ÍÑÉ½¹œøğ½ÀøñÀøñÍÁ…¸ûšF–öÇ–â ğ½ÍÁ…¸øñÍÑÉ½¹œùíÑ…Í¬¹Á•ÉÍ½¹ôğ½ÍÑÉ½¹œøğ½Àøğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰¹½Ñ¥”µÉ•™•É•¹”µÉ¥ˆøñ‘¥Ø±…ÍÍ9…µ”ô‰¹½Ñ¥”µÉ•™•É•¹”ˆøñˆûšr7¢–>¢–nøğ½ˆùí±½Ñ¡¥¹%µ…”€˜˜€ñ‘¥Ø±…ÍÍ9…µ”ô‰¹½Ñ¥”µ¥µ…”ˆøñ¥µœ‘É……‰±”õí™…±Í•ôÍÉŒõí€½…Á¤½¹½Ñ¥•Ì¼‘íÑ…Í¬¹¥‘ô½¥µ…”ı­¥¹õ±½Ñ¡¥¹œ™Øô‘í±½Ñ¡¥¹%µ…”¹Ù•ÉÍ¥½¹õô…±Ğõí€‘íµ•Ñ„¹Ñ…±•¹Ñ÷jšr7¢–>¢ô€¼øñ‘¥ØøñÍÁ…¸ùí±½Ñ¡¥¹%µ…”¹¹…µ•ôğ½ÍÁ…¸øñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôø‘•±•Ñ•9½Ñ¥•%µ…”¡Ñ…Í¬¹¥°€‰±½Ñ¡¥¹œˆ¥ôû–"ƒ¦fğ½‰ÕÑÑ½¸øğ½‘¥Øøğ½‘¥Øùôñ±…‰•°±…ÍÍ9…µ”õí¹½Ñ¥”µÙ¥‘•¼µ…‘€‘í±½Ñ¡¥¹UÁ±½…‘¥¹œ€ü€‰ÕÁ±½…‘¥¹œˆ€è€ˆ‰õôùí±½Ñ¡¥¹UÁ±½…‘¥¹œ€ü€‹–nû&’â+’òƒ’â·Š˜ˆ€è±½Ñ¡¥¹%µ…”€ü€‹šnÓš6‹šr7¢–nøˆ€è€‹¾ò,ƒšŞï–*ƒšr7¢–nø‰ôñ¥¹ÁÕĞÑåÁ”ô‰™¥±”ˆ…•ÁĞô‰¥µ…”¼¨ˆ‘¥Í…‰±•õí±½Ñ¡¥¹UÁ±½…‘¥¹ô½¹¡…¹”õí•Ù•¹Ğ€ôøÕÁ±½…‘9½Ñ¥•%µ…”¡Ñ…Í¬¹¥°€‰±½Ñ¡¥¹œˆ°•Ù•¹Ğ¹Ñ…É•Ğ¹™¥±•Ìü¹lÁt¥ô€¼øğ½±…‰•°øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰¹½Ñ¥”µÉ•™•É•¹”ˆøñˆû–š–ºç–>¢–nøğ½ˆùíµ…­•ÕÁ%µ…”€˜˜€ñ‘¥Ø±…ÍÍ9…µ”ô‰¹½Ñ¥”µ¥µ…”ˆøñ¥µœ‘É……‰±”õí™…±Í•ôÍÉŒõí€½…Á¤½¹½Ñ¥•Ì¼‘íÑ…Í¬¹¥‘ô½¥µ…”ı­¥¹õµ…­•ÕÀ™Øô‘íµ…­•ÕÁ%µ…”¹Ù•ÉÍ¥½¹õô…±Ğõí€‘íµ•Ñ„¹Ñ…±•¹Ñ÷j–š–ºç–>¢ô€¼øñ‘¥ØøñÍÁ…¸ùíµ…­•ÕÁ%µ…”¹¹…µ•ôğ½ÍÁ…¸øñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôø‘•±•Ñ•9½Ñ¥•%µ…”¡Ñ…Í¬¹¥°€‰µ…­•ÕÀˆ¥ôû–"ƒ¦fğ½‰ÕÑÑ½¸øğ½‘¥Øøğ½‘¥Øùôñ±…‰•°±…ÍÍ9…µ”õí¹½Ñ¥”µÙ¥‘•¼µ…‘€‘íµ…­•ÕÁUÁ±½…‘¥¹œ€ü€‰ÕÁ±½…‘¥¹œˆ€è€ˆ‰õôùíµ…­•ÕÁUÁ±½…‘¥¹œ€ü€‹–nû&’â+’òƒ’â·Š˜ˆ€èµ…­•ÕÁ%µ…”€ü€‹šnÓš6‹–š–ºç–nøˆ€è€‹¾ò,ƒšŞï–*ƒ–š–ºç–nø‰ôñ¥¹ÁÕĞÑåÁ”ô‰™¥±”ˆ…•ÁĞô‰¥µ…”¼¨ˆ‘¥Í…‰±•õíµ…­•ÕÁUÁ±½…‘¥¹ô½¹¡…¹”õí•Ù•¹Ğ€ôøÕÁ±½…‘9½Ñ¥•%µ…”¡Ñ…Í¬¹¥°€‰µ…­•ÕÀˆ°•Ù•¹Ğ¹Ñ…É•Ğ¹™¥±•Ìü¹lÁt¥ô€¼øğ½±…‰•°øğ½‘¥Øøğ½‘¥ØùíÙ¥‘•¼€˜˜€ñ‘¥Ø±…ÍÍ9…µ”ô‰¹½Ñ¥”µÙ¥‘•¼ˆøñÙ¥‘•¼½¹ÑÉ½±Ì‘É……‰±”õí™…±Í•ôÁÉ•±½…ô‰µ•Ñ…‘…Ñ„ˆÍÉŒõí€½…Á¤½¹½Ñ¥•Ì¼‘íÑ…Í¬¹¥‘ô½Ù¥‘•¼ıØô‘íÙ¥‘•¼¹Ù•ÉÍ¥½¹õô€¼øñ‘¥ØøñÍÁ…¸ùíÙ¥‘•¼¹¹…µ•ôğ½ÍÁ…¸øñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôø‘•±•Ñ•9½Ñ¥•Y¥‘•¼¡Ñ…Í¬¹¥¥ôû–"ƒ¦f“¢¦ŠDğ½‰ÕÑÑ½¸øğ½‘¥Øøğ½‘¥Øùôñ±…‰•°±…ÍÍ9…µ”õí¹½Ñ¥”µÙ¥‘•¼µ…‘¹½Ñ¥”µÙ¥‘•¼µ½¹ÑÉ½°€‘íÙ¥‘•½UÁ±½…‘¥¹%€ôôôÑ…Í¬¹¥€ü€‰ÕÁ±½…‘¥¹œˆ€è€ˆ‰õôùíÙ¥‘•½UÁ±½…‘¥¹%€ôôôÑ…Í¬¹¥€ü€‹¢¦ŠG’â+’òƒ’â·Š˜ˆ€èÙ¥‘•¼€ü€‹šnÓš6‹¢¦ŠDˆ€è€‹¾ò,ƒšŞï–*ƒ¢¦ŠD‰ôñ¥¹ÁÕĞÑåÁ”ô‰™¥±”ˆ…•ÁĞô‰Ù¥‘•¼¼¨ˆ‘¥Í…‰±•õíÙ¥‘•½UÁ±½…‘¥¹%€ôôôÑ…Í¬¹¥‘ô½¹¡…¹”õí•Ù•¹Ğ€ôøÕÁ±½…‘9½Ñ¥•Y¥‘•¼¡Ñ…Í¬¹¥°•Ù•¹Ğ¹Ñ…É•Ğ¹™¥±•Ìü¹lÁt¥ô€¼øğ½±…‰•°øğ½…ÉÑ¥±”øìô¥ôğ½‘¥Øø€è€ñ‘¥Ø±…ÍÍ9…µ”ô‰½Áäµ•µÁÑäˆøñÍÁ…¸û–F(ğ½ÍÁ…¸øñ Ìûšr³–F£¢şcšÊ‡šr'š.7šF¦k–F(ğ½ ÌøñÀû–#–r£–Ş›’úŸšZÃ–Š{š.7šF–º'š:K¾ò3¦k–F+–6‡&’òk¢«–*£Rš"Cğ½Àøğ½‘¥Øø¥ôğ½‘¥ØøñÀ±…ÍÍ9…µ”ô‰‘…Ñ„µÍ½ÕÉ”ˆùí½ÁåY¥•Ü€ôôô€‰¹½Ñ¥”ˆ€ü€‹šr7¢’â;–š–ºç–>¢–nû–>¿–"–"¯’â+’òƒ¦Š¢#–J3šnÓš6ˆˆ€è½ÁåY¥•Ü€ôôô€‰Í…Ù•ˆ€ü€‹–ŞËšVÓBj¦~Ï’æC’â;¦Šs–ó×š|ˆ€è€‹’î–ÆW’ë¦~Ï’æC¢"{¢æ#–š–ºç¦ÿšB·’â;¦Šs–ó––ºä‰ôğ½Àø(€€€€€€ğ½Í•Ñ¥½¸ø(€€€€ğ½‘¥Øø(€€ğ½Í•Ñ¥½¸ø((€íÑ…Í­5½‘…°¹½Á•¸€˜˜€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°µ‰…­‘É½Àˆ½¹5½ÕÍ•½İ¸õí•Ù•¹Ğ€ôø•Ù•¹Ğ¹Ñ…É•Ğ€ôôô•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ€˜˜Í•ÑQ…Í­5½‘…°¡ì€¸¸¹Ñ…Í­5½‘…°°½Á•¸è™…±Í”ô¥ôøñ™½É´±…ÍÍ9…µ”ô‰µ½‘…°ˆ½¹MÕ‰µ¥Ğõí…‘‘Q…Í­ôøñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°µÑ¥Ñ±”ˆøñ‘¥ØøñÀ±…ÍÍ9…µ”ô‰•å•‰É½Üˆùí•‘¥Ñ¥¹Q…Í¬€ü€‰%PM!==Pˆ€è€‰9\M!==P‰ôƒ
ÜíÍ•±•Ñ•‘]••¬¹±…‰•±ôğ½Àøñ Èùí•‘¥Ñ¥¹Q…Í¬€ü€‹ò[¢úGš.7šF–º'š:Hˆ€è€‹šZÃ–Š{š.7šF–º'š:H‰ôğ½ Èøğ½‘¥Øøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰±½Í”ˆ½¹±¥¬õì ¤€ôøÍ•ÑQ…Í­5½‘…°¡ì€¸¸¹Ñ…Í­5½‘…°°½Á•¸è™…±Í”ô¥ôû\ğ½‰ÕÑÑ½¸øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™½É´µÉ¥ˆøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±™Õ±°ˆøñ±…‰•°û’âïšJ´ƒ
Üƒ––ºä€¼ƒ–b'–ºøğ½±…‰•°øñ¥¹ÁÕĞ¹…µ”ô‰Ñ¥Ñ±”ˆÁ±…•¡½±‘•Èô‹’ú/–š¾òk–Â?ú(ƒ
ÜƒšZÃ–N–>šJ´ˆ‘•™…Õ±ÑY…±Õ”õí•‘¥Ñ¥¹Q…Í¬ü¹Ñ¥Ñ±”€üü€ˆ‰ôÉ•ÅÕ¥É•…ÕÑ½½ÕÌ€¼øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±ˆøñ±…‰•°ûš.7šFš^—šr|ğ½±…‰•°øñÍ•±•Ğ¹…µ”ô‰‘…äˆ‘•™…Õ±ÑY…±Õ”õí•‘¥Ñ¥¹Q…Í¬ü¹‘…ä€üüÑ…Í­5½‘…°¹‘…åôùíÍ•±•Ñ•‘]••¬¹‘…åÌ¹µ…À ¡‘…ä°¥¹‘•à¤€ôø€ñ½ÁÑ¥½¸Ù…±Õ”õí¥¹‘•áô­•äõí‘…ä¹İ••­‘…åôùí‘…ä¹İ••­‘…åôƒ
Üí‘…ä¹‘…Ñ•ôğ½½ÁÑ¥½¸ø¥ôğ½Í•±•Ğøğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±ˆøñ±…‰•°ûš.7šFš^Û¦^Ğƒ
Ü€ÄÌèÀÃŠPÈÈèÌÀğ½±…‰•°øñ¥¹ÁÕĞ¹…µ”ô‰Ñ¥µ”ˆÑåÁ”ô‰Ñ¥µ”ˆµ¥¸ôˆÄÌèÀÀˆµ…àôˆÈÈèÌÀˆÍÑ•ÀôˆÌÀÀˆ‘•™…Õ±ÑY…±Õ”õí•‘¥Ñ¥¹Q…Í¬€üÑ¥µ•±¥¹•Q¥µ”¡•‘¥Ñ¥¹Q…Í¬¹Ñ¥µ”¤€è€ˆÄØèÀÀ‰ôÉ•ÅÕ¥É•€¼øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±ˆøñ±…‰•°ûšF–öÇ–â ğ½±…‰•°øñÍ•±•Ğ¹…µ”ô‰Á•ÉÍ½¸ˆ‘•™…Õ±ÑY…±Õ”õí•‘¥Ñ¥¹Q…Í¬ü¹Á•ÉÍ½¸€üüÑ…Í­5½‘…°¹Á•ÉÍ½¹ôùíÁ•½Á±”¹µ…À¡Á•ÉÍ½¸€ôø€ñ½ÁÑ¥½¸­•äõíÁ•ÉÍ½¹ôùíÁ•ÉÍ½¹ôğ½½ÁÑ¥½¸ø¥ôğ½Í•±•Ğøğ½‘¥Øøğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”õíµ½‘…°µ…Ñ¥½¹Ì€‘í•‘¥Ñ¥¹Q…Í¬€ü€‰•‘¥Ñ¥¹œµ…Ñ¥½¹Ìˆ€è€ˆ‰õôùí•‘¥Ñ¥¹Q…Í¬€˜˜€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰‘•±•Ñ”µ‰Ñ¸ˆ½¹±¥¬õì ¤€ôøìÍ…Ù•Q…Í­Ì¡Ñ…Í­Ì¹™¥±Ñ•È¡Ñ…Í¬€ôøÑ…Í¬¹¥€„ôô•‘¥Ñ¥¹Q…Í¬¹¥¤¤ìÍ•ÑQ…Í­5½‘…°¡ì€¸¸¹Ñ…Í­5½‘…°°½Á•¸è™…±Í”ô¤ìÍ•ÑQ½…ÍĞ ‹š.7šF–º'š:K–ŞË–"ƒ¦fˆ¤ìõôû–"ƒ¦f“–º'š:Hğ½‰ÕÑÑ½¸ùôñÍÁ…¸±…ÍÍ9…µ”ô‰…Ñ¥½¸µÍÁ…•Èˆ€¼øñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰…¹•°µ‰Ñ¸ˆ½¹±¥¬õì ¤€ôøÍ•ÑQ…Í­5½‘…°¡ì€¸¸¹Ñ…Í­5½‘…°°½Á•¸è™…±Í”ô¥ôû–>[šÚ ğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰ÁÉ¥µ…Éäµ‰Ñ¸ˆùí•‘¥Ñ¥¹Q…Í¬€ü€‹’şw–¶cšnÓšRäˆ€è€‹–*ƒ–—š:Kšr|‰ôğ½‰ÕÑÑ½¸øğ½‘¥Øøğ½™½É´øğ½‘¥Øùô((€í•‘¥Ñ¥¹9½Ñ¥•Q…Í¬€˜˜€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°µ‰…­‘É½Àˆ½¹5½ÕÍ•½İ¸õí•Ù•¹Ğ€ôø•Ù•¹Ğ¹Ñ…É•Ğ€ôôô•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ€˜˜Í•Ñ‘¥Ñ¥¹9½Ñ¥•%¡¹Õ±°¥ôøñ™½É´±…ÍÍ9…µ”ô‰µ½‘…°¹½Ñ¥”µ•‘¥Ğµµ½‘…°ˆ½¹MÕ‰µ¥ĞõíÍ…Ù•9½Ñ¥•‘¥Ñôøñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°µÑ¥Ñ±”ˆøñ‘¥ØøñÀ±…ÍÍ9…µ”ô‰•å•‰É½Üˆù%P9=Q%ğ½Àøñ Èûò[¢úGš.7šF¦k–F(ğ½ ÈøñÀ±…ÍÍ9…µ”ô‰ÍÕ‰Ñ¥Ñ±”ˆûš^—šrš^Û¦^Ó’â;šF–öÇ–â#¢Ş¦j?–Ş›’úŸš:Kšrğ½Àøğ½‘¥Øøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰±½Í”ˆ½¹±¥¬õì ¤€ôøÍ•Ñ‘¥Ñ¥¹9½Ñ¥•%¡¹Õ±°¥ôû\ğ½‰ÕÑÑ½¸øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™½É´µÉ¥ˆøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±ˆøñ±…‰•°ûš.7šF¢úû’êèğ½±…‰•°øñ¥¹ÁÕĞ¹…µ”ô‰Ñ…±•¹Ğˆ‘•™…Õ±ÑY…±Õ”õí¹½Ñ¥•5•Ñ„¡•‘¥Ñ¥¹9½Ñ¥•Q…Í¬¤¹Ñ…±•¹ÑôÉ•ÅÕ¥É•…ÕÑ½½ÕÌ€¼øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±ˆøñ±…‰•°ûš.7šFšv‡šVÀğ½±…‰•°øñ¥¹ÁÕĞ¹…µ”ô‰½Õ¹ĞˆÑåÁ”ô‰¹Õµ‰•Èˆµ¥¸ôˆÄˆ‘•™…Õ±ÑY…±Õ”õí¹½Ñ¥•5•Ñ„¡•‘¥Ñ¥¹9½Ñ¥•Q…Í¬¤¹½Õ¹ÑôÉ•ÅÕ¥É•€¼øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±ˆøñ±…‰•°ûš.7šF¦;š‚ğğ½±…‰•°øñ¥¹ÁÕĞ¹…µ”ô‰ÍÑå±”ˆ‘•™…Õ±ÑY…±Õ”õí¹½Ñ¥•5•Ñ„¡•‘¥Ñ¥¹9½Ñ¥•Q…Í¬¤¹ÍÑå±•ôÉ•ÅÕ¥É•€¼øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±ˆøñ±…‰•°ûš.7šF–rÃ
äğ½±…‰•°øñ¥¹ÁÕĞ¹…µ”ô‰±½…Ñ¥½¸ˆ‘•™…Õ±ÑY…±Õ”õí¹½Ñ¥•5•Ñ„¡•‘¥Ñ¥¹9½Ñ¥•Q…Í¬¤¹±½…Ñ¥½¹ôÉ•ÅÕ¥É•€¼øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±ˆøñ±…‰•°ûšr7¢–>¢ğ½±…‰•°øñ¥¹ÁÕĞ¹…µ”ô‰±½Ñ¡¥¹œˆ‘•™…Õ±ÑY…±Õ”õí¹½Ñ¥•5•Ñ„¡•‘¥Ñ¥¹9½Ñ¥•Q…Í¬¤¹±½Ñ¡¥¹ôÁ±…•¡½±‘•Èô‹’ú/–š¾òkºê›š^—–âãšÖ¢&ËÎìˆÉ•ÅÕ¥É•€¼øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±ˆøñ±…‰•°û–š–ºç–>¢ğ½±…‰•°øñ¥¹ÁÕĞ¹…µ”ô‰µ…­•ÕÀˆ‘•™…Õ±ÑY…±Õ”õí¹½Ñ¥•5•Ñ„¡•‘¥Ñ¥¹9½Ñ¥•Q…Í¬¤¹µ…­•ÕÁôÁ±…•¡½±‘•Èô‹’ú/–š¾òk¢«Ûšâ¦?¢öïš²Ÿú8ˆÉ•ÅÕ¥É•€¼øğ½‘¥Øøğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°µ…Ñ¥½¹Ìˆøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰…¹•°µ‰Ñ¸ˆ½¹±¥¬õì ¤€ôøÍ•Ñ‘¥Ñ¥¹9½Ñ¥•%¡¹Õ±°¥ôû–>[šÚ ğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰ÁÉ¥µ…Éäµ‰Ñ¸ˆû’şw–¶c¦k–F(ğ½‰ÕÑÑ½¸øğ½‘¥Øøğ½™½É´øğ½‘¥Øùô((€íÁ•½Á±•5½‘…°€˜˜€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°µ‰…­‘É½Àˆ½¹5½ÕÍ•½İ¸õí•Ù•¹Ğ€ôø•Ù•¹Ğ¹Ñ…É•Ğ€ôôô•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ€˜˜Í•ÑA•½Á±•5½‘…°¡™…±Í”¥ôøñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°Á•½Á±”µµ½‘…°ˆøñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°µÑ¥Ñ±”ˆøñ‘¥ØøñÀ±…ÍÍ9…µ”ô‰•å•‰É½ÜˆùQ4ğ½Àøñ Èûº‡BšF–öÇ–â ğ½ ÈøñÀ±…ÍÍ9…µ”ô‰ÍÕ‰Ñ¥Ñ±”ˆû–>¿š&ç¦?šŞï–*ƒ¾ò3’æ–>¿–.û¦'–’k’ö7–B;î’âï¦f“ğ½Àøğ½‘¥Øøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰±½Í”ˆ½¹±¥¬õì ¤€ôøÍ•ÑA•½Á±•5½‘…°¡™…±Í”¥ôû\ğ½‰ÕÑÑ½¸øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰Á•½Á±”µÑ½½±‰…Èˆøñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôøÍ•ÑM•±•Ñ•‘A•½Á±”¡Í•±•Ñ•‘A•½Á±”¹±•¹Ñ €ôôôÁ•½Á±”¹±•¹Ñ €ümt€èl¸¸¹Á•½Á±•t¥ôùíÍ•±•Ñ•‘A•½Á±”¹±•¹Ñ €ôôôÁ•½Á±”¹±•¹Ñ €ü€‹–>[šÚ#–£¦$ˆ€è€‹–£¦$‰ôğ½‰ÕÑÑ½¸øñÍÁ…¸û–ŞË¦$íÍ•±•Ñ•‘A•½Á±”¹±•¹Ñ¡ôƒ’ö4ğ½ÍÁ…¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰‰Õ±¬µÉ•µ½Ù”ˆ½¹±¥¬õíÉ•µ½Ù•M•±•Ñ•‘A•½Á±•ôûï¦f“š&¦$ğ½‰ÕÑÑ½¸øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰Á•½Á±”µ±¥ÍĞˆùíÁ•½Á±”¹µ…À¡Á•ÉÍ½¸€ôø€ñ±…‰•°±…ÍÍ9…µ”õíÁ•½Á±”µ¥Ñ•´€‘íÍ•±•Ñ•‘A•½Á±”¹¥¹±Õ‘•Ì¡Á•ÉÍ½¸¤€ü€‰Í•±•Ñ•ˆ€è€ˆ‰õô­•äõíÁ•ÉÍ½¹ôøñ¥¹ÁÕĞÑåÁ”ô‰¡•­‰½àˆ¡•­•õíÍ•±•Ñ•‘A•½Á±”¹¥¹±Õ‘•Ì¡Á•ÉÍ½¸¥ô½¹¡…¹”õì ¤€ôøÍ•ÑM•±•Ñ•‘A•½Á±”¡Í•±•Ñ•‘A•½Á±”¹¥¹±Õ‘•Ì¡Á•ÉÍ½¸¤€üÍ•±•Ñ•‘A•½Á±”¹™¥±Ñ•È¡¹…µ”€ôø¹…µ”€„ôôÁ•ÉÍ½¸¤€èl¸¸¹Í•±•Ñ•‘A•½Á±”°Á•ÉÍ½¹t¥ô€¼øñÍÁ…¸±…ÍÍ9…µ”ô‰Á•ÉÍ½¸µ…Ù…Ñ…ÈˆùíÁ•ÉÍ½¸¹Í±¥” ´Ä¥ôğ½ÍÁ…¸øñ‘¥ØøñˆùíÁ•ÉÍ½¹ôğ½ˆøñÍµ…±°ùíÑ…Í­Ì¹™¥±Ñ•È¡Ñ…Í¬€ôøÑ…Í¬¹Á•ÉÍ½¸€ôôôÁ•ÉÍ½¸¤¹±•¹Ñ¡ôƒšv‡š.7šF–º'š:Hğ½Íµ…±°øğ½‘¥Øøğ½±…‰•°ø¥ôğ½‘¥Øøñ™½É´±…ÍÍ9…µ”ô‰…‘µÁ•ÉÍ½¸µ™½É´ˆ½¹MÕ‰µ¥Ğõí…‘‘A•ÉÍ½¹ôøñ¥¹ÁÕĞ¹…µ”ô‰¹…µ”ˆÁ±…•¡½±‘•Èô‹¢úO–—–’k’â«–O–B7¾ò3R£¦_–>ßš"[¦ëš‚ó–"¦jPˆÉ•ÅÕ¥É•€¼øñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰ÁÉ¥µ…Éäµ‰Ñ¸ˆû¾ò,ƒš&ç¦?šŞï–*€ğ½‰ÕÑÑ½¸øğ½™½É´øğ½‘¥Øøğ½‘¥Øùô((€í½Áå5½‘…°€˜˜€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°µ‰…­‘É½Àˆ½¹5½ÕÍ•½İ¸õí•Ù•¹Ğ€ôø•Ù•¹Ğ¹Ñ…É•Ğ€ôôô•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ€˜˜Í•Ñ½Áå5½‘…°¡™…±Í”¥ôøñ™½É´±…ÍÍ9…µ”ô‰µ½‘…°½Áäµµ½‘…°ˆ½¹MÕ‰µ¥Ğõí…‘‘½Áåôøñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°µÑ¥Ñ±”ˆøñ‘¥ØøñÀ±…ÍÍ9…µ”ô‰•å•‰É½Üˆù9\=Adğ½Àøñ ÈûšRÛ¦n’âšv‡šZš† ğ½ Èøğ½‘¥Øøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰±½Í”ˆ½¹±¥¬õì ¤€ôøÍ•Ñ½Áå5½‘…°¡™…±Í”¥ôû\ğ½‰ÕÑÑ½¸øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™½É´µÉ¥ˆøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±™Õ±°ˆøñ±…‰•°ûš‚¦Š`ğ½±…‰•°øñ¥¹ÁÕĞ¹…µ”ô‰Ñ¥Ñ±”ˆÁ±…•¡½±‘•Èô‹îg×š¢Öß’â«–B7–¶\ˆÉ•ÅÕ¥É•€¼øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±™Õ±°ˆøñ±…‰•°ûšZš†#š¶šZğ½±…‰•°øñÑ•áÑ…É•„¹…µ”ô‰½¹Ñ•¹ĞˆÉ½İÌõìÙôÁ±…•¡½±‘•Èô‹Êc¢ÒÓš"[–g’â/šZš†#––ºçŠ›Š˜ˆÉ•ÅÕ¥É•€¼øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰™¥•±™Õ±°ˆøñ±…‰•°û¢¾w¦Šcš‚¶øğ½±…‰•°øñ¥¹ÁÕĞ¹…µ”ô‰Ñ…ÌˆÁ±…•¡½±‘•Èôˆš.7šFš^—–âà€¢¦ŠG–"o’öpˆ€¼øğ½‘¥Øøğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°µ…Ñ¥½¹Ìˆøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰…¹•°µ‰Ñ¸ˆ½¹±¥¬õì ¤€ôøÍ•Ñ½Áå5½‘…°¡™…±Í”¥ôû–>[šÚ ğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰ÁÉ¥µ…Éäµ‰Ñ¸ˆû’şw–¶cšZš† ğ½‰ÕÑÑ½¸øğ½‘¥Øøğ½™½É´øğ½‘¥Øùô(€íÑ½…ÍĞ€˜˜€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ½…ÍĞˆÉ½±”ô‰ÍÑ…ÑÕÌˆùíÑ½…ÍÑôğ½‘¥Øùô(€íÑ½Õ¡É…œü¹…Ñ¥Ù”€˜˜€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ½Õ µ‘É…œµ¡½ÍĞˆÍÑå±”õíì±•™ĞèÑ½Õ¡É…œ¹à°Ñ½ÀèÑ½Õ¡É…œ¹äõôùíÑ…Í­Ì¹™¥¹¡Ñ…Í¬€ôøÑ…Í¬¹¥€ôôôÑ½Õ¡É…œ¹Ñ…Í­%¤ü¹Ñ¥Ñ±•ôñÍµ…±°ûš.[–"Ãn»š‚’ö7ö¸ğ½Íµ…±°øğ½‘¥Øùô(€€ğ½µ…¥¸øì)ô(