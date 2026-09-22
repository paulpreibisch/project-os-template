#!/usr/bin/env node
// osctl — talk to a Project OS board from inside a project folder.
//
// A Claude Code session (or you) runs this from a project directory that has a
// `.project-os.json` marker. It resolves the board's slug + base URL from that
// marker (or --project / --url / env), then reads and updates the board over the
// HTTP API — so it works identically whether the OS runs locally or on a server.
//
// Resolution order for slug + base URL:
//   1. --project <slug> / --url <baseUrl> flags
//   2. .project-os.json in the current directory (or nearest parent)
//   3. env PROJECT_OS_SLUG / PROJECT_OS_URL
//   4. url default http://localhost:4317
//
// Commands:
//   osctl info                         show the resolved board + link
//   osctl show [section]               print board data (all, or one key e.g. journal)
//   osctl journal "Title" "Summary"    add/merge today's journal entry
//        [--date YYYY-MM-DD] [--done "a;b"] [--next "c;d"]
//   osctl contact "Name" [--role ..] [--rel ally|venue|media|warm|partner|lead]
//        [--ig @handle] [--link url] [--note ..]
//   osctl note "Title" "<p>HTML or text</p>"     post to the Whiteboard
//   osctl open                          print the board URL (open it in your browser)
import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
const pos = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
  else pos.push(argv[i]);
}

function findMarker(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    const f = join(dir, ".project-os.json");
    if (existsSync(f)) { try { return JSON.parse(readFileSync(f, "utf-8")); } catch { return null; } }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Central fallback: ~/.claude/project-os/registry.json maps a project dir → board,
// so a folder that was never scaffolded (no local marker) is still resolvable.
function findInRegistry(startDir) {
  try {
    const reg = JSON.parse(readFileSync(join(homedir(), ".claude", "project-os", "registry.json"), "utf-8"));
    const cwd = resolve(startDir).replace(/\\/g, "/").toLowerCase();
    let best = null;
    for (const [dir, info] of Object.entries(reg.projects || {})) {
      const d = dir.replace(/\\/g, "/").toLowerCase();
      if ((cwd === d || cwd.startsWith(d + "/")) && (!best || d.length > best._len))
        best = { slug: info.slug, osUrl: info.osUrl || reg.osUrl, _len: d.length };
    }
    if (best) { delete best._len; return best; }
  } catch { /* no registry */ }
  return null;
}

const marker = findMarker(process.cwd()) || findInRegistry(process.cwd()) || {};
const slug = flags.project || marker.slug || process.env.PROJECT_OS_SLUG;
const baseUrl = (flags.url || marker.osUrl || process.env.PROJECT_OS_URL || "http://localhost:4317").replace(/\/+$/, "");
const api = `${baseUrl}/api/p/${slug}`;
const boardUrl = `${baseUrl}/${slug}`;

function die(msg) { console.error(msg); process.exit(1); }
if (!cmd) die("Usage: osctl <info|show|journal|contact|note|open> …  (see top of osctl.mjs)");
if (!slug) die("No project resolved. Run inside a folder with .project-os.json, or pass --project <slug>.");

// The server requires Basic Auth on every request now (loopback used to be
// exempt, but that's unsafe behind a reverse proxy — see server/index.mjs).
// osctl runs on the same machine as the OS install, so it can read the same
// password file directly rather than prompting for it on every call.
const OSCTL_ROOT = dirname(fileURLToPath(import.meta.url));
const authFile = join(OSCTL_ROOT, ".os-auth");
const authHeader = existsSync(authFile)
  ? "Basic " + Buffer.from(`${process.env.OS_AUTH_USER || "admin"}:${readFileSync(authFile, "utf8").trim()}`).toString("base64")
  : null;

// A remote deployment behind Cloudflare Access rejects everything — including
// a correct Basic Auth header — before it ever reaches the app, unless the
// request also carries a Service Token the Access app's policy allows. See
// .cf-access.json (gitignored; holds {client_id, client_secret}).
const cfAccessFile = join(OSCTL_ROOT, ".cf-access.json");
const cfAccessHeaders = existsSync(cfAccessFile)
  ? (() => {
      const { client_id, client_secret } = JSON.parse(readFileSync(cfAccessFile, "utf8"));
      return client_id && client_secret
        ? { "CF-Access-Client-Id": client_id, "CF-Access-Client-Secret": client_secret }
        : {};
    })()
  : {};

async function req(method, path, body) {
  const r = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...cfAccessHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((e) => die(`Cannot reach the OS at ${baseUrl} — is the server running?  (${e.message})`));
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!r.ok) die(`${method} ${path} → ${r.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  return json;
}
const list = (v) => (v ? String(v).split(";").map((s) => s.trim()).filter(Boolean) : []);

switch (cmd) {
  case "info":
    console.log(JSON.stringify({ slug, name: marker.name || slug, board: boardUrl, api }, null, 2));
    break;
  case "open":
    console.log(boardUrl);
    break;
  case "show": {
    const section = pos[0];
    // A few sections are their own stores rather than keys inside marketing.json
    // - anything a human types, or that must survive an AI refresh, lives outside
    // the file the AI updater rewrites. Reading them from /data would answer
    // null, which reads as "nothing logged" rather than "asked the wrong place".
    const OWN_STORE = { whiteboard: "/whiteboard" };
    if (section && OWN_STORE[section]) {
      const d = await req("GET", OWN_STORE[section]);
      console.log(JSON.stringify(d, null, 2));
      break;
    }
    const data = await req("GET", "/data");
    console.log(JSON.stringify(section ? data[section] ?? null : data, null, 2));
    break;
  }
  case "journal": {
    if (!pos[0]) die('Usage: osctl journal "Title" "Summary" [--done "a;b"] [--next "c;d"] [--date YYYY-MM-DD]');
    const entry = await req("POST", "/journal", {
      title: pos[0], summary: pos[1] || "", date: flags.date,
      done: list(flags.done), next: list(flags.next),
    });
    console.log(`✔ journal · Day ${entry.day} (${entry.date}): ${entry.title}`);
    break;
  }
  case "contact": {
    if (!pos[0]) die('Usage: osctl contact "Name" [--role ..] [--rel ..] [--ig @h] [--link url] [--note ..]');
    const c = await req("POST", "/contact", {
      name: pos[0], role: flags.role, relType: flags.rel, igHandle: flags.ig, link: flags.link, note: flags.note, bio: flags.bio,
    });
    console.log(c.status === "already exists" ? `· contact already exists: ${pos[0]}` : `✔ contact added: ${c.name}`);
    break;
  }
  case "note": {
    if (!pos[0] || !pos[1]) die('Usage: osctl note "Title" "<p>HTML or text</p>"');
    const item = await req("POST", "/whiteboard", { title: pos[0], content: pos[1], language: "html" });
    console.log(`✔ whiteboard note added: ${item.title}\n  ${boardUrl}/whiteboard/${item.id}`);
    break;
  }
  default:
    die(`Unknown command "${cmd}". Try: info | show | journal | contact | note | open`);
}
