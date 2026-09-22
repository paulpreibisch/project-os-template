// Shared helpers for the Marketing OS UI.

export function dayDiff(dateStr, from = new Date()) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T12:00:00");
  const ms = from.setHours(12, 0, 0, 0) - d.getTime();
  return Math.round(ms / 86400000);
}

export function daysToLaunch(launchDate) {
  const d = new Date(launchDate + "T18:00:00");
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

// Recency badge for "last contacted": green (fresh) → amber → red (stale)
export function recency(dateStr) {
  const n = dayDiff(dateStr);
  if (n === null) return { label: "never contacted", scheme: "gray", days: null };
  let word;
  if (n <= 0) word = "today";
  else if (n === 1) word = "yesterday";
  else word = `${n} days ago`;
  let scheme = "red";
  if (n <= 3) scheme = "green";
  else if (n <= 10) scheme = "yellow";
  return { label: word, scheme, days: n };
}

export const REL = {
  ally: { label: "Ally", color: "#2ecc71", bg: "rgba(39,174,96,0.16)", bd: "rgba(39,174,96,0.4)" },
  venue: { label: "Venue · key", color: "#e74c3c", bg: "rgba(192,57,43,0.2)", bd: "rgba(192,57,43,0.4)" },
  media: { label: "Media", color: "#5dade2", bg: "rgba(41,128,185,0.18)", bd: "rgba(41,128,185,0.35)" },
  warm: { label: "Warm", color: "#e0a830", bg: "rgba(224,168,48,0.15)", bd: "rgba(224,168,48,0.35)" },
  partner: { label: "Partner", color: "#bb8fce", bg: "rgba(142,68,173,0.2)", bd: "rgba(142,68,173,0.4)" },
  lead: { label: "Lead", color: "#27ae60", bg: "rgba(39,174,96,0.12)", bd: "rgba(39,174,96,0.35)" },
  // Personal boards (Ben's) hold family and clubs, which are neither leads nor partners.
  // Without these they fell through to "Warm", which reads oddly next to someone's mother.
  family: { label: "Family", color: "#f0a3c0", bg: "rgba(240,163,192,0.14)", bd: "rgba(240,163,192,0.4)" },
  club: { label: "Club", color: "#48c9b0", bg: "rgba(72,201,176,0.14)", bd: "rgba(72,201,176,0.4)" },
};

export const STATUS = {
  contacted: { label: "Contacted", color: "#2ecc71", bg: "rgba(39,174,96,0.16)" },
  sent: { label: "Sent", color: "#2ecc71", bg: "rgba(39,174,96,0.16)" },
  replied: { label: "Replied", color: "#5dade2", bg: "rgba(41,128,185,0.18)" },
  drafted: { label: "Drafted", color: "#e0a830", bg: "rgba(224,168,48,0.15)" },
  todo: { label: "To do", color: "#e74c3c", bg: "rgba(192,57,43,0.2)" },
};

// Dance role inferred from the first name's likely gender (set by the updater).
// lead = traditionally male, follow = traditionally female.
export const ROLE = {
  lead: { label: "Lead", color: "#5dade2", bg: "rgba(93,173,226,0.16)", icon: "♂" },
  follow: { label: "Follow", color: "#e07a9e", bg: "rgba(224,122,158,0.16)", icon: "♀" },
  unknown: { label: "—", color: "#8fa2b5", bg: "rgba(255,255,255,0.05)", icon: "?" },
};

export const roleOf = (e) => (e && ROLE[e.role] ? e.role : "unknown");

export function roleCounts(list = []) {
  const c = { lead: 0, follow: 0, unknown: 0, total: 0 };
  for (const e of list) { c[roleOf(e)]++; c.total++; }
  return c;
}

// Group leads first, then follows, then unknown; newest-joined within each.
export function sortByRole(list = []) {
  const rank = { lead: 0, follow: 1, unknown: 2 };
  return [...list].sort((a, b) =>
    rank[roleOf(a)] - rank[roleOf(b)] || (b.joined || "").localeCompare(a.joined || ""));
}

// Event titles are written for a website ("Grand Opening Night — Launch
// Party!"), not for a table cell. Left full, a long one pushes other columns
// off the right edge. Shorten for display only — the stored title, and any
// event slug built from it, are untouched. Add your own project-specific
// shortenings here if it's worth it; the length cap below is the fallback.
export function shortEvent(title) {
  const t = String(title || "").trim();
  if (!t) return "";
  return t.length > 22 ? t.slice(0, 21).trimEnd() + "…" : t;
}

// People type their number every which way — "6047988848", "+1 (604) 226-0830",
// "14039154836". Display them one consistent way so a column of them is scannable,
// and keep a dial-safe href separately (tel: wants digits, not the pretty version).
export function formatPhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return s;               // international or partial — leave as typed
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function telHref(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const plus = s.startsWith("+");
  const d = s.replace(/\D/g, "");
  if (!d) return "";
  return "tel:" + (plus ? "+" : d.length === 10 ? "+1" : d.length === 11 && d.startsWith("1") ? "+" : "") + d;
}

export const CHANNEL_ICON = {
  email: "✉️",
  "in-person": "🤝",
  lunch: "🍽️",
  phone: "📞",
  IG: "📷",
  whatsapp: "💬",
};
