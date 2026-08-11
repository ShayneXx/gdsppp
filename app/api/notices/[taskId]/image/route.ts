import { env } from "cloudflare:workers";

type RouteContext = { params: Promise<{ taskId: string }> };
type ImageBucket = {
  get(key: string): Promise<{ body: ReadableStream; size: number; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } | null>;
  head(key: string): Promise<{ size: number; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } | null>;
  put(key: string, value: ReadableStream, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  delete(key: string): Promise<void>;
};

function bucket() {
  const images = (env as unknown as { VIDEOS?: ImageBucket }).VIDEOS;
  if (!images) throw new Error("Image storage is unavailable");
  return images;
}

function imageKind(request: Request) {
  return new URL(request.url).searchParams.get("kind") === "makeup" ? "makeup" : "clothing";
}
const key = (taskId: string, request: Request) => `notice-images/${encodeURIComponent(taskId)}/${imageKind(request)}`;
const headers = (object: { size: number; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) => ({
  "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
  "Content-Length": String(object.size),
  "X-Image-Name": encodeURIComponent(object.customMetadata?.name ?? "image"),
  "Cache-Control": "private, max-age=60",
});

export async function HEAD(request: Request, context: RouteContext) {
  const { taskId } = await context.params; const object = await bucket().head(key(taskId, request));
  return object ? new Response(null, { headers: headers(object) }) : new Response(null, { status: 404 });
}

export async function GET(request: Request, context: RouteContext) {
  const { taskId } = await context.params; const object = await bucket().get(key(taskId, request));
  return object ? new Response(object.body, { headers: headers(object) }) : new Response("Not found", { status: 404 });
}

export async function PUT(request: Request, context: RouteContext) {
  const { taskId } = await context.params; const contentType = request.headers.get("content-type") ?? "application/octet-stream";
  if (!contentType.startsWith("image/")) return Response.json({ error: "请选择图片文件" }, { status: 415 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 15 * 1024 * 1024) return Response.json({ error: "图片不能超过 15MB" }, { status: 413 });
  if (!request.body) return Response.json({ error: "图片内容为空" }, { status: 400 });
  const name = decodeURIComponent(request.headers.get("x-image-name") ?? "image");
  await bucket().put(key(taskId, request), request.body, { httpMetadata: { contentType }, customMetadata: { name } });
  return Response.json({ ok: true, name });
}

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  try {
    const { sourceUrl, name } = await request.json() as { sourceUrl?: string; name?: string };
    if (!sourceUrl) return Response.json({ error: "缺少图片地址" }, { status: 400 });
    const remoteUrl = new URL(sourceUrl);
    if (remoteUrl.protocol !== "https:" || remoteUrl.hostname !== "upload.wikimedia.org") return Response.json({ error: "不支持该图片来源" }, { status: 400 });
    const remote = await fetch(remoteUrl, { headers: { "User-Agent": "GaodianVideoPaipai/1.0 (notice reference import)" } });
    if (!remote.ok || !remote.body) throw new Error("remote unavailable");
    const contentType = remote.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return Response.json({ error: "图片格式不受支持" }, { status: 415 });
    const length = Number(remote.headers.get("content-length") ?? 0);
    if (length > 15 * 1024 * 1024) return Response.json({ error: "图片不能超过 15MB" }, { status: 413 });
    await bucket().put(key(taskId, request), remote.body, { httpMetadata: { contentType }, customMetadata: { name: (name || "灵感参考图").slice(0, 160) } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "参考图片下载失败，请更换图片" }, { status: 502 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { taskId } = await context.params; await bucket().delete(key(taskId, request));
  return Response.json({ ok: true });
}
