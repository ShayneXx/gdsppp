import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(command, ["run", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    NEXT_PUBLIC_MEDIA_UPLOAD: "enabled",
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      "https://fropaeviwmickchppejx.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      "sb_publishable_AKN1cBbb3xJG-Evw83x1AA_Zor_GXia",
  },
});

if (result.status === 0) {
  const generatedConfigPath = fileURLToPath(
    new URL("../dist/server/wrangler.json", import.meta.url),
  );

  if (existsSync(generatedConfigPath)) {
    const generatedConfig = JSON.parse(readFileSync(generatedConfigPath, "utf8"));
    generatedConfig.r2_buckets = [
      ...new Map(
        (generatedConfig.r2_buckets ?? []).map((bucket) => [bucket.binding, bucket]),
      ).values(),
    ];
    generatedConfig.compatibility_flags = [
      ...new Set(generatedConfig.compatibility_flags ?? []),
    ];
    writeFileSync(generatedConfigPath, JSON.stringify(generatedConfig));
  }
}

process.exit(result.status ?? 1);
