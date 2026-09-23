---
name: onboard
description: Interview the user to fill in their Project OS board's Mission, Goals and Roadmap with real content, then ask whether they also want Who's Who, Contact List or Testimonials started. Use when the user says "help me fill in my board", "onboard my project", "let's set up mission and goals", "fill in the prompts", or opens a freshly-scaffolded board that's still full of prompt text instead of real content.
---

# Onboard a Project OS board

Turns a board's prompt placeholders (see `projects/demo/` for what those look like)
into real content, by interviewing the user — not by guessing or inventing answers.
Every field either comes from something the user actually said, or is left as its
original prompt for them to fill in later.

## 1. Find the target project

- If the current directory (or an ancestor) has a **`.project-os.json`** marker,
  that names the board: read its `slug` and `osRoot`.
- Otherwise, if you're at the root of a Project OS checkout (has `scaffold.mjs` and
  `projects/`), list `projects/*/config.json` and ask which one, or offer to run
  `node scaffold.mjs <slug> "Project Name"` first if there isn't one yet.
- Either way you end up with `<osRoot>/projects/<slug>/`. Read
  `config.json` (for `modules[]` and `brand.name`) and `data/marketing.json`
  (for current content) before asking anything — don't re-ask for something
  that's already been filled in.

## 2. Interview — one section at a time, in conversation

Ask like a person, not a form. One or two questions per message, follow-ups
where the answer is thin, and skip a section entirely if the user says they'd
rather come back to it later — leave its existing prompt text untouched in
that case.

**Mission** (`data.mission`)
- statement — "What's the one-sentence version — what would you tell a stranger this is?"
- vision — "Where does this go in 12 months if it's working?"
- positioning — "What's the obvious alternative, and why are you different — and for whom?"
- values — a short list, 3-5 words each; ask for them one at a time or as a list

**Goals** (`data.goals`, `data.goalsHorizon`)
- First ask the timeframe these goals are measured against (this quarter / this
  launch / this year — `goalsHorizon`).
- Then loop: title, the metric that proves it's done, a target number (and unit,
  if it's numeric), and one line on why it matters (`note`). Ask "any more goals?"
  after each one until they say no. `status` defaults to `"on-track"` unless they
  say otherwise; `current`/`baseline` stay `null` unless they give real numbers.

**Roadmap** (`data.roadmap`)
- vision — one paragraph: where this ends up if everything goes right.
- Then loop through phases: title, period (a rough date range is fine), the one
  thing that has to be true by the end of it (`goal`), and a short list of
  concrete work items. Ask "what's next after that?" until they say that's it.
  Leave the last phase's `status` as `"upcoming"` and the first as `"active"`
  unless told otherwise.

## 3. Ask about the other modules

Once Mission/Goals/Roadmap are done, ask which of the remaining modules they
want live on the board, as a single multi-select question (use AskUserQuestion
if available) — **Who's Who**, **Contact List**, **Testimonials** — explaining
in one line each:
- Who's Who — the people connected to this project; you can interview for a
  first contact right now the same way as Goals, above (name, role, one-line
  bio, last contact note).
- Contact List — read-only by design, meant to be rebuilt by their own compile
  script later (see the main README). Not something to interview for; just
  confirm whether the tab should be visible.
- Testimonials — a place quotes land over time. Same deal — confirm visibility,
  don't fabricate a testimonial.

For each one they want that isn't already in `config.json`'s `modules[]`, add it
(keep the existing id/label conventions — see `projects/demo/config.json`). If
they decline one that's already present, leave it — don't remove modules a user
didn't ask to remove.

If they ask for something that isn't one of these three — a genuinely new kind
of tab — that's a code change, not a data change: tell them so, and point them
at `README.md`'s "The shape of it" section rather than attempting it here.

## 4. Write it back

- **Merge, don't replace.** Read `data/marketing.json` fresh, change only the
  fields covered above, and write the whole object back — untouched fields
  (`journal`, `overview`, `stats`, existing `contacts`, etc.) must survive
  exactly as they were.
- If you added modules, edit `config.json`'s `modules[]` the same way — append,
  don't rewrite the array from scratch.
- No server restart or rebuild needed — both files are read fresh per request;
  `modules[]` is plain config, not baked into the web bundle.
- Read back what you wrote and summarize it to the user in a few lines —
  don't just say "done."

## Guardrails

- Never invent a mission statement, a goal, or a person to make a section look
  complete. An unanswered field keeps its original prompt text — that's a
  correct, honest state for this board, not a failure.
- Don't touch `journal`, `contactList`, or `testimonials` content beyond what's
  explicitly asked for in step 3 — this skill is about Mission/Goals/Roadmap
  plus module visibility, not a general-purpose board editor.
- If a `.project-os.json` marker's `osUrl` points somewhere other than
  localhost, this is a **live** board — say so before writing, the same way
  the `project-os` skill does.
