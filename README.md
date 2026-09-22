# Project OS

A self-hostable, AI-filled project board. One Express server + one React
bundle serve a **Dashboard, Journal, Mission, Goals, Roadmap, Who's Who,
Contact List, Testimonials and Whiteboard** for every project ("tenant") you
give it — each living in its own `projects/<slug>/` folder with its own
branding, theme and data.

The point isn't the UI — it's that every section is a **prompt, not a form**.
Clone this, run `node scaffold.mjs <slug> "Project Name"`, and you get a
board where every field is a question ("What is this project's mission — the
one sentence you'd tell a stranger?"). Answer it yourself, or point an AI
assistant with file access (Claude Code, or anything similar) at
`projects/<slug>/data/marketing.json` and ask it to fill the board in from
what you tell it about the project.

Look at `projects/demo/` — or run the server and open `/demo` — to see the
shape of it, live, with every field showing its prompt instead of real
content.

## Running it

```bash
npm install                # root deps (Express, node-cron)
npm --prefix web install   # web deps (React, Chakra UI, Vite)
npm run build:web          # build the React bundle into web/dist
```

Set a password before starting — the server refuses to serve anything
without one:

```bash
echo -n "your-password-here" > .os-auth
```

```bash
npm start                  # runs on http://localhost:4317
```

Open `http://localhost:4317/demo` and sign in with the password you set.

For local UI work, `npm --prefix web run dev` serves on `:4318` and proxies
`/api` to `:4317`, so you get hot reload without rebuilding.

## Creating your own board

```bash
node scaffold.mjs <slug> "Project Name" --dir <absolute path to the project folder>
```

`--dir` wires the board's Journal to auto-update from Claude Code session
transcripts in that folder (see "The AI updater" below) — omit it for a
manual board. The new project shows up in the project dropdown on next page
load; no restart needed.

## The shape of it

| Path | What it is |
|---|---|
| `server/index.mjs` | The whole API — one file, no router split. |
| `web/src/App.jsx` | Tab bar + view switch. Every module is registered here. |
| `web/src/components/*.jsx` | One file per tab: `Dashboard`, `Journal`, `Mission`, `Goals`, `Roadmap`, `WhosWho`, `ContactList`, `Testimonials`, `Whiteboard`. |
| `projects/<slug>/config.json` | Brand, theme, `modules[]` (which tabs show), `updater{}` (AI-updater config). |
| `projects/<slug>/data/*.json` | That project's data. See the ownership rule below. |
| `updater/refresh.mjs` | The AI updater: reads Claude Code sessions, asks `claude -p` for a journal/contacts patch, merges it in. |
| `osctl.mjs` | CLI to read/write a board from a project folder — `info`, `show`, `journal`, `contact`, `note`, `open`. |
| `scaffold.mjs` | Creates a new tenant. |

**One rule that's easy to get wrong:** `data/marketing.json` is rewritten
wholesale by the AI updater on every run. Anything a *human* types, or that
must survive a refresh, gets its own file in `data/` instead — that's why
`contact-list.json`, `whiteboard.json` and `testimonials.json` exist as
siblings of `marketing.json` rather than keys inside it.

## The AI updater

`updater/refresh.mjs` shells out to the locally installed `claude` CLI
(`claude -p`) — no API key needed, just Claude Code installed and
authenticated on the machine that runs it. It reads new lines from Claude
Code's own session transcripts (`~/.claude/projects/<folder>/*.jsonl`), asks
for a strict JSON patch (a journal entry, updated/new contacts), and merges
it into `marketing.json`. It never sends your data anywhere except to the
`claude` CLI itself.

Point it at a project with `config.json`'s `updater.sessionsDir` (set
automatically by `scaffold.mjs --dir`), enable it with `updater.enabled:
true`, and give it a schedule with `updater.cron` (a standard 5-field cron
expression) — the server schedules one cron job per project that has both.

If the OS server runs somewhere other than the machine you use Claude Code
on, `updater/journal-push.mjs` is a companion script that reads sessions
locally and pushes journal entries to the remote board over HTTP instead.

## `osctl.mjs` — reading and writing a board from a project folder

Run from inside a project folder that has a `.project-os.json` marker
(written by `scaffold.mjs --dir`):

```bash
node <path-to-this-repo>/osctl.mjs info                          # which board this folder maps to
node <path-to-this-repo>/osctl.mjs show journal
node <path-to-this-repo>/osctl.mjs journal "Title" "What happened" --done "a;b" --next "c;d"
node <path-to-this-repo>/osctl.mjs contact "Name" --role "..." --rel ally
node <path-to-this-repo>/osctl.mjs note "Heading" "<p>whiteboard note</p>"
```

This is the same API the web UI and the AI updater use — everything merges,
nothing here can wipe another writer's changes.

## Deploying

`Dockerfile` + `docker-compose.yml` build a hardened runtime image (read-only
root filesystem, dropped capabilities, non-root user) with `projects/`
bind-mounted so your data survives a rebuild. See the comments in
`docker-compose.yml` for the exact setup.

## Access

The board has **no authentication of its own beyond the one shared
password** in `.os-auth`, and by default binds only `127.0.0.1`. Set
`OS_HOST=0.0.0.0` to expose it beyond localhost — and put something in front
of it (a reverse proxy, Cloudflare Access, a VPN/tailnet) before you do,
since a single shared password is a thin layer on its own.
