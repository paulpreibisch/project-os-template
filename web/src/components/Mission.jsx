import { Box, Heading, Text, VStack, HStack, Wrap, WrapItem, Tag } from "@chakra-ui/react";

export default function Mission({ data }) {
  const m = data.mission || {};
  return (
    <VStack align="stretch" spacing={5}>
      <Box>
        <Heading fontSize="1.5rem" fontStyle="italic">Mission</Heading>
        <Text color="fuego.muted" fontSize="14px">Why this exists and who it's for.</Text>
      </Box>

      {m.statement && (
        <Box position="relative" overflow="hidden" bgGradient="linear(135deg, rgba(224,168,48,0.10), rgba(192,57,43,0.06))" border="1px solid" borderColor="fuego.gold" borderRadius="18px" p={{ base: 6, md: 8 }}>
          <Text fontSize="10px" fontWeight={700} letterSpacing="0.16em" textTransform="uppercase" color="fuego.gold" mb={3}>Mission</Text>
          <Heading fontSize={{ base: "1.4rem", md: "1.8rem" }} fontStyle="italic" lineHeight={1.3} fontWeight={800}>{m.statement}</Heading>
        </Box>
      )}

      {m.vision && (
        <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="16px" p={6}>
          <Text fontSize="10px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color="fuego.muted" mb={2}>Vision</Text>
          <Text fontSize="15px" color="fuego.text" lineHeight={1.7}>{m.vision}</Text>
        </Box>
      )}

      {m.positioning && (
        <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="16px" p={6}>
          <Text fontSize="10px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color="fuego.muted" mb={2}>Positioning</Text>
          <Text fontSize="14px" color="fuego.muted" lineHeight={1.7}>{m.positioning}</Text>
        </Box>
      )}

      {m.values?.length > 0 && (
        <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="16px" p={6}>
          <Text fontSize="10px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color="fuego.muted" mb={3}>Values</Text>
          <Wrap spacing={2}>
            {m.values.map((v, i) => (
              <WrapItem key={i}>
                <Tag size="lg" bg="rgba(224,168,48,0.10)" color="fuego.gold" border="1px solid" borderColor="rgba(224,168,48,0.3)" borderRadius="full" px={4} py={2} fontSize="13px">{v}</Tag>
              </WrapItem>
            ))}
          </Wrap>
        </Box>
      )}
    </VStack>
  );
}
