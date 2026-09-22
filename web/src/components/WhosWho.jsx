import { useState, useMemo } from "react";
import { Box, Heading, Text, SimpleGrid, HStack, VStack, Image, Circle, Badge, Link, Input, InputGroup, InputLeftElement, InputRightElement, Button, Wrap, WrapItem } from "@chakra-ui/react";
import { recency, REL, CHANNEL_ICON } from "../lib.js";
import { useProject, pubUrl } from "../project.jsx";

function Avatar({ c }) {
  const { slug } = useProject();
  if (c.photo) {
    const src = pubUrl(slug, c.photo);
    return <Image src={src} alt={c.name} boxSize="74px" borderRadius="12px" objectFit="cover" objectPosition="top center" flex="none" border="1px solid" borderColor="fuego.border" />;
  }
  const rel = REL[c.relType] || REL.warm;
  return (
    <Circle size="74px" flex="none" bg={rel.bg} color={rel.color} fontFamily="heading" fontWeight={700} fontSize="1.6rem" borderRadius="12px" border="1px solid" borderColor="fuego.border">
      {c.initials}
    </Circle>
  );
}

function ContactCard({ c }) {
  const rel = REL[c.relType] || REL.warm;
  const r = recency(c.lastContact?.date);
  const icon = CHANNEL_ICON[c.lastContact?.channel] || "•";
  return (
    <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="12px" p={4} _hover={{ borderColor: "rgba(192,57,43,0.5)" }} transition="border-color .2s">
      <HStack align="start" spacing={3.5}>
        <Avatar c={c} />
        <Box minW={0}>
          <HStack spacing={2} wrap="wrap">
            <Text fontWeight={700} fontSize="15px">{c.name}</Text>
            <Badge fontSize="9px" px={2} py="2px" borderRadius="4px" bg={rel.bg} color={rel.color} border="1px solid" borderColor={rel.bd} textTransform="uppercase" letterSpacing="0.06em">{rel.label}</Badge>
            {/* Optional provenance flag — "verify", "unconfirmed". Keeps a seeded
                card honest about what has actually been checked. */}
            {c.flag && (
              <Badge fontSize="9px" px={2} py="2px" borderRadius="4px" bg="rgba(224,168,48,0.12)" color="fuego.gold" border="1px solid" borderColor="rgba(224,168,48,0.35)" textTransform="uppercase" letterSpacing="0.06em">{c.flag}</Badge>
            )}
          </HStack>
          <Text fontSize="11px" color="fuego.gold" mt="2px" mb={2}>{c.role}</Text>
          <Text fontSize="12px" color="fuego.muted" lineHeight={1.5} mb={2}>{c.bio}</Text>

          {/* Last-contacted CRM badge. Suppressed for family with no logged contact:
              "last contact: never contacted" is a useful nudge about a venue owner and
              a nonsense claim about somebody's mother. A logged date still shows. */}
          {!(c.relType === "family" && !c.lastContact?.date) && (
            <HStack spacing={2} mb={2}>
              <Badge fontSize="10px" px={2} py="3px" borderRadius="6px" colorScheme={r.scheme} textTransform="none">
                {icon} last contact: {r.label}
              </Badge>
            </HStack>
          )}
          {c.lastContact?.note && (
            <Text fontSize="12px" color="fuego.text" lineHeight={1.5}>
              <Text as="span" color="fuego.green" fontSize="9px" textTransform="uppercase" letterSpacing="0.08em" display="block">How you're connected</Text>
              {c.lastContact.note}
            </Text>
          )}

          <HStack spacing={3} mt={2} wrap="wrap">
            {(c.links || []).map((l, i) => (
              <Link key={i} href={l.url} isExternal fontSize="11px" color="fuego.gold">{l.label} ↗</Link>
            ))}
            {c.igHandle && <Text fontSize="11px" color="fuego.faint">{c.igHandle}</Text>}
          </HStack>
        </Box>
      </HStack>
    </Box>
  );
}

export default function WhosWho({ data }) {
  const all = data.contacts || [];
  const groups = data.contactGroups || [];
  const [q, setQ] = useState("");
  const [only, setOnly] = useState(null); // group id, or null for all

  // Search across everything a person's card actually says — not just the name.
  // Looking someone up by "parking", "RCMP" or "festival" is how this gets used.
  const contacts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((c) => {
      if (only && c.group !== only) return false;
      if (!needle) return true;
      const groupLabel = groups.find((g) => g.id === c.group)?.label || "";
      const hay = [c.name, c.role, c.bio, c.flag, groupLabel, c.lastContact?.note, ...(c.links || []).map((l) => l.label)]
        .filter(Boolean).join(" ").toLowerCase();
      return needle.split(/\s+/).every((w) => hay.includes(w));
    });
  }, [all, groups, q, only]);

  // Optional grouping. A board that seeds `contactGroups` gets its people split
  // under headings in that order; a board that doesn't gets the flat grid it
  // always had. Anyone whose group is missing from the list falls to the end.
  const grouped = groups.length > 0;

  const buckets = grouped
    ? [
        ...groups.map((g) => ({ ...g, people: contacts.filter((c) => c.group === g.id) })),
        { id: "_other", label: "Everyone else", people: contacts.filter((c) => !groups.some((g) => g.id === c.group)) },
      ].filter((b) => b.people.length > 0)
    : [{ id: "_all", people: contacts }];

  return (
    <VStack align="stretch" spacing={6}>
      <Box>
        <Heading fontSize="1.5rem" fontStyle="italic">{data.contactsTitle || "Who's Who — Key Relationships"}</Heading>
        <Text color="fuego.muted" fontSize="14px">
          {data.contactsHint || "Your mini-CRM. Each card shows how you're connected and how long since your last contact (green ≤3d · amber ≤10d · red older)."}
        </Text>
      </Box>

      {/* Search + group filter */}
      <Box className="os-noprint">
        <InputGroup maxW="520px" mb={3}>
          <InputLeftElement pointerEvents="none" color="fuego.faint" fontSize="14px">🔍</InputLeftElement>
          <Input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search people, roles, or what they're connected to…"
            bg="fuego.panel" borderColor="fuego.border" size="md" borderRadius="10px" fontSize="14px"
            _placeholder={{ color: "fuego.faint" }} _hover={{ borderColor: "fuego.border" }}
            _focusVisible={{ borderColor: "fuego.gold", boxShadow: "none" }}
          />
          {q && (
            <InputRightElement>
              <Button size="xs" variant="ghost" color="fuego.faint" _hover={{ color: "fuego.gold" }} onClick={() => setQ("")}>✕</Button>
            </InputRightElement>
          )}
        </InputGroup>

        <Wrap spacing={2}>
          <WrapItem>
            <Button size="xs" variant="outline" fontWeight={500}
              borderColor={!only ? "fuego.gold" : "fuego.border"} color={!only ? "fuego.gold" : "fuego.faint"}
              bg={!only ? "rgba(224,168,48,0.08)" : "transparent"} _hover={{ borderColor: "fuego.gold" }}
              onClick={() => setOnly(null)}>All · {all.length}</Button>
          </WrapItem>
          {groups.map((g) => {
            const n = all.filter((c) => c.group === g.id).length;
            const on = only === g.id;
            return (
              <WrapItem key={g.id}>
                <Button size="xs" variant="outline" fontWeight={500}
                  borderColor={on ? "fuego.gold" : "fuego.border"} color={on ? "fuego.gold" : "fuego.faint"}
                  bg={on ? "rgba(224,168,48,0.08)" : "transparent"} _hover={{ borderColor: "fuego.gold" }}
                  onClick={() => setOnly(on ? null : g.id)}>{g.label} · {n}</Button>
              </WrapItem>
            );
          })}
        </Wrap>

        {(q || only) && (
          <Text fontSize="12px" color="fuego.faint" mt={3}>
            {contacts.length === 0
              ? "Nobody matches that."
              : `Showing ${contacts.length} of ${all.length}`}
          </Text>
        )}
      </Box>

      {buckets.map((b) => (
        <Box key={b.id}>
          {b.label && (
            <HStack mb={3} align="baseline" wrap="wrap">
              <Text fontSize="10px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color="fuego.gold">{b.label}</Text>
              {b.hint && <Text fontSize="12px" color="fuego.faint">{b.hint}</Text>}
              <Text fontSize="11px" color="fuego.faint">· {b.people.length}</Text>
            </HStack>
          )}
          <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={3.5}>
            {b.people.map((c) => <ContactCard key={c.id} c={c} />)}
          </SimpleGrid>
        </Box>
      ))}
    </VStack>
  );
}
