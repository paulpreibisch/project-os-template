import { Box, SimpleGrid, Text, Heading, HStack, VStack, Button, Flex, Spacer } from "@chakra-ui/react";

function Stat({ n, label, accent }) {
  return (
    <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="14px" p={4}>
      <Text fontFamily="heading" fontWeight={700} fontSize="2rem" lineHeight={1} color={accent ? "fuego.gold" : "fuego.text"}>
        {n}
      </Text>
      <Text fontSize="12px" color="fuego.muted" mt={1}>{label}</Text>
    </Box>
  );
}

function Fact({ label, children }) {
  return (
    <Box>
      <Text fontSize="10px" fontWeight={700} letterSpacing="0.12em" textTransform="uppercase" color="fuego.muted">{label}</Text>
      <Text fontSize="13px" mt="2px">{children}</Text>
    </Box>
  );
}

function Dashboard({ data, config = {}, onNav }) {
  const brand = config.brand || {};
  const meta = data.meta || {};
  const stats = data.stats || {};
  const modules = (config.modules || []).filter((m) => m.id !== "dashboard");
  const latest = [...(data.journal || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];

  return (
    <VStack align="stretch" spacing={7}>
      <Box
        position="relative" overflow="hidden"
        bgGradient={config.theme?.heroGradient || "linear(135deg, #0d1420 0%, #12233a 45%, #0d1420 100%)"}
        border="1px solid" borderColor="fuego.border" borderRadius="20px" p={{ base: 6, md: 9 }}
      >
        <Box position="absolute" inset={0} bgGradient={config.theme?.heroGlow || "radial(ellipse 80% 60% at 15% 0%, rgba(93,173,226,0.20), transparent 70%)"} pointerEvents="none" />
        <Text position="relative" color="fuego.gold" fontSize="12px" fontWeight={700} letterSpacing="0.2em" textTransform="uppercase" mb={2}>
          {brand.kicker || "Project board"} · Day {meta.dayCount || 1}
        </Text>
        <Heading position="relative" fontSize={{ base: "2rem", md: "3rem" }} fontWeight={900} lineHeight={1.04} fontStyle="italic">
          {meta.project || brand.name}
        </Heading>
        {(meta.tagline || data.overview) && (
          <Text position="relative" color="fuego.muted" mt={3} maxW="60ch" fontSize={{ base: "14px", md: "15px" }} lineHeight={1.6}>
            {meta.tagline || data.overview}
          </Text>
        )}
      </Box>

      {Object.keys(stats).length > 0 && (
        <SimpleGrid columns={{ base: 2, sm: 3, md: Math.min(6, Object.keys(stats).length) }} spacing={3}>
          {Object.entries(stats).map(([k, v], i) => (
            <Stat key={k} n={v} label={k.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase())} accent={i % 2 === 0} />
          ))}
        </SimpleGrid>
      )}

      {data.overview && meta.tagline && (
        <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="16px" p={6}>
          <Text fontSize="11px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color="fuego.muted" mb={3}>Overview</Text>
          <Text fontSize="14px" color="fuego.text" lineHeight={1.7}>{data.overview}</Text>
        </Box>
      )}

      {latest && (
        <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="16px" p={6}>
          <HStack mb={2}>
            <Text fontSize="11px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color="fuego.muted">Latest update</Text>
            <Spacer />
            <Text fontSize="11px" color="fuego.faint">{latest.date}</Text>
          </HStack>
          <Heading fontSize="1.1rem" fontStyle="italic" fontWeight={800} color="fuego.gold" lineHeight={1.3} mb={2}>
            {latest.title || `Day ${latest.day}`}
          </Heading>
          <Text fontSize="14px" color="fuego.muted" lineHeight={1.6}>{latest.summary}</Text>
        </Box>
      )}

      <Flex gap={3} wrap="wrap">
        {(data.links || []).map((l, i) => (
          <Button key={i} as="a" href={l.url} target="_blank" size="sm" variant="outline" borderColor="fuego.gold" color="fuego.gold" _hover={{ bg: "rgba(224,168,48,0.1)" }}>{l.label} ↗</Button>
        ))}
        {modules.map((m) => (
          <Button key={m.id} size="sm" variant="ghost" color="fuego.muted" onClick={() => onNav(m.id)}>{m.label} →</Button>
        ))}
      </Flex>
    </VStack>
  );
}

export default Dashboard;
