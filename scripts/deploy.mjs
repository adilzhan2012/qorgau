/**
 * Собирает статический сайт и публикует его на GitHub Pages.
 *
 *   npm run deploy
 *
 * Публикация идёт в ветку `gh-pages`, а не через GitHub Actions: workflow-файл
 * можно создать только токеном с правом `workflow`, а обычный токен, которым
 * работает git, его отклоняет. Ветка обходит это ограничение и не требует
 * никаких новых разрешений.
 *
 * Один раз нужно включить Pages:
 *   Settings → Pages → Source: Deploy from a branch → gh-pages → / (root)
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out");
const BRANCH = "gh-pages";
const BASE_PATH = "/qorgau";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: options.quiet ? "pipe" : "inherit",
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });
}

const remote = run("git", ["remote", "get-url", "origin"], { quiet: true }).trim();
if (!remote) {
  console.error("Не найден remote origin. Настройте его: git remote add origin <url>");
  process.exit(1);
}

console.log("1/3  Собираю сайт...");
rmSync(OUT, { recursive: true, force: true });
run("npm", ["run", "build"], {
  cwd: ROOT,
  // Задаём здесь, а не в командной строке: Git Bash на Windows превращает
  // "/qorgau" в путь вида "C:/Program Files/Git/qorgau".
  env: { ...process.env, NEXT_PUBLIC_BASE_PATH: BASE_PATH },
});

console.log("\n2/3  Готовлю ветку " + BRANCH + "...");
const staging = mkdtempSync(path.join(tmpdir(), "qorgau-pages-"));
try {
  cpSync(OUT, staging, { recursive: true });
  // Без этого Pages прячет папку _next: имена, начинающиеся с подчёркивания,
  // Jekyll считает служебными.
  writeFileSync(path.join(staging, ".nojekyll"), "");

  const git = (...args) => run("git", args, { cwd: staging, quiet: true });
  git("init", "-q", "-b", BRANCH);
  git("add", "-A");
  git("-c", "user.name=qorgau-deploy", "-c", "user.email=deploy@localhost",
      "commit", "-q", "-m", "Сборка сайта " + new Date().toISOString());

  console.log("3/3  Публикую...");
  run("git", ["push", "-q", "--force", remote, `${BRANCH}:${BRANCH}`], { cwd: staging });

  const [, owner, repo] = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)/) ?? [];
  console.log(
    owner && repo
      ? `\nГотово: https://${owner}.github.io/${repo}/`
      : "\nГотово.",
  );
  console.log(
    "Если открывается 404 — включите Pages один раз:\n" +
      "  Settings → Pages → Source: Deploy from a branch → gh-pages → / (root)",
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
