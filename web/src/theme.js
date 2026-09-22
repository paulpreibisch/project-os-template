import { extendTheme } from "@chakra-ui/react";

// Default palette (the app's built-in "fuego" token set). Any project can
// override these via its own config.json's `theme` block.
const DEFAULT = {
  red: "#c0392b",
  accent: "#e74c3c",
  gold: "#e0a830",
  green: "#27ae60",
  greenBright: "#2ecc71",
  blue: "#5dade2",
  purple: "#bb8fce",
  bg: "#0f0d0d",
  panel: "#1a1614",
  card: "#221e1b",
  border: "#332b26",
  text: "#f0e8e0",
  muted: "#9e8878",
  faint: "#6b5a4f",
  selection: "rgba(224,168,48,0.3)",
};

// Build a Chakra theme from a project palette. Token NAMES stay `fuego.*` so every
// component works unchanged — only the values swap per project.
export function makeTheme(colors = {}) {
  const c = { ...DEFAULT, ...colors };
  return extendTheme({
    config: { initialColorMode: "dark", useSystemColorMode: false },
    colors: {
      fuego: {
        red: c.red, accent: c.accent, gold: c.gold, green: c.green, greenBright: c.greenBright,
        blue: c.blue, purple: c.purple, bg: c.bg, panel: c.panel, card: c.card, border: c.border,
        text: c.text, muted: c.muted, faint: c.faint,
      },
    },
    fonts: {
      heading: `'Playfair Display', Georgia, serif`,
      body: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
    },
    styles: {
      global: {
        "html, body, #root": { height: "100%" },
        body: { bg: "fuego.bg", color: "fuego.text" },
        "::selection": { background: c.selection || "rgba(224,168,48,0.3)" },
        "::-webkit-scrollbar": { width: "10px", height: "10px" },
        "::-webkit-scrollbar-thumb": { background: c.border, borderRadius: "6px" },

        // Printing. The board is a dark screen app; on paper it has to be a
        // black-on-white sheet with no chrome, because the thing being printed
        // is a working document somebody writes on — a door list, a roster.
        //
        // Three classes do all of it, app-wide:
        //   .os-chrome     the app's own header/nav/footer — never printed
        //   .os-noprint    a control that means nothing on paper (buttons, filters)
        //   .os-onlyprint  the paper stand-in for one of those controls
        "@media print": {
          "@page": { margin: "12mm" },
          "html, body, #root": { height: "auto !important", background: "#fff !important" },
          body: { background: "#fff !important", color: "#000 !important" },
          ".os-chrome, .os-noprint": { display: "none !important" },
          ".os-onlyprint": { display: "block !important" },
          "td .os-onlyprint, th .os-onlyprint": { display: "inline-block !important" },
          // A row is a row: `display:block` on a <tr> would collapse the table.
          "tr.os-onlyprint": { display: "table-row !important" },
          // Chakra colours come from emotion classes, so paper has to shout.
          ".os-sheet, .os-sheet *": {
            color: "#000 !important",
            background: "transparent !important",
            borderColor: "#999 !important",
            boxShadow: "none !important",
          },
          ".os-sheet": { maxWidth: "none !important", padding: "0 !important" },
          ".os-sheet table": { width: "100%", borderCollapse: "collapse" },
          ".os-sheet th, .os-sheet td": {
            borderBottom: "1px solid #999 !important",
            padding: "5px 4px !important",
            fontSize: "10pt !important",
            whiteSpace: "normal !important",
            // Screen min/max widths are sized for a 1400px board. On a sheet of
            // paper they push the last column off the edge, so the page decides
            // the widths instead.
            minWidth: "0 !important",
            maxWidth: "none !important",
          },
          // A write-on line fills whatever its column ends up being, rather than
          // demanding a width and forcing the table wider than the page.
          ".os-sheet .os-rule": { minWidth: "0 !important", width: "100% !important" },
          ".os-sheet th": { borderBottom: "1.5px solid #000 !important" },
          // Cells wrap by default so a long name is never cut off. Two exceptions:
          // a name still needs enough room not to break after every word, and a
          // short fact like "paid $15.00" must not split across lines.
          ".os-sheet .os-nowrap": { whiteSpace: "nowrap !important" },
          ".os-sheet .os-col-name": { minWidth: "128px !important" },
          ".os-sheet tr": { pageBreakInside: "avoid" },
        },
      },
    },
  });
}

export default makeTheme();
