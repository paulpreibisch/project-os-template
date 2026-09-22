import express from "express";
import cron from "node-cron";
import { fileURLToPath } from "url";
import { dirname, extname, join, normalize } from "path";
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, renameSync, rmSync, appendFileSync } from "fs";
import { spawn } from "child_process";
import { randomUUID, timingSafeEqual } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROJECTS = join(ROOT, "projects");
const WEB_DIST = join(ROOT, "web", "dist");
const UPDATER = join(ROOT, "updater", "refresh.mjs");
const PORT = process.env.PORT || 4317;

// --- Logging + exit forensics ---
// The server has died silently mid-refresh with nothing usable in the logs, so
// it now owns its own log file: timestamped UTF-8 lines, plus a recorded reason
// for every way the process can go away. A line that just stops with no [exit]
// after it means the process was hard-terminated from outside.
//
// Lives under projects/ rather than at ROOT so the container can run with a
// read-only root filesystem: projects/ is the one bind-mounted, writable
// volume (see Dockerfile/docker-compose.yml), everything else is baked into
// the image and never touched at runtime.
if (!existsSync(join(PROJECTS, ".logs"))) mkdirSync(join(PROJECTS, ".logs"), { recursive: true });
const LOG_FILE = join(PROJECTS, ".logs", "server.log");
// Local wall-clock, so log lines line up with the cron schedule and with when
// you actually saw the board go down.
const stamp = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().replace("T", " ").slice(0, 19);
function tee(stream, tag) {
  const orig = stream.write.bind(stream);
  let partial = "";
  const flush = () => { if (partial) { try { appendFileSync(LOG_FILE, `${stamp()} ${tag} ${partial}\n`); } catch {} partial = ""; } };
  stream.write = (chunk, enc, cb) => {
    try {
      const lines = (partial + String(chunk)).split("\n");
      partial = lines.pop();
      if (lines.length) appendFileSync(LOG_FILE, lines.map((l) => `${stamp()} ${tag} ${l.replace(/\r$/, "")}\n`).join(""));
    } catch { /* logging must never break the server */ }
    return orig(chunk, enc, cb);
  };
  return flush;
}
const flushOut = tee(process.stdout, "INFO");
const flushErr = tee(process.stderr, "ERR ");

// Keep serving after an uncaught error: a dashboard that stays up with one bad
// request logged beats a board that vanishes. The stack lands in the log either way.
process.on("uncaughtException", (err) => console.error(`[fatal] uncaughtException: ${err?.stack || err}`));
process.on("unhandledRejection", (r) => console.error(`[fatal] unhandledRejection: ${r?.stack || r}`));
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"])
  process.on(sig, () => { console.error(`[exit] received ${sig}`); process.exit(0); });
process.on("exit", (code) => { console.error(`[exit] process exiting, code=${code}`); flushOut(); flushErr(); });

const app = express();

// Unauthenticated on purpose, ahead of the access-control gate below: Docker's
// healthcheck (see docker-compose.yml) needs to confirm the process is alive
// without a credential. Reveals only that the server is up — no project
// slugs, no data. /api/health (below the gate) still needs auth for that.
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// --- Security headers ---------------------------------------------------
// Sent on every response below (so /login and every API route carry them).
// The CSP ships REPORT-ONLY on purpose: it does not block anything yet, it
// only posts violations to /csp-report so you can see what the real SPA needs
// before switching the header to enforcing. 'unsafe-inline' stays in style-src
// because the Vite/Chakra build injects inline styles; script-src is 'self'
// plus Cloudflare's challenge host for the (optional) Turnstile widget on the
// login page. frame-ancestors 'none' + X-Frame-Options block clickjacking.
//
// NOTE before enforcing: the whiteboard /raw endpoint serves whole hand-authored
// documents (which may carry inline <script> for charts) — give that route its
// own relaxed policy, or exempt it, before flipping this to Content-Security-Policy.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' https://challenges.cloudflare.com",
  "frame-src 'self' https://challenges.cloudflare.com",
  "connect-src 'self'",
  "font-src 'self' data:",
  "report-uri /csp-report",
].join("; ");
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  // HSTS only over TLS (behind a reverse proxy req.protocol is http, so key off
  // the forwarded proto). Harmless on plain-http local use, where the header is
  // simply omitted.
  if (req.secure || req.headers["x-forwarded-proto"] === "https")
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Content-Security-Policy-Report-Only", CSP_REPORT_ONLY);
  next();
});

// CSP violation sink for the report-only phase. Exempt from auth (defined above
// the gate, like /healthz) so the login page can post reports too. Logs a
// trimmed line and drops it — never trusts or stores the body.
app.post("/csp-report",
  express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "64kb" }),
  (req, res) => {
    const r = req.body?.["csp-report"] || req.body || {};
    console.log(`[csp] ${JSON.stringify(r).slice(0, 400)}`);
    res.status(204).end();
  });

// --- Access control -----------------------------------------------------
// The board serves journals, contacts and a whiteboard with no login, and
// `app.listen(PORT)` binds every interface — so before this it was readable by
// anything that could route here.
//
// Every request needs the password in `.os-auth` (gitignored, never printed) —
// including loopback. A previous version exempted loopback for local tooling,
// but this server can also be reached through a reverse proxy (a Cloudflare
// Tunnel, an nginx proxy) that itself connects in over localhost — from Express's
// point of view that's indistinguishable from a trusted local user, so a
// loopback exemption silently disables auth for anyone the proxy forwards.
//
// Two credential paths, for two kinds of caller:
//   - A browser gets a real login PAGE (/login) that sets an HttpOnly session
//     cookie. Basic Auth's native browser popup is unstyled, can't be logged
//     out of, and reprompts per-tab — a form + cookie is what a person expects.
//   - Everything else (osctl.mjs, curl, scripts) sends Basic Auth in the
//     Authorization header, same as before. It fails with a plain 401 and no
//     WWW-Authenticate header — that header is specifically what triggers a
//     browser's native popup, and omitting it is what makes /login the only
//     thing a browser ever shows.
//
// Checked at ROOT first (unchanged for local/Windows use), then under the
// writable projects/ volume — the only place a container with a read-only
// root filesystem can have a bind-mounted file land.
const AUTH_FILE = [join(__dirname, "..", ".os-auth"), join(PROJECTS, ".os-auth")].find(existsSync);
const AUTH_PASS = AUTH_FILE ? readFileSync(AUTH_FILE, "utf8").trim() : "";
const AUTH_USER = process.env.OS_AUTH_USER || "admin";

const SESSION_COOKIE = "os_session";
const SESSION_MS = 30 * 24 * 3600 * 1000; // 30 days
// token -> expiresAt. In-memory on purpose: one operator, one password: a
// restart forcing a fresh login is a fair trade for not needing a session store.
const SESSIONS = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of SESSIONS) if (exp < now) SESSIONS.delete(t);
}, 3600000).unref();

// Real client IP, not a reverse proxy's: with host networking, a tunnel/proxy
// often connects to this app over localhost, so req.socket.remoteAddress is
// 127.0.0.1 for every visitor — useless for per-attacker tracking. Cloudflare
// (if used) adds the real one in cf-connecting-ip on every request it proxies.
const clientIp = (req) => req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";

// Login rate limiting: 5 wrong passwords from one IP starts an exponentially
// growing lockout (30s, 1m, 2m, ... capped at 30m) rather than a hard ban —
// a mistyped password shouldn't lock someone out for half an hour, but a
// script trying thousands of guesses hits a wall fast either way.
const LOGIN_ATTEMPTS = new Map(); // ip -> { fails, lockedUntil }
const LOCK_AFTER = 5;
const LOCK_BASE_MS = 30000;
const LOCK_MAX_MS = 30 * 60000;
function loginLockStatus(ip) {
  const a = LOGIN_ATTEMPTS.get(ip);
  if (!a) return { locked: false };
  if (a.lockedUntil && a.lockedUntil > Date.now()) return { locked: true, retryAfterSec: Math.ceil((a.lockedUntil - Date.now()) / 1000) };
  return { locked: false };
}
function recordLoginFailure(ip) {
  const a = LOGIN_ATTEMPTS.get(ip) || { fails: 0, lockedUntil: 0 };
  a.fails += 1;
  if (a.fails >= LOCK_AFTER) {
    const ms = Math.min(LOCK_BASE_MS * 2 ** (a.fails - LOCK_AFTER), LOCK_MAX_MS);
    a.lockedUntil = Date.now() + ms;
  }
  LOGIN_ATTEMPTS.set(ip, a);
}
const clearLoginFailures = (ip) => LOGIN_ATTEMPTS.delete(ip);
setInterval(() => {
  const now = Date.now();
  for (const [ip, a] of LOGIN_ATTEMPTS) if (!a.lockedUntil || a.lockedUntil < now - 3600000) LOGIN_ATTEMPTS.delete(ip);
}, 3600000).unref();

// Cloudflare Turnstile: optional. Set both env vars to turn it on — the form
// and server-side verification both no-op cleanly when they're unset, so a
// deployment without a Turnstile site configured just runs on rate-limiting
// alone instead of failing to serve the login page at all.
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || "";
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || "";
async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET_KEY) return true; // not configured: nothing to check
  if (!token) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    return !!(await r.json())?.success;
  } catch {
    return false; // Turnstile unreachable: fail closed, same spirit as the missing-password 403 below
  }
}

const isHttps = (req) => req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function checkPassword(pass) {
  return !!AUTH_PASS && pass.length === AUTH_PASS.length && timingSafeEqual(Buffer.from(pass), Buffer.from(AUTH_PASS));
}
function setSessionCookie(req, res, token) {
  const parts = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(SESSION_MS / 1000)}`];
  if (isHttps(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

const LOGIN_PAGE = (next = "/", { error = false, locked = false, retryAfterSec = 0 } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project OS — sign in</title>
${TURNSTILE_SITE_KEY ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ""}
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0f0d0d; color:#f0e8e0; font:16px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  form { width:300px; padding:32px 28px; background:#17130f; border:1px solid #332b26; border-radius:14px; }
  h1 { font-family:"Playfair Display",Georgia,serif; font-size:1.4rem; margin:0 0 18px; color:#fff; font-style:italic; }
  input { width:100%; box-sizing:border-box; padding:10px 12px; margin:0 0 14px; border-radius:8px;
          border:1px solid #332b26; background:#0c0a08; color:#f0e8e0; font-size:15px; }
  input:focus { outline:none; border-color:#e0a830; }
  input:disabled { opacity:0.5; }
  button { width:100%; padding:10px 12px; border-radius:8px; border:0; background:#e0a830; color:#1a1310;
           font-weight:600; font-size:15px; cursor:pointer; }
  button:hover { background:#eab84a; }
  button:disabled { background:#5a4a2e; color:#8a7860; cursor:not-allowed; }
  .err { color:#e07070; font-size:13px; margin:-6px 0 14px; }
  .cf-turnstile { margin:0 0 14px; }
</style></head><body>
<form method="post" action="/login?next=${encodeURIComponent(next)}">
  <h1>Project OS</h1>
  ${error ? '<div class="err">Wrong password.</div>' : ""}
  ${locked ? `<div class="err">Too many attempts — try again in ${retryAfterSec}s.</div>` : ""}
  <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" ${locked ? "disabled" : ""}>
  ${TURNSTILE_SITE_KEY ? `<div class="cf-turnstile" data-sitekey="${TURNSTILE_SITE_KEY}"></div>` : ""}
  <button type="submit" ${locked ? "disabled" : ""}>Sign in</button>
</form></body></html>`;

app.get("/login", (req, res) => {
  const { locked, retryAfterSec } = loginLockStatus(clientIp(req));
  res.type("html").send(LOGIN_PAGE(String(req.query.next || "/"), { locked, retryAfterSec }));
});
app.post("/login", express.urlencoded({ extended: false }), async (req, res) => {
  const next = String(req.query.next || "/");
  const ip = clientIp(req);

  const lock = loginLockStatus(ip);
  if (lock.locked) {
    return res.status(429).type("html").send(LOGIN_PAGE(next, { locked: true, retryAfterSec: lock.retryAfterSec }));
  }

  const turnstileOk = await verifyTurnstile(req.body?.["cf-turnstile-response"], ip);
  const submitted = String(req.body?.password || "");
  const passOk = checkPassword(submitted);
  if (!turnstileOk || !passOk) {
    // Lengths only — never the values — so a failed attempt is diagnosable
    // (trailing whitespace from a copy-paste, wrong board, autofill) without
    // ever putting a password anywhere near a log file.
    console.log(`[login] fail ip=${ip} turnstileOk=${turnstileOk} passOk=${passOk} submittedLen=${submitted.length}`);
    recordLoginFailure(ip);
    const relock = loginLockStatus(ip);
    return res.status(401).type("html").send(LOGIN_PAGE(next, relock.locked ? { locked: true, retryAfterSec: relock.retryAfterSec } : { error: true }));
  }

  clearLoginFailures(ip);
  const token = randomUUID() + randomUUID();
  SESSIONS.set(token, Date.now() + SESSION_MS);
  setSessionCookie(req, res, token);
  // Only a same-site absolute path is a safe redirect target. A bare
  // `.startsWith("/")` also passes `//evil.com` and `/\evil.com`, which browsers
  // treat as protocol-relative/host redirects — an open redirect that hands an
  // authenticated visitor straight to an attacker's site. Require "/" followed by
  // a non-slash, non-backslash char; everything else falls back to the board root.
  res.redirect(/^\/[^/\\]/.test(next) ? next : "/");
});
function logout(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) SESSIONS.delete(token);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0`);
  res.redirect("/login");
}
// GET too, not just POST: the header menu's "Log out" item is a plain link —
// simplest thing that works for a single-operator board with no CSRF-relevant
// state to protect beyond the session itself, which this action is destroying.
app.get("/logout", logout);
app.post("/logout", logout);

app.use((req, res, next) => {
  if (req.path === "/login" || req.path === "/logout") return next();
  if (!AUTH_PASS) {
    res.status(403).type("text/plain");
    return res.end("Project OS: no .os-auth password is set on the server.");
  }
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) {
    const exp = SESSIONS.get(token);
    if (exp && exp > Date.now()) return next();
  }
  const hdr = req.headers.authorization || "";
  if (hdr.startsWith("Basic ")) {
    // Rate-limit this path too, not just POST /login: a caller can brute-force
    // the password straight through the Authorization header, and without this
    // it's the one credential check with no lockout. Only a PRESENT-but-wrong
    // header counts as a failure, so ordinary cookie-less page loads never trip
    // it, and a correct osctl request clears the counter each time.
    const ip = clientIp(req);
    const lock = loginLockStatus(ip);
    if (lock.locked) return res.status(429).json({ error: "too many attempts", retryAfterSec: lock.retryAfterSec });
    const [user, ...rest] = Buffer.from(hdr.slice(6), "base64").toString("utf8").split(":");
    if (user === AUTH_USER && checkPassword(rest.join(":"))) { clearLoginFailures(ip); return next(); }
    recordLoginFailure(ip);
  }
  const isPageLoad = req.method === "GET" && (req.headers.accept || "").includes("text/html");
  if (isPageLoad) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  res.status(401).json({ error: "Authentication required" });
});

app.use(express.json({ limit: "2mb" }));

// --- Project (tenant) resolution ---
const validSlug = (s) => /^[a-z0-9-]+$/.test(s || "") && existsSync(join(PROJECTS, s, "config.json"));

function proj(slug) {
  if (!validSlug(slug)) return null;
  const dir = join(PROJECTS, slug);
  return {
    slug,
    dir,
    cfgPath: join(dir, "config.json"),
    DATA: join(dir, "data", "marketing.json"),
    STATE: join(dir, "data", "state.json"),
    WB: join(dir, "data", "whiteboard.json"),
    // Its own file, not a key in marketing.json. The AI updater rewrites that
    // file wholesale on every run, and a compiled contact list should not sit
    // anywhere a language model is asked to regenerate.
    LIST: join(dir, "data", "contact-list.json"),
    // Drafted prose a human wrote and will send verbatim. Its own file because
    // marketing.json is rewritten wholesale by the AI updater, and a draft that
    // gets silently reworded between reading it and sending it is worse than
    // no draft at all.
    DRAFTS: join(dir, "data", "drafts.json"),
    PUBLIC: join(dir, "public"),
    get config() { return JSON.parse(readFileSync(this.cfgPath, "utf-8")); },
  };
}

function listProjects() {
  if (!existsSync(PROJECTS)) return [];
  return readdirSync(PROJECTS)
    .filter((s) => validSlug(s))
    .map((slug) => {
      const c = JSON.parse(readFileSync(join(PROJECTS, slug, "config.json"), "utf-8"));
      return { slug, name: c.brand?.name || slug, subtitle: c.brand?.subtitle || "" };
    });
}

// Middleware: attach resolved project or 404
function withProject(req, res, next) {
  const p = proj(req.params.project);
  if (!p) return res.status(404).json({ error: "unknown project" });
  req.proj = p;
  next();
}

// --- Global API ---
app.get("/api/health", (_req, res) => res.json({ ok: true, projects: listProjects().map((p) => p.slug), ts: new Date().toISOString() }));
app.get("/api/projects", (_req, res) => res.json(listProjects()));

// --- Per-project static assets:  /pub/:project/<path> ---
app.get("/pub/:project/*", (req, res) => {
  const p = proj(req.params.project);
  if (!p) return res.status(404).end();
  const filePath = normalize(join(p.PUBLIC, req.params[0]));
  if (!filePath.startsWith(p.PUBLIC)) return res.status(400).end(); // traversal guard
  res.sendFile(filePath, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

// --- Per-project config / data ---
app.get("/api/p/:project/config", withProject, (req, res) => {
  try { res.type("application/json").send(readFileSync(req.proj.cfgPath, "utf-8")); }
  catch (e) { res.status(500).json({ error: "config read failed", detail: String(e) }); }
});
// Hand-authored blocks that must survive an AI refresh live in their own files
// beside marketing.json — the updater rewrites marketing.json wholesale, so
// anything a human wrote and expects to still be there tomorrow cannot live in
// it. They are overlaid here so the client still sees one object.
const OVERLAY_FILES = ["contacts.json"];

function readDataWithOverlays(p) {
  const base = JSON.parse(readFileSync(p.DATA, "utf-8"));
  for (const name of OVERLAY_FILES) {
    const f = join(p.dir, "data", name);
    if (!existsSync(f)) continue;
    try {
      const extra = JSON.parse(readFileSync(f, "utf-8"));
      // Overlay wins: a stale key left in marketing.json must not shadow the
      // file that is now the source of truth for it.
      Object.assign(base, extra);
    } catch (e) {
      console.error(`[data] ${p.slug}: ignoring unreadable ${name} — ${e.message}`);
    }
  }
  return base;
}

app.get("/api/p/:project/data", withProject, (req, res) => {
  try {
    res.json(readDataWithOverlays(req.proj));
  } catch (e) {
    res.status(500).json({ error: "data read failed", detail: String(e) });
  }
});

// --- Per-project AI updater ---
const refreshing = new Map(); // slug -> bool
const lastRefresh = new Map(); // slug -> {at,code,source}

// --- Live progress (Server-Sent Events) ---
const sseClients = new Map(); // slug -> Set(res)
const logBuffers = new Map(); // slug -> [lines]  (last run, for late subscribers)

function sseSend(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
}
function broadcast(slug, event, data) {
  const set = sseClients.get(slug);
  if (!set) return;
  for (const res of set) sseSend(res, event, data);
}
const NOISE = /^\s*$/i;
// Turn a raw "[refresh] ..." line into something friendlier.
function humanize(line) {
  return String(line)
    .replace(/\[[0-9;]*m/g, "") // strip ANSI colour codes
    .replace(/^\[refresh\]\s*/, "")
    .trim();
}

// One job at a time per project, whichever script it is — they share the SSE
// panel and (for the updater) the same marketing.json.
function runJob(slug, script, args, source) {
  const p = proj(slug);
  if (!p || !existsSync(script)) return false;
  if (refreshing.get(slug)) return false;
  refreshing.set(slug, true);
  logBuffers.set(slug, []);
  broadcast(slug, "start", { source, at: new Date().toISOString() });
  console.log(`[refresh] starting (${source}) project=${slug}`);

  const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, env: { ...process.env, PROJECT: slug } });
  let partial = "";
  const onChunk = (chunk, isErr) => {
    const s = partial + String(chunk);
    const lines = s.split("\n");
    partial = lines.pop(); // keep last incomplete fragment
    for (const raw of lines) {
      if (!raw.trim()) continue;
      (isErr ? process.stderr : process.stdout).write(raw + "\n");
      if (NOISE.test(raw)) continue; // keep tool chatter out of the live panel
      const line = humanize(raw);
      if (!line) continue;
      const buf = logBuffers.get(slug) || [];
      buf.push(line);
      broadcast(slug, "log", { line });
    }
  };
  child.stdout.on("data", (d) => onChunk(d, false));
  child.stderr.on("data", (d) => onChunk(d, true));
  // Without this, a failed spawn raises an unhandled 'error' event and takes the
  // whole server down with it.
  child.on("error", (err) => {
    console.error(`[refresh] spawn failed (${source}) project=${slug}: ${err?.message || err}`);
    refreshing.set(slug, false);
    broadcast(slug, "done", { code: -1, at: new Date().toISOString() });
  });
  child.on("close", (code, signal) => {
    if (signal) console.error(`[refresh] child killed by ${signal} project=${slug}`);
    if (partial.trim()) broadcast(slug, "log", { line: humanize(partial) });
    partial = "";
    refreshing.set(slug, false);
    lastRefresh.set(slug, { at: new Date().toISOString(), code, source });
    broadcast(slug, "done", { code, at: new Date().toISOString() });
    console.log(`[refresh] exited ${code} (${source}) project=${slug}`);
  });
  return true;
}

function runUpdater(slug, source) {
  const p = proj(slug);
  if (!p?.config.updater?.enabled) return false;
  return runJob(slug, UPDATER, [], source);
}

app.post("/api/p/:project/refresh", withProject, (req, res) => {
  const { slug, config } = req.proj;
  if (!config.updater?.enabled) return res.json({ ok: false, status: "updater disabled for this project" });
  if (refreshing.get(slug)) return res.json({ ok: false, status: "already running" });
  runUpdater(slug, "button");
  res.json({ ok: true, status: "refresh started — this can take up to a minute" });
});
app.get("/api/p/:project/status", withProject, (req, res) => {
  const { slug, config } = req.proj;
  res.json({ project: slug, updaterEnabled: !!config.updater?.enabled, refreshing: !!refreshing.get(slug), lastRefresh: lastRefresh.get(slug) || null });
});

// Live progress stream (SSE): the UI subscribes here to watch a refresh unfold.
app.get("/api/p/:project/refresh/stream", withProject, (req, res) => {
  const { slug } = req.proj;
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  if (!sseClients.has(slug)) sseClients.set(slug, new Set());
  sseClients.get(slug).add(res);

  // Prime the new subscriber with current state + the last run's lines.
  sseSend(res, "hello", { refreshing: !!refreshing.get(slug) });
  for (const line of (logBuffers.get(slug) || []).slice(-60)) sseSend(res, "log", { line });

  const keepAlive = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 20000);
  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.get(slug)?.delete(res);
  });
});

// --- Board settings (journal sources) ---
// Which Claude Code session folders feed this board's journal. Non-secret
// config only.
const settingsFile = (p) => join(p.dir, "data", "settings.json");
const readSettings = (p) => {
  try { return JSON.parse(readFileSync(settingsFile(p), "utf-8")); }
  catch { return {}; }
};

app.get("/api/p/:project/settings", withProject, (req, res) => {
  const p = req.proj;
  const config = p.config || {};
  const root = join(process.env.USERPROFILE || process.env.HOME, ".claude", "projects");
  let folders = [];
  try {
    folders = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch { /* no sessions dir on this machine */ }
  const s = readSettings(p);
  res.json({
    sessionFolders: folders,
    // config.json holds the original; settings.json can override it.
    sessionsDir: s.sessionsDir ?? config.updater?.sessionsDir ?? null,
    extraSessionDirs: s.extraSessionDirs || [],
    journalSources: { sessions: true, ...(s.journalSources || {}) },
  });
});

// Merge, don't replace — two tabs open must not wipe each other's choices.
app.patch("/api/p/:project/settings", withProject, (req, res) => {
  const p = req.proj;
  const prev = readSettings(p);
  const b = req.body || {};
  const next = { ...prev };
  if (typeof b.sessionsDir === "string" || b.sessionsDir === null) next.sessionsDir = b.sessionsDir;
  if (Array.isArray(b.extraSessionDirs)) next.extraSessionDirs = b.extraSessionDirs.filter((x) => typeof x === "string").slice(0, 20);
  if (b.journalSources && typeof b.journalSources === "object") {
    next.journalSources = { ...(prev.journalSources || {}) };
    if (typeof b.journalSources.sessions === "boolean") next.journalSources.sessions = b.journalSources.sessions;
  }
  writeFileSync(settingsFile(p), JSON.stringify(next, null, 2));
  res.json({ ok: true, settings: next });
});

// --- Per-project Whiteboard ---
const readWB = (p) => { try { return JSON.parse(readFileSync(p.WB, "utf-8")); } catch { return { items: [] }; } };
const writeWB = (p, d) => writeFileSync(p.WB, JSON.stringify(d, null, 2));

// --- Per-project contact list (compiled marketing list) ---
// Read-only over HTTP on purpose — this is meant to be rebuilt by your own
// compile script (from sign-in sheets, a payment provider, whatever sources you
// have), never edited by hand through the browser.
app.get("/api/p/:project/contact-list", withProject, (req, res) => {
  try {
    res.type("application/json").send(readFileSync(req.proj.LIST, "utf-8"));
  } catch {
    res.json({ title: "Contact List", note: "", people: [], stats: null });
  }
});

// --- Per-project Drafts (prose attached to a goal) ---
// Read-only on purpose. These are written by hand (or by a Claude session editing
// the file) and only ever *read* on the board, so there is no write endpoint and
// therefore no validation surface to get wrong. Add a merge-PATCH the day something
// on the page needs to edit one.
const DEFAULT_DRAFTS = { items: [], guidance: [], updatedAt: null };
const readDrafts = (p) => {
  try { return JSON.parse(readFileSync(p.DRAFTS, "utf-8")); }
  catch { return { ...DEFAULT_DRAFTS }; }
};
app.get("/api/p/:project/drafts", withProject, (req, res) => res.json(readDrafts(req.proj)));

app.get("/api/p/:project/whiteboard/:id/raw", withProject, (req, res) => {
  const item = readWB(req.proj).items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).type("text/plain").send("not found");
  const html = String(item.content || "");
  res.type("text/html").send(
    isFullDoc(html) ? html : SNIPPET_SHELL(item.title || "Untitled", html)
  );
});

// The standalone view of one whiteboard item — what the iframe loads, and what
// "Open ⧉" opens in a tab.
//
// A printable arrives as a complete document and is served untouched: its @page
// rules and print CSS are the entire point, and wrapping it would break them.
//
// A snippet is a fragment — it starts at <p> or <h3> — so served raw it lands as
// unstyled black-on-white with a 1200px measure, which is unreadable and looks
// broken rather than plain. It gets a minimal shell instead, carrying the board's
// own typography so a note opened in a tab reads exactly as it does in the app.
// Nothing here is loaded from the network: one <style> block, no fonts, no
// scripts, so the tab renders instantly and works offline.
const isFullDoc = (html) => /^\s*(<!doctype|<html)/i.test(html || "");

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const SNIPPET_SHELL = (title, body) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f0d0d; color: #f0e8e0;
         font: 16px/1.65 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  /* A measure, not a full-width wall of text — the app renders these in a column
     and a tab that does not would read as a different document. */
  main { max-width: 760px; margin: 0 auto; padding: 40px 24px 80px; }
  h1, h2, h3, h4 { font-family: "Playfair Display", Georgia, serif; color: #fff;
                   line-height: 1.2; margin: 1.6em 0 .5em; }
  h1 { font-size: 1.9rem } h2 { font-size: 1.4rem } h3 { font-size: 1.15rem }
  h1:first-child, h2:first-child, h3:first-child { margin-top: 0 }
  p, li { color: #9e8878 }
  a { color: #e0a830 }
  strong { color: #f0e8e0 }
  ul, ol { padding-left: 22px }
  li { margin: .3em 0 }
  code { background: rgba(255,255,255,.07); padding: 1px 5px; border-radius: 4px;
         font-size: .87em; color: #f0e8e0; }
  pre { background: rgba(255,255,255,.05); border: 1px solid #332b26; border-radius: 10px;
        padding: 14px 16px; overflow-x: auto; }
  pre code { background: none; padding: 0 }
  blockquote { border-left: 3px solid #e0a830; margin: 1em 0; padding-left: 14px }
  hr { border: 0; border-top: 1px solid #332b26; margin: 2em 0 }
  table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto }
  th, td { border-bottom: 1px solid #332b26; padding: 8px 10px; text-align: left }
  th { color: #9e8878; font-size: .8rem; text-transform: uppercase; letter-spacing: .1em }
  img { max-width: 100%; height: auto }
  header { border-bottom: 1px solid #332b26; padding-bottom: 14px; margin-bottom: 28px }
  header .t { font-family: "Playfair Display", Georgia, serif; font-size: 1.5rem; font-style: italic }
</style>
</head><body><main>
<header><div class="t">${escapeHtml(title)}</div></header>
${body}
</main></body></html>`;

app.get("/api/p/:project/whiteboard", withProject, (req, res) => res.json(readWB(req.proj)));
app.post("/api/p/:project/whiteboard", withProject, (req, res) => {
  const { title, content, language } = req.body || {};
  if (!content || !String(content).trim()) return res.status(400).json({ error: "content is required" });
  const wb = readWB(req.proj);
  const item = { id: randomUUID(), title: (title || "Untitled").toString().trim(), language: language || "html", created_at: new Date().toISOString(), content: String(content) };
  wb.items.unshift(item);
  writeWB(req.proj, wb);
  res.status(201).json(item);
});
// Update in place. Keeps the id, created_at and index position so open tabs,
// shared links and the /raw iframe URL all survive an edit — replacing an item
// by DELETE + POST would mint a new id and break every one of them.
app.put("/api/p/:project/whiteboard/:id", withProject, (req, res) => {
  const { title, content, language } = req.body || {};
  const wb = readWB(req.proj);
  const idx = wb.items.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  if (content !== undefined && !String(content).trim()) {
    return res.status(400).json({ error: "content cannot be empty" });
  }
  const prev = wb.items[idx];
  wb.items[idx] = {
    ...prev,
    ...(title !== undefined ? { title: String(title).trim() || prev.title } : {}),
    ...(content !== undefined ? { content: String(content) } : {}),
    ...(language !== undefined ? { language } : {}),
    updated_at: new Date().toISOString(),
  };
  writeWB(req.proj, wb);
  res.json(wb.items[idx]);
});
app.delete("/api/p/:project/whiteboard/:id", withProject, (req, res) => {
  const wb = readWB(req.proj);
  const before = wb.items.length;
  wb.items = wb.items.filter((i) => i.id !== req.params.id);
  writeWB(req.proj, wb);
  res.json({ ok: true, removed: before - wb.items.length });
});

// A small string-trim-and-cap helper shared by the write endpoints below.
const trim = (v, max = 200) => String(v ?? "").trim().slice(0, max);

// --- Testimonials ---
// Own file, not a marketing.json key: a testimonial and its publish status must
// survive the AI updater rewriting marketing.json on every refresh. New rows
// normally come from whatever scan/import you wire up outside this app, or are
// added by hand; this board only tracks the review/publish moment.
const TESTIMONIALS_FILE = (p) => join(p.dir, "data", "testimonials.json");
const readTestimonials = (p) => {
  try { return JSON.parse(readFileSync(TESTIMONIALS_FILE(p), "utf-8")); }
  catch { return { items: [], updatedAt: null }; }
};
const TESTIMONIAL_STATUSES = new Set(["new", "published", "dismissed"]);

app.get("/api/p/:project/testimonials", withProject, (req, res) => res.json(readTestimonials(req.proj)));

// Merge, never replace. `items` patches existing rows by id; `add` appends new
// ones that don't exist yet — never both at once confusing a single id, and an
// `add` with an id that already exists is silently skipped rather than
// duplicating a testimonial an import has already seen.
app.patch("/api/p/:project/testimonials", withProject, (req, res) => {
  const { items: patches, add } = req.body || {};
  const doc = readTestimonials(req.proj);
  doc.items = doc.items || [];
  const now = new Date().toISOString();
  const byId = new Map(doc.items.map((it) => [it.id, it]));

  for (const [id, patch] of Object.entries(patches || {})) {
    const row = byId.get(trim(id, 80));
    if (!row || !patch || typeof patch !== "object") continue;
    if ("status" in patch && TESTIMONIAL_STATUSES.has(patch.status)) {
      row.status = patch.status;
      if (patch.status === "published" && !row.publishedAt) row.publishedAt = now;
    }
    if ("locationGroup" in patch) row.locationGroup = trim(patch.locationGroup, 60);
    if ("note" in patch) row.note = trim(patch.note, 300);
    row.updatedAt = now;
  }

  for (const raw of add || []) {
    if (!raw || typeof raw !== "object") continue;
    const id = trim(raw.id, 80) || `t${randomUUID().slice(0, 8)}`;
    if (byId.has(id)) continue; // already recorded
    const row = {
      id,
      name: trim(raw.name, 120),
      context: trim(raw.context, 160),
      location: trim(raw.location, 120),
      locationGroup: trim(raw.locationGroup, 60),
      lang: raw.lang === "es" ? "es" : "en",
      quote: trim(raw.quote, 2000),
      featured: !!raw.featured,
      status: TESTIMONIAL_STATUSES.has(raw.status) ? raw.status : "new",
      source: trim(raw.source, 40) || "manual",
      sourceUid: raw.sourceUid != null ? trim(String(raw.sourceUid), 60) : null,
      foundAt: now,
      publishedAt: null,
      updatedAt: now,
    };
    doc.items.push(row);
    byId.set(id, row);
  }

  doc.updatedAt = now;
  writeFileSync(TESTIMONIALS_FILE(req.proj), JSON.stringify(doc, null, 2));
  res.json(doc);
});

// --- Per-project data writes (used by osctl.mjs / the project-os skill) ---
// A Claude Code session running inside a project folder edits its board through
// these — so the same workflow works whether the OS is local or remote.
const BACKUPS_DIR = (p) => join(p.dir, "data", "backups");
// Keep the most recent `keep` backups plus one-per-day within 30 days; prune the
// rest so the backups dir stops growing without bound.
// Filenames are marketing-YYYY-MM-DDT... so chars 10..20 are the YYYY-MM-DD day.
function rotateBackups(bdir, keep = 10) {
  try {
    const files = readdirSync(bdir).filter((f) => f.startsWith("marketing-") && f.endsWith(".json")).sort();
    if (files.length <= keep) return;
    const recent = new Set(files.slice(-keep));
    const dailyKept = new Set();
    const keepDaily = new Set();
    for (const f of files) { const day = f.slice(10, 20); if (!dailyKept.has(day)) { dailyKept.add(day); keepDaily.add(f); } }
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    for (const f of files) {
      const day = f.slice(10, 20);
      if (recent.has(f)) continue;
      if (keepDaily.has(f) && day >= cutoff) continue;
      try { rmSync(join(bdir, f)); } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
}
// Atomic, backed-up write: copy current -> backups, write to a temp file, rename over.
// The rename is atomic on the same filesystem, so a crash can't leave a half-written file.
function backupAndWrite(p, data) {
  data.meta = data.meta || {};
  data.meta.updatedAt = new Date().toISOString();
  const bdir = BACKUPS_DIR(p);
  if (!existsSync(bdir)) mkdirSync(bdir, { recursive: true });
  if (existsSync(p.DATA)) {
    try { copyFileSync(p.DATA, join(bdir, `marketing-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)); } catch {}
  }
  const tmp = p.DATA + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, p.DATA);
  rotateBackups(bdir);
}
const readData = (p) => JSON.parse(readFileSync(p.DATA, "utf-8"));
const idSlug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const todayLocal = () => new Date().toLocaleDateString("en-CA");

// Append/merge a journal entry (merges into an existing entry for the same date).
app.post("/api/p/:project/journal", withProject, (req, res) => {
  const b = req.body || {};
  const data = readData(req.proj);
  data.journal = data.journal || [];
  const date = b.date || todayLocal();
  const done = Array.isArray(b.done) ? b.done : (b.done ? [b.done] : []);
  const next = Array.isArray(b.next) ? b.next : (b.next ? [b.next] : []);
  let entry = data.journal.find((x) => x.date === date);
  if (entry) {
    if (b.title) entry.title = b.title;
    if (b.summary) entry.summary = b.summary;
    entry.done = [...new Set([...(entry.done || []), ...done])];
    entry.next = [...new Set([...(entry.next || []), ...next])];
  } else {
    const day = (data.journal.reduce((m, x) => Math.max(m, x.day || 0), 0)) + 1;
    entry = { day, date, title: b.title || `Day ${day}`, summary: b.summary || "", done, next };
    data.journal.push(entry);
  }
  data.meta = data.meta || {}; data.meta.dayCount = data.journal.length;
  backupAndWrite(req.proj, data);
  res.status(201).json(entry);
});

// Add a contact (skipped if one with the same id already exists).
app.post("/api/p/:project/contact", withProject, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "name is required" });
  const data = readData(req.proj);
  data.contacts = data.contacts || [];
  const id = idSlug(b.name);
  if (data.contacts.some((c) => c.id === id)) return res.json({ ok: true, status: "already exists", id });
  const initials = b.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const c = {
    id, name: b.name, role: b.role || "", bio: b.bio || "", photo: null, initials,
    relType: b.relType || "warm", tags: [], igHandle: b.igHandle || "",
    links: b.link ? [{ label: String(b.link).replace(/^https?:\/\//, "").split("/")[0], url: b.link }] : [],
    lastContact: { date: b.date || todayLocal(), channel: b.channel || "email", note: b.note || "" },
  };
  data.contacts.push(c);
  backupAndWrite(req.proj, data);
  res.status(201).json(c);
});

// --- Scheduled refresh: one cron per project that enables it ---
for (const { slug } of listProjects()) {
  const p = proj(slug);
  const u = p.config.updater || {};
  if (u.enabled && u.cron) {
    cron.schedule(u.cron, () => runUpdater(slug, "cron"));
    console.log(`[cron] ${slug}: ${u.cron}`);
  }
}

// --- SPA ---
if (existsSync(WEB_DIST)) {
  // Two different caching rules, because the two kinds of file have opposite needs.
  // Asset filenames carry a content hash, so a given URL's bytes never change —
  // cache them hard. index.html is the ONLY thing pointing at the current hash, so
  // it must be revalidated every load; served with max-age=0 it was still being
  // restored from the browser's back/forward cache, leaving a rebuilt board looking
  // unchanged until a manual hard-refresh.
  app.use(express.static(WEB_DIST, {
    index: false,
    setHeaders(res, path) {
      res.setHeader("Cache-Control", /[\\/]assets[\\/]/.test(path)
        ? "public, max-age=31536000, immutable"
        : "no-cache");
    },
  }));
  // Only real app routes fall through to index.html. A browser holding a cached
  // index.html asks for the bundle hash it remembers; once the app is rebuilt that
  // file is gone, and answering it with index.html returned 200 text/html for a
  // <script type="module">. The browser refuses to execute HTML as a module and
  // renders nothing — a blank board, no error the user can act on, and a reload
  // does not help because the cached HTML keeps asking for the same dead hash.
  //
  // A 404 is the honest answer for a file that does not exist, and it is also the
  // recoverable one: the request fails loudly and revalidating index.html (served
  // no-cache above) hands over the current hash.
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/assets/") || extname(req.path)) {
      return res.status(404).type("txt").send("Not found");
    }
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(join(WEB_DIST, "index.html"));
  });
} else {
  app.get("*", (_req, res) => res.status(200).type("html").send(`<h1>Project OS</h1><p>Web app not built. Run <code>npm run build:web</code>.</p>`));
}

// Bind loopback-only. `app.listen(PORT)` alone binds every interface, which
// would put the board — journal, contacts, whiteboard — on Wi-Fi and any other
// network this machine is on, with no login. Set OS_HOST=0.0.0.0 to expose it
// deliberately; the Basic-auth gate above then applies to every non-loopback
// request.
const HOST = process.env.OS_HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  const list = listProjects().map((p) => p.slug).join(", ");
  console.log(`Project OS → http://localhost:${PORT}  (projects: ${list})`);
});
