import { env } from "cloudflare:workers";

type RouteContext = { params: Promise<{ taskId: string }> };
type VideoBucket = {
  get(key: string): Promise<{ body: ReadableStream; size: number; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } | null>;
  head(key: string): Promise<{ size: number; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } | null>;
  put(key: string, value: ReadableStream | ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  delete(key: string): Promise<void>;
};

function bucket() {
  const videos = (env as unknown as { VIDEOS?: VideoBucket }).VIDEOS;
  if (!videos) throw new Error("Video storage is unavailable");
  return videos;
}

function key(taskId: string) {
  return `notice-videos/${encodeURIComponent(taskId)}`;
}

function headers(object: { size: number; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) {
  return {
    "Content-Type": object.httpMetadata?.contentType ?? "video/mp4",
    "Content-Length": String(object.size),
    "X-Video-Name": encodeURIComponent(object.customMetadata?.name ?? "video"),
    "Cache-Control": "private, max-age=60",
  };
}

export async function HEAD(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const object = await bucket().head(key(taskId));
  return object ? new Response(null, { headers: headers(object) }) : new Response(null, { status: 404 });
}

export async function GET(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const object = await bucket().get(key(taskId));
  return object ? new Response(object.body, { headers: headers(object) }) : new Response("Not found", { status: 404 });
}

export async function PUT(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const contentType = request.headers.get("content-type") ?? "application/octet-stream";
  if (!contentType.startsWith("video/")) return Response.json({ error: "请选择视频文件" }, { status: 415 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 200 * 1024 * 1024) return Response.json({ error: "视频不能超过 200MB" }, { status: 413 });
  const name = decodeURIComponent(request.headers.get("x-video-name") ?? "video");
  if (!request.body) return Response.json({ error: "视频内容为空" }, { status: 400 });
  await bucket().put(key(taskId), request.body, { httpMetadata: { contentType }, customMetadata: { name } });
  return Response.json({ ok: true, name });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  await bucket().delete(key(taskId));
  return Response.json({ ok: true });
}
