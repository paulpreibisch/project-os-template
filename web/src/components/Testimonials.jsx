import { useEffect, useMemo, useState } from "react";
import {
  Box, Heading, Text, VStack, HStack, Badge, Flex, Circle, Button, useToast,
  Spacer, SimpleGrid,
} from "@chakra-ui/react";
import { useProject, apiBase } from "../project.jsx";

// Tracks testimonials/reviews for this project. New rows arrive however you
// wire them up (an inbox scan, a form, typed by hand) with status "new";
// publishing one wherever you actually publish testimonials (your site, a
// deck) is what flips it to "published" here — this board only tracks that
// moment, it doesn't perform the publish itself, so a stale "new" here means
// the publish step hasn't been run yet, not that this UI is broken.
//
// `locationGroup` is a free-text label (a venue, a market, a product line —
// whatever groups your testimonials into a meaningful filter). Leave it blank
// if you don't need the grouping.

const STATUS_STYLE = {
  new: { bg: "rgba(224,168,48,0.18)", color: "fuego.gold", label: "New" },
  published: { bg: "rgba(63,185,80,0.16)", color: "#3fb950", label: "Published" },
  dismissed: { bg: "rgba(255,255,255,0.06)", color: "fuego.faint", label: "Dismissed" },
};

export default function Testimonials() {
  const { slug } = useProject();
  const toast = useToast();
  const [doc, setDoc] = useState(null);
  const [group, setGroup] = useState("all");
  const [status, setStatus] = useState("all");

  const load = () => fetch(`${apiBase(slug)}/testimonials`, { cache: "no-store" })
    .then((r) => r.json()).then(setDoc).catch(() => setDoc({ items: [] }));

  useEffect(() => { load(); }, [slug]);

  const items = doc?.items || [];
  const groups = useMemo(() => [...new Set(items.map((t) => t.locationGroup).filter(Boolean))].sort(), [items]);
  const shown = useMemo(() => items
    .filter((t) => group === "all" || t.locationGroup === group)
    .filter((t) => status === "all" || t.status === status)
    .sort((a, b) => (b.foundAt || "").localeCompare(a.foundAt || "") || a.name.localeCompare(b.name)),
    [items, group, status]);

  const counts = useMemo(() => {
    const c = { all: items.length, new: 0, published: 0, dismissed: 0, byGroup: {} };
    for (const t of items) {
      if (t.locationGroup) c.byGroup[t.locationGroup] = (c.byGroup[t.locationGroup] || 0) + 1;
      if (t.status) c[t.status] = (c[t.status] || 0) + 1;
    }
    return c;
  }, [items]);

  const setItemStatus = async (id, next) => {
    // Optimistic — a testimonial board is read constantly and a click should feel instant.
    setDoc((d) => ({ ...d, items: d.items.map((t) => (t.id === id ? { ...t, status: next } : t)) }));
    try {
      const r = await fetch(`${apiBase(slug)}/testimonials`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: { [id]: { status: next } } }),
      });
      if (!r.ok) throw new Error(await r.text());
    } catch (e) {
      toast({ title: "Couldn't save that change", description: String(e), status: "error" });
      load(); // fall back to what's actually on disk
    }
  };

  const FilterRow = ({ value, onChange, options }) => (
    <HStack spacing={2} wrap="wrap">
      {options.map((o) => (
        <Button key={o.key} size="xs" variant={value === o.key ? "solid" : "ghost"}
          bg={value === o.key ? "fuego.gold" : undefined}
          color={value === o.key ? "#111" : "fuego.muted"}
          onClick={() => onChange(o.key)}>
          {o.label} {o.n}
        </Button>
      ))}
    </HStack>
  );

  return (
    <VStack align="stretch" spacing={5}>
      <Box>
        <Heading fontSize="1.5rem" fontStyle="italic">Testimonials</Heading>
        <Text color="fuego.muted" fontSize="14px">
          What people are saying about this project, in one place.
        </Text>
      </Box>

      <Flex
        gap={5} align="center" wrap="wrap"
        bgGradient="linear(135deg, rgba(224,168,48,0.14), rgba(224,168,48,0.03))"
        border="1px solid" borderColor="rgba(224,168,48,0.4)"
        borderRadius="18px" p={{ base: 5, md: 7 }}
      >
        <Circle size="64px" bg="rgba(224,168,48,0.18)" fontSize="2rem" flex="none">💬</Circle>
        <Box flex="1" minW="240px">
          <Text fontSize="11px" fontWeight={700} letterSpacing="0.16em" textTransform="uppercase" color="fuego.gold" mb={1}>
            What people are saying
          </Text>
          <Heading fontSize="1.3rem" fontStyle="italic" mb={2}>{counts.all} testimonial{counts.all === 1 ? "" : "s"} on file</Heading>
          <Text fontSize="13px" color="fuego.muted">
            {counts.new ? `${counts.new} new, not yet published` : "Nothing new to review"}
          </Text>
        </Box>
        {counts.new > 0 && (
          <Box textAlign="center" flex="none" px={4}>
            <Text fontFamily="heading" fontWeight={800} fontSize="3rem" color="fuego.gold" lineHeight={1}>{counts.new}</Text>
            <Text fontSize="11px" color="fuego.muted" letterSpacing="0.08em" textTransform="uppercase">need review</Text>
          </Box>
        )}
      </Flex>

      <VStack align="stretch" spacing={3}>
        {groups.length > 0 && (
          <FilterRow value={group} onChange={setGroup} options={[
            { key: "all", label: "All", n: counts.all },
            ...groups.map((g) => ({ key: g, label: g, n: counts.byGroup[g] || 0 })),
          ]} />
        )}
        <FilterRow value={status} onChange={setStatus} options={[
          { key: "all", label: "All statuses", n: counts.all },
          { key: "new", label: "New", n: counts.new },
          { key: "published", label: "Published", n: counts.published },
          { key: "dismissed", label: "Dismissed", n: counts.dismissed },
        ]} />
      </VStack>

      {!doc ? (
        <Text color="fuego.muted" fontSize="14px">Loading…</Text>
      ) : shown.length === 0 ? (
        <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="14px" p={8} textAlign="center">
          <Text color="fuego.muted" fontSize="14px">Nothing matches this filter.</Text>
        </Box>
      ) : (
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
          {shown.map((t) => (
            <Box key={t.id} bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="14px" p={5}>
              <HStack mb={2} spacing={2} wrap="wrap">
                <Badge {...STATUS_STYLE[t.status] || STATUS_STYLE.new} fontSize="9px">
                  {(STATUS_STYLE[t.status] || STATUS_STYLE.new).label}
                </Badge>
                {t.locationGroup && (
                  <Badge bg="rgba(93,173,226,0.14)" color="fuego.blue" fontSize="9px">
                    {t.locationGroup}
                  </Badge>
                )}
                {t.featured && <Badge bg="rgba(187,143,206,0.16)" color="fuego.purple" fontSize="9px">featured</Badge>}
                <Spacer />
                <Text fontSize="10px" color="fuego.faint">{t.location}</Text>
              </HStack>
              <Text fontSize="13.5px" color="fuego.text" lineHeight={1.6} noOfLines={6} mb={3}>
                “{t.quote}”
              </Text>
              <HStack justify="space-between" align="flex-end">
                <Box>
                  <Text fontWeight={600} fontSize="13px">{t.name}</Text>
                  <Text fontSize="11px" color="fuego.muted">{t.context}</Text>
                </Box>
                {t.status === "new" && (
                  <HStack spacing={2}>
                    <Button size="xs" variant="outline" borderColor="fuego.border" color="fuego.faint"
                      onClick={() => setItemStatus(t.id, "dismissed")}>
                      Dismiss
                    </Button>
                    <Button size="xs" bg="fuego.green" color="white" _hover={{ bg: "fuego.greenBright" }}
                      onClick={() => setItemStatus(t.id, "published")}
                      title="Marks it published here — actually publishing it wherever you display testimonials is a separate step">
                      Mark published
                    </Button>
                  </HStack>
                )}
                {t.status === "dismissed" && (
                  <Button size="xs" variant="ghost" color="fuego.gold" onClick={() => setItemStatus(t.id, "new")}>
                    Restore
                  </Button>
                )}
              </HStack>
            </Box>
          ))}
        </SimpleGrid>
      )}

      <Box bg="fuego.panel" border="1px solid" borderColor="fuego.border" borderRadius="12px" p={4}>
        <Text fontSize="12px" color="fuego.muted" lineHeight={1.7}>
          Add new rows however you like — by hand, or wire up a scan of wherever
          testimonials actually arrive. <b>"Mark published" records the moment
          here — it does not publish anything itself.</b> Actually publishing it
          (to your site, a deck, wherever) is a separate step you run outside this app.
        </Text>
      </Box>
    </VStack>
  );
}
