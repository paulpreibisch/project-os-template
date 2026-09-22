import { useEffect, useMemo, useState } from "react";
import {
  Box, Heading, Text, VStack, HStack, Badge, Table, Thead, Tbody, Tr, Th, Td,
  TableContainer, Flex, Circle, Button, useToast, Link, Input, Spacer, Avatar,
} from "@chakra-ui/react";
import { useProject } from "../project.jsx";

// The compiled contact list: everyone you can reach for this project.
//
// Read-only on purpose. It's meant to be rebuilt by your own compile script from
// whatever sources you actually have (sign-in sheets, a payment provider, a CRM
// export) — editing a row here would be silently overwritten on the next
// rebuild, so the UI never offers to.

const TIER_STYLE = {
  1: { bg: "rgba(63,185,80,0.16)", color: "#3fb950" },
  2: { bg: "rgba(93,173,226,0.16)", color: "#5dade2" },
  3: { bg: "rgba(224,168,48,0.16)", color: "#e0a830" },
  4: { bg: "rgba(255,255,255,0.08)", color: "#9aa7b4" },
};

const prettyPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  return p;
};
// Canada bridge sends to a bare international number.
const waLink = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  if (!d) return null;
  return `https://wa.me/${d}`;
};

export default function ContactList() {
  const { slug } = useProject();
  const toast = useToast();
  const [doc, setDoc] = useState(null);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState(0); // 0 = all

  useEffect(() => {
    fetch(`/api/p/${slug}/contact-list`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setDoc)
      .catch(() => setDoc({ people: [], stats: null }));
  }, [slug]);

  const people = doc?.people || [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => {
      if (tier && p.tier !== tier) return false;
      if (!needle) return true;
      return `${p.name} ${p.email} ${p.phone}`.toLowerCase().includes(needle);
    });
  }, [people, q, tier]);

  const copy = (text, label) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() =>
      toast({ title: label, status: "success", duration: 1700 }));
  };
  // Copies whatever is currently filtered, not the whole list — the point of the
  // tier filter is to send tier 1 a different message from tier 4.
  const copyEmails = () => {
    const list = [...new Set(shown.map((p) => p.email).filter(Boolean))];
    copy(list.join(", "), `Copied ${list.length} email${list.length === 1 ? "" : "s"}`);
  };
  const copyPhones = () => {
    const list = [...new Set(shown.map((p) => p.phone).filter(Boolean))];
    copy(list.join(", "), `Copied ${list.length} number${list.length === 1 ? "" : "s"}`);
  };

  const stats = doc?.stats;
  const bd = { borderBottom: "1px solid", borderColor: "rgba(51,43,38,0.5)" };

  return (
    <VStack align="stretch" spacing={5}>
      <Box>
        <Heading fontSize="1.5rem" fontStyle="italic">{doc?.title || "Contact List"}</Heading>
        <Text color="fuego.muted" fontSize="14px">
          {doc?.note || "Everyone you can reach for this project, warmest first."}
        </Text>
      </Box>

      {/* Summary */}
      <Flex
        gap={5} align="center" wrap="wrap"
        bgGradient="linear(135deg, rgba(63,185,80,0.14), rgba(224,168,48,0.05))"
        border="1px solid" borderColor="rgba(63,185,80,0.4)"
        borderRadius="18px" p={{ base: 5, md: 7 }}
      >
        <Circle size="64px" bg="rgba(63,185,80,0.18)" fontSize="2rem" flex="none">📣</Circle>
        <Box flex="1" minW="240px">
          <Text fontSize="11px" fontWeight={700} letterSpacing="0.16em" textTransform="uppercase" color="#3fb950" mb={1}>
            Contact list
          </Text>
          <Heading fontSize="1.3rem" fontStyle="italic" mb={2}>People to reach out to</Heading>
          <Text fontSize="13px" color="fuego.muted">
            {stats
              ? `${stats.withEmail} reachable by email, ${stats.withPhone} by WhatsApp, ${stats.both ?? 0} by both. ` +
                `${stats.multiSource ?? 0} of these turned up in more than one source and were merged into a single row.`
              : "Loading…"}
          </Text>
        </Box>
        <Box textAlign="center" flex="none" px={4}>
          <Text fontFamily="heading" fontWeight={800} fontSize="3rem" color="#3fb950" lineHeight={1}>
            {stats?.reachable ?? people.length}
          </Text>
          <Text fontSize="11px" color="fuego.muted" letterSpacing="0.08em" textTransform="uppercase">reachable</Text>
        </Box>
      </Flex>

      {/* Tier filters */}
      {stats?.byTier && (
        <HStack spacing={2} wrap="wrap">
          <Button size="xs" variant={tier === 0 ? "solid" : "ghost"} bg={tier === 0 ? "fuego.gold" : undefined}
            color={tier === 0 ? "#111" : "fuego.muted"} onClick={() => setTier(0)}>
            All {people.length}
          </Button>
          {stats.byTier.filter((t) => t.count > 0).map((t) => (
            <Button key={t.tier} size="xs" variant={tier === t.tier ? "solid" : "ghost"}
              bg={tier === t.tier ? TIER_STYLE[t.tier].bg : undefined}
              color={tier === t.tier ? TIER_STYLE[t.tier].color : "fuego.muted"}
              onClick={() => setTier(t.tier)}>
              {t.label} {t.count}
            </Button>
          ))}
        </HStack>
      )}

      {/* Table */}
      <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="14px" overflow="hidden">
        <HStack px={5} py={3} borderBottom="1px solid" borderColor="fuego.border" spacing={3} wrap="wrap">
          <Input
            size="sm" maxW="260px" placeholder="Search name, email or phone"
            value={q} onChange={(e) => setQ(e.target.value)}
            bg="fuego.panel" borderColor="fuego.border"
          />
          <Badge bg="rgba(63,185,80,0.16)" color="#3fb950">{shown.length} shown</Badge>
          <Spacer />
          <Button size="xs" variant="ghost" color="fuego.gold" onClick={copyEmails}>Copy emails</Button>
          <Button size="xs" variant="ghost" color="fuego.gold" onClick={copyPhones}>Copy numbers</Button>
        </HStack>

        {!doc ? (
          <Text p={6} color="fuego.muted" fontSize="14px">Loading…</Text>
        ) : shown.length === 0 ? (
          <Text p={6} color="fuego.muted" fontSize="14px">Nothing matches that filter.</Text>
        ) : (
          <TableContainer>
            <Table size="sm" variant="unstyled">
              <Thead>
                <Tr>
                  {["#", "Person", "Reach", "Where from", "Notes"].map((h) => (
                    <Th key={h} color="fuego.muted" fontSize="10px" letterSpacing="0.12em"
                      borderBottom="1px solid" borderColor="fuego.border" py={3}>{h}</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {shown.map((p, i) => (
                  <Tr key={(p.email || p.phone || p.name) + i} _hover={{ bg: "rgba(255,255,255,0.02)" }}>
                    <Td {...bd} color="fuego.faint" fontSize="12px">{i + 1}</Td>
                    <Td {...bd}>
                      <HStack spacing={2.5}>
                        <Avatar size="xs" name={p.name || p.email} />
                        <Box>
                          <HStack spacing={1.5}>
                            <Text fontWeight={600} fontSize="13px">{p.name || "(no name)"}</Text>
                            {p.paid && <Badge fontSize="8px" bg="rgba(63,185,80,0.16)" color="#3fb950">paid</Badge>}
                            {p.confidence === "low" && (
                              <Badge fontSize="8px" bg="rgba(248,81,73,0.16)" color="#f85149" title="Handwriting was ambiguous — check before sending">
                                check
                              </Badge>
                            )}
                          </HStack>
                          <HStack spacing={1} fontSize="10px" color="fuego.faint">
                            {p.sheetPage && <Text>sheet p{p.sheetPage}</Text>}
                            {p.sourceCount > 1 && (
                              <Text color="fuego.blue" title={p.sources.join(", ")}>
                                · merged from {p.sourceCount} sources
                              </Text>
                            )}
                          </HStack>
                        </Box>
                      </HStack>
                    </Td>
                    <Td {...bd} fontSize="12px">
                      <VStack align="start" spacing={0.5}>
                        {p.email && <Link href={`mailto:${p.email}`} color="fuego.gold">{p.email}</Link>}
                        {p.phone && (
                          <Link href={waLink(p.phone)} isExternal color="fuego.blue">
                            {prettyPhone(p.phone)}
                          </Link>
                        )}
                        {!p.email && !p.phone && <Text color="fuego.faint">no contact details</Text>}
                      </VStack>
                    </Td>
                    <Td {...bd}>
                      <Badge {...TIER_STYLE[p.tier]} fontSize="9px">{p.tierLabel}</Badge>
                    </Td>
                    <Td {...bd} fontSize="11px" color="fuego.muted" maxW="220px">{p.note}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
        )}
      </Box>

      <Box bg="fuego.panel" border="1px solid" borderColor="fuego.border" borderRadius="12px" p={4}>
        <Text fontSize="12px" color="fuego.muted" lineHeight={1.7}>
          <b>Before you send.</b> {stats?.lowConfidence ?? 0} addresses are marked{" "}
          <Badge fontSize="8px" bg="rgba(248,81,73,0.16)" color="#f85149">check</Badge>{" "}
          — a bounced send costs deliverability while a typo'd one reaches a stranger. Check your
          local email/marketing regulations before sending to anyone on this list — every message
          still needs a working way to opt out. This list is read-only; rebuild it with your own
          compile script under <code>scripts/</code>.
        </Text>
      </Box>
    </VStack>
  );
}
