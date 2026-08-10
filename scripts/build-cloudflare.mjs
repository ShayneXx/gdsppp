import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(command, ["run", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    CLOUDFLARE_NO_R2: "1",
    NEXT_PUBLIC_MEDIA_UPLOAD: "disabled",
  },
});

process.exit(result.status ?? 1);
