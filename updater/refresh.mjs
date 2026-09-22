// AI updater engine.
// Reads Claude Code session transcripts for this project, asks `claude -p` for a
// strict JSON patch (journal entry + Who's Who contact updates), and merges it
// into data/marketing.json. Never sends anything anywhere — only reads local
// session files and writes the local JSON.
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, copyFileSync, mkdirSync } from "fs";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// --- Project (tenant) resolution ---
const PROJECT = process.env.PROJECT || "demo";
const PROJECT_DIR = join(ROOT, "projects", PROJECT);
const CONFIG = (() => {
  try { return JSON.parse(readFileSync(join(PROJECT_DIR, "config.json"), "utf-8")); }
  catch { return { updater: {} }; }
})();
const UP = CONFIG.updater || {};

const DATA = join(PROJECT_DIR, "data", "marketing.json");
const STATE = join(PROJECT_DIR, "data", "state.json");
const BACKUPS = join(PROJECT_DIR, "data", "backups");
// Which Claude Code session folders feed this board's journal.
//
// settings.json (written by the Settings tab) overrides config.json, and can add
// extra folders — the "global" one, C--Users-<user>, catches everything that
// wasn't done inside a specific project folder.
const SETTINGS = (() => {
  try { return JSON.parse(readFileSync(join(PROJECT_DIR, "data", "settings.json"), "utf-8")); }
  catch { return {}; }
})();
const CLAUDE_PROJECTS = join(process.env.USERPROFILE || process.env.HOME, ".claude", "projects");
const PRIMARY_SESSIONS = SETTINGS.sessionsDir ?? UP.sessionsDir ?? null;
const SESSIONS_DIR = PRIMARY_SESSIONS ? join(CLAUDE_PROJECTS, PRIMARY_SESSIONS) : null;
// [{ name, path, primary }] — the primary keeps bare-filename offset keys so an
// existing state.json stays valid; extras are namespaced to avoid collisions.
const SESSION_DIRS = [
  ...(PRIMARY_SESSIONS ? [{ name: PRIMARY_SESSIONS, path: SESSIONS_DIR, primary: true }] : []),
  ...(SETTINGS.extraSessionDirs || [])
    .filter((n) => n && n !== PRIMARY_SESSIONS)
    .map((n) => ({ name: n, path: join(CLAUDE_PROJECTS, n), primary: false })),
];
const MAX_DIGEST = 40000;
const log = (...a) => console.log("[refresh]", ...a);

function todayLocal() {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
}
function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function readJSON(p, fb) { try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return fb; } }

// ---------- Claude sessions -> digest ----------
function scanSessions(offsets) {
  const newOffsets = { ...offsets };
  let digest = "";
  if (SESSION_DIRS.length === 0) return { digest, newOffsets };
  const dirs = SESSION_DIRS.filter((d) => existsSync(d.path));
  if (dirs.length === 0) return { digest, newOffsets };
  log(`sessions: reading ${dirs.length} folder(s) — ${dirs.map((d) => d.name).join(", ")}`);
  const entries = dirs.flatMap((d) =>
    readdirSync(d.path)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ file: f, path: join(d.path, f), key: d.primary ? f : `${d.name}/${f}` }))
  );
  for (const { path: p, key } of entries) {
    const size = statSync(p).size;
    const prev = offsets[key] || 0;
    newOffsets[key] = size;
    if (size <= prev) continue;
    let text = readFileSync(p, "utf-8");
    // On first run (prev 0) only take the tail to bound cost.
    if (prev === 0 && text.length > 14000) text = text.slice(-14000);
    else if (prev > 0) text = text.slice(prev);
    for (const line of text.split("\n")) {
      if (!line.trim().startsWith("{")) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const m = o.message; if (!m || !m.role) continue;
      let t = "";
      if (typeof m.content === "string") t = m.content;
      else if (Array.isArray(m.content)) t = m.content.filter((b) => b && b.type === "text").map((b) => b.text).join(" ");
      t = (t || "").trim();
      if (!t) continue;
      digest += `${m.role === "assistant" ? "ASST" : "USER"}: ${t.slice(0, 1400)}\n`;
    }
  }
  if (digest.length > MAX_DIGEST) digest = digest.slice(-MAX_DIGEST);
  return { digest, newOffsets };
}

// ---------- Ask claude -p for a JSON patch ----------
const CLAUDE_TIMEOUT_MS = 200000;

// Pure text-in / JSON-out: the prompt already carries every signal, and the
// model never needs to touch a file, a tool or an MCP server. The CLI's
// defaults assume the opposite and load a large agent context before reading
// the question, so strip it down to just the question.
//   --strict-mcp-config   drop every MCP server's tool schemas
//   --setting-sources ""  no user/project settings, no CLAUDE.md, no hooks
//   --tools ""            no built-in tool definitions
//   --system-prompt       replace the coding-agent preamble with one line
const CLAUDE_SYSTEM_PROMPT =
  "You transform the input into strict JSON exactly as its instructions specify. Output only JSON — no prose, no code fences.";
const CLAUDE_CMD = 'claude -p --output-format json --model sonnet'
  + ' --strict-mcp-config --setting-sources "" --tools ""'
  + ` --system-prompt "${CLAUDE_SYSTEM_PROMPT}"`;

// One attempt. Resolves { value, empty, why } rather than just the parsed object,
// because "the CLI printed nothing" and "the CLI printed something unparseable"
// need different handling.
function claudeOnce(prompt) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(CLAUDE_CMD, { shell: true, windowsHide: true });
    let out = "", err = "", timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // shell:true means `child` is cmd.exe/sh, not claude — killing it on Windows
      // orphans the real process and stdout never arrives, so take the tree down.
      try {
        if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
        else child.kill();
      } catch {}
    }, CLAUDE_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { err += String(e.message || e); });
    child.stdin.on("error", () => {}); // spawn failure closes stdin under us
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const took = Math.round((Date.now() - t0) / 1000);
      try {
        const env = JSON.parse(out);
        let result = env.result || "";
        const m = result.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (m) result = m[1];
        const s = result.indexOf("{"), e = result.lastIndexOf("}");
        resolve({ value: JSON.parse(result.slice(s, e + 1)) });
      } catch (e2) {
        const cause = timedOut ? `timed out after ${took}s` : String(e2.message || e2).slice(0, 120);
        resolve({
          value: null,
          empty: !out.trim(),
          why: `${cause} · exit ${code}${signal ? "/" + signal : ""} · ${took}s · stdout ${out.length}b`
            + (err.trim() ? ` · stderr: ${err.trim().slice(0, 120)}` : " · stderr empty"),
        });
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function runClaude(prompt) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await claudeOnce(prompt);
    if (r.value) return r.value;
    log(`claude failed (attempt ${attempt}/2): ${r.why}`);
    // Empty stdout means the CLI never answered — killed, crashed, or a cold
    // start that ran past the timeout. That is worth one retry. Output that
    // arrived but wouldn't parse would just come back unparseable, so don't
    // pay for a second call.
    if (!r.empty) return null;
  }
  return null;
}

function buildPrompt(data, digest, today) {
  const contacts = (data.contacts || []).map((c) => ({ id: c.id, name: c.name, lastContact: c.lastContact?.date }));
  const journalDates = (data.journal || []).map((j) => `Day ${j.day}=${j.date}`);
  const persona = UP.persona || `You maintain a project journal and lightweight contacts list for "${CONFIG.brand?.name || PROJECT}".`;
  return `${persona} Today is ${today}.

From the CLAUDE SESSION EXCERPTS below, produce a STRICT JSON patch of genuinely new, real work. Output ONLY JSON, no prose.

Schema:
{
  "journalToday": { "date": "${today}", "title": "one concise sentence, <=12 words, that sums up the day", "summary": "1-2 sentences", "done": ["..."], "next": ["..."] } | null,
  "contactUpdates": [ { "id": "<existing id>", "date": "YYYY-MM-DD", "channel": "email|in-person|lunch|phone|IG", "note": "what happened" } ],
  "newContacts": [ { "name": "", "role": "", "bio": "1-2 sentences", "relType": "ally|venue|media|warm|partner|lead", "igHandle": "", "link": "", "date": "YYYY-MM-DD", "channel": "email|in-person|phone", "note": "" } ]
}

Rules:
- Every "done" and "next" item MUST be written as "[category] Short title — the detail",
  using an em dash (—). The title is 2-5 words and is rendered in gold on the board; the
  detail is the full sentence. Example:
  "[feature] Whiteboard search added — you can now filter items by title from the index".
- category MUST be exactly one of: bug (something broken, now fixed), feature (new capability),
  ux (look, layout, interaction), content (copy, pages, assets, listings), refactor (restructuring
  existing code), infra (servers, deploys, tooling, commits, automation), outreach (contacting
  people), lead (an inbound signup or interested person), research (planning, audits, reviews,
  decisions). Pick the single best fit.
- Only REAL work. Ignore personal/unrelated chatter and tool noise.
- contactUpdates: use ONLY these existing ids: ${JSON.stringify(contacts)}
- Do NOT duplicate journal already logged for these dates: ${journalDates.join(", ")}
- newContacts: only genuinely important people (a collaborator, a client, a partner) with enough
  info to be useful.
- If nothing new/meaningful, return {"journalToday":null,"contactUpdates":[],"newContacts":[]}.

=== CLAUDE SESSION EXCERPTS (new) ===
${digest || "(none)"}
`;
}

// ---------- Merge ----------
function merge(data, patch, today) {
  let changed = 0;
  data.journal = data.journal || [];
  data.contacts = data.contacts || [];
  // journal
  if (patch.journalToday && (patch.journalToday.summary || (patch.journalToday.done || []).length)) {
    const j = patch.journalToday;
    j.date = j.date || today;
    const existing = data.journal.find((x) => x.date === j.date);
    if (existing) {
      const add = (arr, items) => { for (const it of items || []) if (it && !arr.includes(it)) { arr.push(it); changed++; } };
      add(existing.done = existing.done || [], j.done);
      add(existing.next = existing.next || [], j.next);
      if (j.summary) existing.summary = j.summary;
    } else {
      const day = (data.journal.reduce((m, x) => Math.max(m, x.day), 0)) + 1;
      data.journal.push({ day, date: j.date, title: j.title || `Day ${day}`, summary: j.summary || "", done: j.done || [], next: j.next || [] });
      changed++;
    }
  }
  // contact updates (newer date wins)
  for (const u of patch.contactUpdates || []) {
    const c = data.contacts.find((x) => x.id === u.id);
    if (!c) continue;
    if (!c.lastContact || (u.date || "") >= (c.lastContact.date || "")) {
      c.lastContact = { date: u.date || today, channel: u.channel || "email", note: u.note || c.lastContact?.note || "" };
      changed++;
    }
  }
  // new contacts
  for (const nc of patch.newContacts || []) {
    if (!nc.name) continue;
    const id = slug(nc.name);
    if (data.contacts.some((x) => x.id === id)) continue;
    const initials = nc.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    data.contacts.push({
      id, name: nc.name, role: nc.role || "", bio: nc.bio || "", photo: null, initials,
      relType: nc.relType || "warm", tags: [], igHandle: nc.igHandle || "",
      links: nc.link ? [{ label: nc.link.replace(/^https?:\/\//, "").split("/")[0], url: nc.link }] : [],
      lastContact: { date: nc.date || today, channel: nc.channel || "email", note: nc.note || "" },
    });
    changed++;
  }
  // recompute a few contact stats
  data.stats = data.stats || {};
  data.stats.allies = data.contacts.filter((c) => c.relType === "ally").length;
  data.stats.leads = data.contacts.filter((c) => c.relType === "lead").length;
  data.meta = data.meta || {};
  data.meta.dayCount = data.journal.length;
  data.meta.updatedAt = new Date().toISOString();
  return changed;
}

// ---------- Journal consolidation ----------
// merge() only appends: it skips an item it has seen character-for-character, so a
// day refreshed a dozen times accumulates a dozen near-identical retellings of the
// same piece of work. So once a day gets busy we hand the whole entry back to the
// LLM and ask for one consolidated version. Rewriting rather than appending is the
// point — but that also means a bad call could quietly gut a day's history, hence
// the guards in applyConsolidation(): the result has to keep the item format and
// can't shrink past a floor, or we keep the original.
const CONSOLIDATE_MIN_DONE = 8;   // below this an entry is still readable as-is
const CONSOLIDATE_FLOOR = 0.4;    // a result under 40% of the input is a bad call, not a tidy-up

const journalShape = (s) => /^\[[a-z]+\]\s.+\s—\s.+/.test(String(s || ""));

function buildConsolidatePrompt(entry) {
  return `You are tidying ONE day of a project journal. Below is the entry as it stands after a day of automated appends. Return a cleaned-up version of the SAME day. Output ONLY JSON, no prose.

Schema:
{ "title": "...", "summary": "...", "done": ["..."], "next": ["..."] }

Rules:
- NEVER invent work. Every fact in the input must survive somewhere in your output.
  You may merge, reword and reorder; you may not add new claims or drop information.
- Collapse items that describe the SAME piece of work into ONE richer item.
- When a later item CORRECTS an earlier one, keep only the correct version.
- Drop a "next" item ONLY when a "done" item in this same entry unambiguously
  finishes that exact task. If it names remaining work, a blocker or a verification
  the "done" item does not cover, KEEP it.
- Merge "next" items that contradict or overlap into one honest statement.
- Keep the exact format "[category] Short title — the detail" with an em dash (—).
  category MUST be one of: bug, feature, ux, content, refactor, infra, outreach,
  lead, research.
- Order "done" so related work sits together and the day reads as a story.
- "title": one sentence, <=12 words, covering the day's biggest threads.
- "summary": 1-2 sentences on what actually mattered today.

=== ENTRY (day ${entry.day}, ${entry.date}) ===
${JSON.stringify({ title: entry.title, summary: entry.summary, done: entry.done || [], next: entry.next || [] }, null, 1)}
`;
}

// Returns the number of items removed, or 0 if we declined the result.
function applyConsolidation(entry, res) {
  if (!res || !Array.isArray(res.done) || !res.done.length) {
    log("consolidate: no usable result — entry left as-is");
    return 0;
  }
  const next = Array.isArray(res.next) ? res.next : entry.next || [];
  const beforeDone = (entry.done || []).length, beforeNext = (entry.next || []).length;

  // A consolidation that halves the day is a failed call, not a tidy one.
  if (res.done.length < Math.ceil(beforeDone * CONSOLIDATE_FLOOR)) {
    log(`consolidate: refused — done ${beforeDone} → ${res.done.length} is below the ${CONSOLIDATE_FLOOR * 100}% floor`);
    return 0;
  }
  // Malformed items mean the model dropped the schema; don't write that to the board.
  const bad = res.done.filter((d) => !journalShape(d)).length;
  if (bad > res.done.length * 0.2) {
    log(`consolidate: refused — ${bad}/${res.done.length} done item(s) lost the "[category] Title — detail" format`);
    return 0;
  }

  entry.done = res.done;
  entry.next = next;
  if (res.title) entry.title = res.title;
  if (res.summary) entry.summary = res.summary;
  const removed = (beforeDone - entry.done.length) + (beforeNext - entry.next.length);
  log(`consolidate: day ${entry.day} — done ${beforeDone} → ${entry.done.length}, next ${beforeNext} → ${entry.next.length}`);
  return Math.max(removed, 0);
}

async function consolidateJournalDay(data, date, { force = false } = {}) {
  const entry = (data.journal || []).find((x) => x.date === date);
  if (!entry) return 0;
  if (!force && (entry.done || []).length < CONSOLIDATE_MIN_DONE) return 0;
  const res = await runClaude(buildConsolidatePrompt(entry));
  return applyConsolidation(entry, res);
}

// ---------- main ----------
async function main() {
  const today = todayLocal();
  const data = readJSON(DATA, null);
  const state = readJSON(STATE, { sessionOffsets: {}, lastRun: null });
  if (!data) { log("no marketing.json — abort"); process.exit(1); }

  const backup = () => {
    if (!existsSync(BACKUPS)) mkdirSync(BACKUPS, { recursive: true });
    copyFileSync(DATA, join(BACKUPS, `marketing-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  };

  // Fast path: consolidate one journal day only. Defaults to today;
  // `--date YYYY-MM-DD` or `--day N` tidies an older entry that predates this pass.
  if (process.argv.includes("--consolidate-only")) {
    const dateArg = process.argv[process.argv.indexOf("--date") + 1];
    const dayArg = process.argv[process.argv.indexOf("--day") + 1];
    const target = process.argv.includes("--date") ? dateArg
      : process.argv.includes("--day") ? (data.journal.find((x) => String(x.day) === String(dayArg)) || {}).date
      : today;
    if (!target) { log(`consolidate-only: no journal entry for --day ${dayArg}`); return; }
    const n = await consolidateJournalDay(data, target, { force: true });
    log(`consolidate-only: ${target} — ${n} item(s) collapsed`);
    if (n > 0) {
      backup();
      data.meta.updatedAt = new Date().toISOString();
      writeFileSync(DATA, JSON.stringify(data, null, 2));
    }
    return;
  }

  log(`project ${PROJECT} | today ${today} | sessions=${!!UP.sessions} | lastRun ${state.lastRun || "never"}`);
  const { digest, newOffsets } = UP.sessions ? scanSessions(state.sessionOffsets || {}) : { digest: "", newOffsets: state.sessionOffsets || {} };
  log("sessions: digest", digest.length, "chars");

  let changed = 0;
  let journalGrew = false;
  if (digest) {
    const patch = await runClaude(buildPrompt(data, digest, today));
    if (patch) {
      changed += merge(data, patch, today);
      journalGrew = !!(patch.journalToday && (patch.journalToday.done || []).length);
    } else log("no patch (claude failed) — journal/contacts untouched");
  }

  // Today's entry just grew by append. Collapse the repeats and re-title the day
  // before it lands on the board — otherwise every refresh makes the day longer
  // and less true.
  if (journalGrew) changed += await consolidateJournalDay(data, today);

  if (changed > 0) {
    backup();
    data.meta.updatedAt = new Date().toISOString();
    writeFileSync(DATA, JSON.stringify(data, null, 2));
  }

  state.sessionOffsets = newOffsets;
  state.lastRun = new Date().toISOString();
  writeFileSync(STATE, JSON.stringify(state, null, 2));
  log(`done — ${changed} change(s) applied`);
}

main().catch((e) => { log("fatal", e); process.exit(1); });
