// Scaffold a new Project OS tenant.
//   node scaffold.mjs <slug> "Project Name" [--dir <absolute path>] [--port <n>]
//
// <slug>  lowercase / digits / dashes — the tenant id and URL segment.
// --dir   the project's source folder (usually where Claude Code is running). When
//         given, the journal auto-updates from the Claude Code sessions you run in
//         that folder (sessions-only updater; no mail). Omit for a manual board.
//
// Writes projects/<slug>/{config.json,data/*} and prints the local URL. The
// Project OS server lists tenants straight from the filesystem, so the new
// project shows up in the project dropdown on the next page load — no restart
// needed for a manual board (cron scheduling for an auto-updating board
// activates on the next server restart).
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "fs";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// --- parse args: positional slug + name, plus --dir / --port flags ---
const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--dir") flags.dir = argv[++i];
  else if (argv[i] === "--port") flags.port = argv[++i];
  else pos.push(argv[i]);
}
const [slug, name] = pos;

if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  console.error('Usage: node scaffold.mjs <slug> "Project Name" [--dir <path>] [--port <n>]   (slug = lowercase, digits, dashes)');
  process.exit(1);
}
const projDir = join(ROOT, "projects", slug);
if (existsSync(projDir)) { console.error(`Project "${slug}" already exists at ${projDir}`); process.exit(1); }

const projectName = name || slug;
const port = Number(flags.port) || 4318;
const today = new Date().toLocaleDateString("en-CA");

// Claude Code stores each project's sessions under ~/.claude/projects/<dir with
// :,\,/ turned into dashes>. If we know the source folder we can point the updater
// there so the journal fills itself from the Claude work you do in that repo.
// Each separator char maps to ONE dash (NOT collapsed), matching Claude Code's
// scheme: C:\Users\alex\proj -> C--Users-alex-proj. Trailing separators trimmed.
const sessionsDir = flags.dir ? flags.dir.replace(/[/\\:]/g, "-").replace(/-+$/, "") : null;

mkdirSync(join(projDir, "data", "backups"), { recursive: true });
mkdirSync(join(projDir, "public", "whoswho"), { recursive: true });

const config = {
  slug,
  brand: {
    name: projectName,
    subtitle: "Project OS",
    signature: `— ${projectName}`,
    logo: "radial(circle at 32% 30%, #5dade2, #2c6fa6 70%)",
    liveLabel: "live",
    kicker: "Project board",
  },
  theme: {
    red: "#2c6fa6", accent: "#5dade2", gold: "#e0a830", green: "#27ae60", greenBright: "#2ecc71",
    blue: "#5dade2", purple: "#bb8fce", bg: "#0c0f14", panel: "#141a22", card: "#1a212b",
    border: "#28323f", text: "#e8eef5", muted: "#8fa2b5", faint: "#5a6a7a",
    heroGradient: "linear(135deg, #0d1420 0%, #12233a 45%, #0d1420 100%)",
    heroGlow: "radial(ellipse 80% 60% at 15% 0%, rgba(93,173,226,0.20), transparent 70%)",
    selection: "rgba(93,173,226,0.3)",
  },
  dashboard: { kind: "project" },
  modules: [
    { id: "dashboard", label: "Dashboard" },
    { id: "journal", label: "Journal" },
    { id: "mission", label: "Mission" },
    { id: "goals", label: "Goals" },
    { id: "roadmap", label: "Roadmap" },
    { id: "whoswho", label: "Who's Who" },
    { id: "contactlist", label: "Contact List" },
    { id: "testimonials", label: "Testimonials" },
    { id: "whiteboard", label: "Whiteboard" },
  ],
  port,
  sourceDir: flags.dir || null,
  updater: sessionsDir
    ? {
        enabled: true, sessions: true, sessionsDir,
        cron: "*/30 8-22 * * *",
        persona: `You maintain a project journal + lightweight contacts list for the "${projectName}" project. Summarise the real work done in the Claude Code sessions into concise journal entries; log genuinely new people into contacts. Ignore tool chatter.`,
      }
    : { enabled: false, sessions: false },
};

const data = {
  meta: { project: projectName, updatedAt: new Date().toISOString(), dayCount: 1, tagline: "" },
  overview: "",
  stats: {},
  links: [],
  event: null,
  journal: [{ day: 1, date: today, title: "Kickoff", summary: `Started the ${projectName} project.`, done: [], next: [] }],
  contacts: [],
  goals: [],
  goalsHorizon: "",
  roadmap: { vision: "", phases: [] },
  mission: {},
};

writeFileSync(join(projDir, "config.json"), JSON.stringify(config, null, 2));
writeFileSync(join(projDir, "data", "marketing.json"), JSON.stringify(data, null, 2));
writeFileSync(join(projDir, "data", "state.json"), JSON.stringify({ sessionOffsets: {}, lastRun: null }, null, 2));
writeFileSync(join(projDir, "data", "whiteboard.json"), JSON.stringify({ items: [] }, null, 2));

// Discovery: drop a marker + CLAUDE.md block into the project folder so any Claude
// Code session opened there instantly knows its board exists and how to reach it.
const OS_URL = process.env.PROJECT_OS_URL || "http://localhost:4317";
if (flags.dir && existsSync(flags.dir)) {
  const marker = {
    slug, name: projectName,
    osUrl: OS_URL,
    board: `${OS_URL}/${slug}`,
    api: `${OS_URL}/api/p/${slug}`,
    osRoot: ROOT.replace(/\\/g, "/"),
    note: "This project has a Project OS board. Use the `project-os` skill or osctl.mjs to read/update it.",
  };
  try {
    writeFileSync(join(flags.dir, ".project-os.json"), JSON.stringify(marker, null, 2));
  } catch (e) { console.error("  (could not write .project-os.json:", e.message + ")"); }

  const block = [
    ``,
    `## Project OS`,
    ``,
    `This project has a live **Project OS** board: ${OS_URL}/${slug}`,
    `(Dashboard · Journal · Roadmap · Goals · Who's Who · Whiteboard).`,
    ``,
    `To read or update it from here, use the **project-os** skill, or the CLI directly`,
    `(reads \`.project-os.json\` in this folder, works local or remote):`,
    ``,
    "```bash",
    `node "${ROOT.replace(/\\/g, "/")}/osctl.mjs" info`,
    `node "${ROOT.replace(/\\/g, "/")}/osctl.mjs" journal "Title" "What happened today"`,
    `node "${ROOT.replace(/\\/g, "/")}/osctl.mjs" note "Heading" "<p>note for the whiteboard</p>"`,
    "```",
    ``,
    `The board's Journal also auto-updates from the Claude Code sessions you run in this folder.`,
    ``,
  ].join("\n");
  try {
    const cmPath = join(flags.dir, "CLAUDE.md");
    if (existsSync(cmPath) && readFileSync(cmPath, "utf-8").includes("## Project OS")) {
      // already documented — leave it
    } else {
      appendFileSync(cmPath, block);
    }
  } catch (e) { console.error("  (could not update CLAUDE.md:", e.message + ")"); }

  // Central registry: lets a session resolve its board even without a local marker.
  try {
    const regDir = join(homedir(), ".claude", "project-os");
    const regPath = join(regDir, "registry.json");
    if (!existsSync(regDir)) mkdirSync(regDir, { recursive: true });
    const reg = existsSync(regPath) ? JSON.parse(readFileSync(regPath, "utf-8")) : { osUrl: OS_URL, projects: {} };
    reg.projects = reg.projects || {};
    reg.projects[flags.dir.replace(/\\/g, "/")] = { slug, osUrl: OS_URL };
    writeFileSync(regPath, JSON.stringify(reg, null, 2));
  } catch (e) { console.error("  (could not update registry:", e.message + ")"); }
}

console.log(`✔ Scaffolded Project OS "${slug}" (${projectName})`);
console.log(`  Open it:  ${OS_URL}/${slug}`);
if (sessionsDir) console.log(`  Journal will auto-update from Claude Code sessions in: ${flags.dir}`);
if (flags.dir) console.log(`  Wrote .project-os.json + CLAUDE.md note into: ${flags.dir}`);
console.log(`  It appears in the project dropdown at ${OS_URL} on next load.`);
