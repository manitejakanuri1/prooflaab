// LOCAL TEST ONLY: the normal dev server, plus /api proxied to the local BFF stack
// (scripts/dev-tools/harness/bff_local_stack.ts), so dev-only harness pages get real cookie sessions.
//   npx vite --mode staging --config scripts/dev-tools/harness/vite.local-bff.config.ts --port 5199 --strictPort
import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from "vite";
import base from "../../../vite.config";

export default defineConfig((env: ConfigEnv) =>
  mergeConfig(
    (typeof base === "function" ? base(env) : base) as UserConfig,
    { server: { proxy: { "/api": { target: process.env.LOCAL_BFF ?? "http://127.0.0.1:5197", changeOrigin: false } } } },
  ));
