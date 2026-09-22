import { Box, Heading, Text, VStack, HStack, Circle, List, ListItem } from "@chakra-ui/react";

// What kind of work a bullet was. An unknown tag still renders (in grey), so a new
// category can appear in the data before this map knows about it.
export const CATEGORIES = {
  bug: "#e74c3c",
  feature: "#2ecc71",
  ux: "#bb8fce",
  content: "#5dade2",
  refactor: "#d08770",
  infra: "#6fb3b8",
  outreach: "#e88ba8",
  lead: "#a3d977",
  research: "#9aa5b1",
};
const catColor = (c) => CATEGORIES[c] || "#9e8878";

// Bullets are stored as "[category] Short title — the detail". Both parts are
// optional: split on the first em dash so the title can be picked out in gold, but
// a long head means the dash was just punctuation mid-sentence, so that line is
// left alone rather than bolding a clause.
function parseBullet(text) {
  let s = String(text ?? "");
  let category = "";
  const tag = s.match(/^\[([a-z][a-z0-9-]{0,15})\]\s*/i);
  if (tag) { category = tag[1].toLowerCase(); s = s.slice(tag[0].length); }
  const i = s.indexOf(" — ");
  if (i < 1 || i > 60) return { category, title: "", detail: s };
  return { category, title: s.slice(0, i), detail: s.slice(i + 3) };
}

function CategoryTag({ category }) {
  const c = catColor(category);
  return (
    <Text
      as="span" display="inline-block" verticalAlign="1px" mr={2}
      fontSize="9px" fontWeight={700} letterSpacing="0.08em" textTransform="uppercase"
      color={c} bg={`${c}22`} border="1px solid" borderColor={`${c}55`}
      borderRadius="5px" px="5px" py="1px" lineHeight="1.5"
    >
      {category}
    </Text>
  );
}

function Bullet({ text, marker, color, showTag = true }) {
  const { category, title, detail } = parseBullet(text);
  return (
    <ListItem fontSize="13px" display="grid" gridTemplateColumns="16px 1fr" gap={2}>
      <Text color={color} fontWeight={700}>{marker}</Text>
      <Text>
        {showTag && category && <CategoryTag category={category} />}
        {title && <Text as="span" color="fuego.gold" fontWeight={800}>{title}</Text>}
        {title && detail && <Text as="span" color="fuego.faint"> — </Text>}
        {detail}
      </Text>
    </ListItem>
  );
}

// Fixed display order, so a day always reads the same way: what broke, what got
// built, then the softer work. Anything untagged falls to the bottom.
const CAT_ORDER = ["bug", "feature", "ux", "content", "refactor", "infra", "outreach", "lead", "research"];
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? CAT_ORDER.length : i; };

function groupByCategory(items) {
  const groups = new Map();
  for (const raw of items || []) {
    const { category } = parseBullet(raw);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(raw);
  }
  return [...groups.entries()].sort((a, b) => catRank(a[0]) - catRank(b[0]));
}

// One column (Done or Next), split into per-category blocks. The tag moves to the
// block header so it isn't repeated on all 22 outreach lines.
function BulletGroups({ items, marker, color }) {
  const groups = groupByCategory(items);
  return (
    <VStack align="stretch" spacing={3.5}>
      {groups.map(([category, lines]) => (
        <Box key={category || "untagged"}>
          {category && (
            <HStack spacing={1.5} mb={1.5}>
              <CategoryTag category={category} />
              <Text fontSize="10px" color="fuego.faint" fontWeight={700}>{lines.length}</Text>
            </HStack>
          )}
          <List spacing={2.5}>
            {lines.map((x, i) => <Bullet key={i} text={x} marker={marker} color={color} showTag={false} />)}
          </List>
        </Box>
      ))}
    </VStack>
  );
}

function DayCard({ entry }) {
  const d = new Date(entry.date + "T12:00:00");
  return (
    <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="16px" p={{ base: 5, md: 6 }}>
      <HStack spacing={4} align="center" mb={3}>
        <Circle size="46px" bg="fuego.red" color="white" fontFamily="heading" fontWeight={700} fontSize="lg" flex="none">
          {entry.day}
        </Circle>
        <Box>
          <Heading fontSize="1.3rem" fontStyle="italic" fontWeight={800} color="fuego.gold" lineHeight={1.25}>
            {entry.title}
          </Heading>
          <Text fontSize="12px" color="fuego.muted">
            Day {entry.day} · {d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </Text>
        </Box>
      </HStack>

      <Text color="fuego.muted" fontSize="14px" mb={4}>{entry.summary}</Text>

      <HStack align="start" spacing={8} wrap={{ base: "wrap", md: "nowrap" }}>
        <Box flex="1" minW="240px">
          <Text fontSize="11px" fontWeight={700} letterSpacing="0.12em" textTransform="uppercase" color="fuego.green" mb={3}>✔ Done</Text>
          <BulletGroups items={entry.done} marker="✓" color="fuego.green" />
        </Box>
        <Box flex="1" minW="240px">
          <Text fontSize="11px" fontWeight={700} letterSpacing="0.12em" textTransform="uppercase" color="fuego.gold" mb={3}>⏭ Next</Text>
          <BulletGroups items={entry.next} marker="▸" color="fuego.gold" />
        </Box>
      </HStack>
    </Box>
  );
}

export default function Journal({ data }) {
  const days = [...(data.journal || [])].sort((a, b) => b.day - a.day);
  return (
    <VStack align="stretch" spacing={5}>
      <Box>
        <Heading fontSize="1.5rem" fontStyle="italic">Marketing Journal</Heading>
        <Text color="fuego.muted" fontSize="14px">A running log of the launch push — newest day first.</Text>
      </Box>
      {days.map((e) => <DayCard key={e.day} entry={e} />)}
    </VStack>
  );
}
