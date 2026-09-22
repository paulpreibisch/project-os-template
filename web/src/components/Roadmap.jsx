import { Box, Heading, Text, VStack, HStack, Badge, Spacer } from "@chakra-ui/react";

const PHASE = {
  done: { label: "Done", color: "#2ecc71", bg: "rgba(39,174,96,0.16)", dot: "#2ecc71" },
  active: { label: "In progress", color: "#e0a830", bg: "rgba(224,168,48,0.16)", dot: "#e0a830" },
  upcoming: { label: "Upcoming", color: "#8fa2b5", bg: "rgba(255,255,255,0.06)", dot: "#5a6a7a" },
};

export default function Roadmap({ data }) {
  const r = data.roadmap || {};
  const phases = r.phases || [];
  return (
    <VStack align="stretch" spacing={5}>
      <Box>
        <Heading fontSize="1.5rem" fontStyle="italic">Roadmap</Heading>
        <Text color="fuego.muted" fontSize="14px">Where we're taking this — and where we are right now.</Text>
      </Box>

      {r.vision && (
        <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="16px" p={6}>
          <Text fontSize="10px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color="fuego.muted" mb={2}>Where we're going</Text>
          <Text fontSize="15px" color="fuego.text" lineHeight={1.7}>{r.vision}</Text>
        </Box>
      )}

      <Box position="relative" pl={6}>
        <Box position="absolute" left="7px" top={3} bottom={3} w="2px" bg="fuego.border" />
        <VStack align="stretch" spacing={3}>
          {phases.map((p, i) => {
            const st = PHASE[p.status] || PHASE.upcoming;
            return (
              <Box key={i} position="relative">
                <Box position="absolute" left="-22px" top="16px" w="14px" h="14px" borderRadius="full" bg={st.dot} border="3px solid" borderColor="fuego.bg" />
                <Box bg="fuego.card" border="1px solid" borderColor={p.status === "active" ? "fuego.gold" : "fuego.border"} borderRadius="14px" p={5}>
                  <HStack mb={p.period || p.items?.length ? 2 : 0} align="baseline">
                    <Heading fontSize="1.05rem" fontStyle="italic">{p.title}</Heading>
                    <Spacer />
                    <Badge bg={st.bg} color={st.color} textTransform="uppercase" fontSize="9px" letterSpacing="0.06em" px={2} py="3px" borderRadius="5px">{st.label}</Badge>
                  </HStack>
                  {p.period && <Text fontSize="12px" color="fuego.faint" mb={2}>{p.period}</Text>}
                  {p.goal && <Text fontSize="13px" color="fuego.muted" mb={2} lineHeight={1.6}>{p.goal}</Text>}
                  {p.items?.length > 0 && (
                    <VStack align="stretch" spacing={1.5} mt={1}>
                      {p.items.map((it, j) => (
                        <HStack key={j} align="baseline" spacing={2}>
                          <Text fontSize="12px" color={p.status === "done" ? "fuego.green" : "fuego.faint"} flex="none">{p.status === "done" ? "✓" : "•"}</Text>
                          <Text fontSize="13px" color="fuego.text">{it}</Text>
                        </HStack>
                      ))}
                    </VStack>
                  )}
                </Box>
              </Box>
            );
          })}
        </VStack>
      </Box>
    </VStack>
  );
}
