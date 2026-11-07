// Runs a command with the repo-root `.env` loaded into its environment (if the file exists).
// The ASP.NET Core API and its tests don't read `.env` themselves; this lets every secret
// (database connection strings, etc.) live in one git-ignored file instead of in code.
//
//   node scripts/with-env.mjs dotnet test api/AvatarForge.sln
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/with-env.mjs <command> [...args]");
  process.exit(2);
}

const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
