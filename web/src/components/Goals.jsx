import { useEffect, useState } from "react";
import {
  Box, Heading, Text, VStack, HStack, Badge, Spacer, Progress, Button, Wrap, WrapItem,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton,
  useDisclosure, useToast, Divider, Link,
} from "@chakra-ui/react";
import { useProject, apiBase } from "../project.jsx";

// A goal like "contact 12 clubs" is really "send an email", and the goal card had
// nowhere to put the email. Drafts live in their own file (drafts.json) rather than
// in marketing.json, because the AI updater rewrites that file wholesale and a
// drafted email must read the same tomorrow as it does today.
//
// A draft attaches itself to a goal by `goalTitle`, so nothing has to be added to
// marketing.json for the link to appear — which is the point: the updater cannot
// break the connection by rewriting a field it doesn't know about.

const GS = {
  "on-track": { label: "On track", color: "#2ecc71", scheme: "green" },
  "at-risk": { label: "At risk", color: "#e0a830", scheme: "yellow" },
  behind: { label: "Behind", color: "#e74c3c", scheme: "red" },
  done: { label: "Done", color: "#2ecc71", scheme: "green" },
};

// A goal is a journey from somewhere to somewhere, and the bar used to compute
// current/target — so "gain weight from 124 lbs to 148" rendered as 84% complete
// on day one. Flattering, and wrong in the direction that matters.
//
// `baseline` fixes it, and its sign does double duty: when target is BELOW the
// baseline (a sprint time, a cost) progress still runs 0→100 as the number falls,
// so a separate "lower is better" flag would be redundant.
//
// A goal with no measurement yet (`current: null`) gets no bar at all. A zero-width
// bar and "not measured yet" are different claims, and only one of them is true.
function progress(g) {
  const target = Number(g.target);
  if (!g.target || !Number.isFinite(target)) return null;

  const raw = g.current;
  const current = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(current)) return { untested: true };

  const hasBase = g.baseline !== null && g.baseline !== undefined && Number.isFinite(Number(g.baseline));
  const base = hasBase ? Number(g.baseline) : 0;
  const span = target - base;
  if (span === 0) return { pct: current === target ? 100 : 0, base, hasBase };

  const pct = Math.round(Math.min(100, Math.max(0, ((current - base) / span) * 100)));
  return { pct, base, hasBase };
}

const mailtoHref = (d) => {
  // Only a real address belongs in a mailto:. `to` doubles as an instruction
  // ("first-team manager AND reserve manager"), so anything without an @ opens
  // a blank compose window instead of a broken one.
  const to = /@/.test(d.to || "") ? d.to.trim() : "";
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(d.subject || "")}&body=${encodeURIComponent(d.body || "")}`;
};

function DraftModal({ draft, guidance, isOpen, onClose }) {
  const toast = useToast();
  if (!draft) return null;

  const copy = () => {
    const text = `To: ${draft.to || ""}\nSubject: ${draft.subject || ""}\n\n${draft.body || ""}`;
    navigator.clipboard?.writeText(text).then(
      () => toast({ title: "Draft copied", status: "success", duration: 2000, isClosable: true }),
      () => toast({ title: "Couldn't copy — select the text instead", status: "error", duration: 3000 }),
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside" isCentered>
      <ModalOverlay bg="rgba(0,0,0,0.72)" />
      <ModalContent bg="fuego.panel" border="1px solid" borderColor="fuego.border" borderRadius="16px" mx={4}>
        <ModalHeader pb={2}>
          <Text fontSize="11px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color="fuego.muted">
            Draft email
          </Text>
          <Heading fontSize="1.15rem" fontStyle="italic" mt={1}>{draft.label}</Heading>
        </ModalHeader>
        <ModalCloseButton color="fuego.muted" />
        <ModalBody pb={6}>
          <VStack align="stretch" spacing={3}>
            <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="12px" p={4}>
              <HStack align="baseline" mb={1} spacing={2}>
                <Text fontSize="11px" color="fuego.muted" minW="52px">To</Text>
                <Text fontSize="13px" color="fuego.text" fontWeight={600}>{draft.to}</Text>
              </HStack>
              <HStack align="baseline" spacing={2}>
                <Text fontSize="11px" color="fuego.muted" minW="52px">Subject</Text>
                <Text fontSize="13px" color="fuego.text" fontWeight={600}>{draft.subject}</Text>
              </HStack>
              <Divider borderColor="fuego.border" my={3} />
              <Text fontSize="13.5px" color="fuego.text" lineHeight={1.7} whiteSpace="pre-wrap">
                {draft.body}
              </Text>
            </Box>

            <Wrap spacing={2} className="os-noprint">
              <WrapItem><Button size="sm" onClick={copy} bg="fuego.card" color="fuego.text" border="1px solid" borderColor="fuego.border" _hover={{ borderColor: "fuego.accent" }}>Copy draft</Button></WrapItem>
              <WrapItem><Button size="sm" as="a" href={mailtoHref(draft)} bg="fuego.accent" color="fuego.bg" _hover={{ opacity: 0.9 }}>Open in mail app</Button></WrapItem>
            </Wrap>

            {draft.note && (
              <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="12px" p={4}>
                <Text fontSize="11px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color="fuego.muted" mb={2}>
                  Why it's written this way
                </Text>
                <Text fontSize="13px" color="fuego.muted" lineHeight={1.6}>{draft.note}</Text>
              </Box>
            )}

            {!!guidance?.length && (
              <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="12px" p={4}>
                <Text fontSize="11px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color="fuego.muted" mb={2}>
                  Before sending
                </Text>
                <VStack align="stretch" spacing={2}>
                  {guidance.map((g, i) => (
                    <Text key={i} fontSize="13px" color="fuego.muted" lineHeight={1.6}>{g}</Text>
                  ))}
                </VStack>
              </Box>
            )}
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export default function Goals({ data }) {
  const goals = data.goals || [];
  const horizon = data.goalsHorizon;
  const { slug } = useProject();
  const [drafts, setDrafts] = useState({ items: [], guidance: [] });
  const [active, setActive] = useState(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  useEffect(() => {
    let live = true;
    fetch(`${apiBase(slug)}/drafts`)
      .then((r) => r.json())
      .then((d) => { if (live) setDrafts(d || { items: [], guidance: [] }); })
      .catch(() => {});
    return () => { live = false; };
  }, [slug]);

  const open = (d) => { setActive(d); onOpen(); };

  return (
    <VStack align="stretch" spacing={5}>
      <Box>
        <Heading fontSize="1.5rem" fontStyle="italic">Goals</Heading>
        <Text color="fuego.muted" fontSize="14px">{horizon || "What we're measuring ourselves against."}</Text>
      </Box>

      <VStack align="stretch" spacing={3}>
        {goals.map((g, i) => {
          const st = GS[g.status] || GS["on-track"];
          const p = progress(g);
          const unit = g.unit ? ` ${g.unit}` : "";
          const mine = (drafts.items || []).filter((d) => d.goalTitle === g.title);
          return (
            <Box key={i} bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="14px" p={5}>
              <HStack align="baseline" mb={1}>
                <Heading fontSize="1.05rem" fontStyle="italic">{g.title}</Heading>
                <Spacer />
                <Badge bg={`rgba(0,0,0,0.2)`} color={st.color} border="1px solid" borderColor={st.color} textTransform="uppercase" fontSize="9px" letterSpacing="0.06em" px={2} py="3px" borderRadius="5px">{st.label}</Badge>
              </HStack>
              {g.metric && <Text fontSize="13px" color="fuego.muted" mb={p ? 3 : 0}>{g.metric}</Text>}

              {p?.untested && (
                <HStack mb={1}>
                  <Text fontSize="12px" color="fuego.gold" fontWeight={600}>Not measured yet</Text>
                  <Spacer />
                  <Text fontSize="12px" color="fuego.muted">target {g.target}{unit}</Text>
                </HStack>
              )}

              {p && !p.untested && (
                <>
                  <HStack mb={1}>
                    <Text fontSize="12px" color="fuego.text" fontWeight={600}>{g.current}{unit}</Text>
                    <Spacer />
                    <Text fontSize="12px" color="fuego.muted">
                      {p.hasBase ? `from ${p.base}${unit} · ` : ""}target {g.target}{unit} · {p.pct}%
                    </Text>
                  </HStack>
                  <Progress value={p.pct} size="sm" borderRadius="full" colorScheme={st.scheme} bg="rgba(255,255,255,0.06)" />
                </>
              )}
              {g.note && <Text fontSize="13px" color="fuego.muted" mt={2} lineHeight={1.6}>{g.note}</Text>}

              {/* Every number in a goal note should be checkable. The reader this was
                  built for assumes an AI made the statistics up, and the honest answer
                  to that is not "trust me" — it is a link to the study. */}
              {!!g.sources?.length && (
                <Box mt={3} pt={3} borderTop="1px solid" borderColor="fuego.border">
                  <Text fontSize="9px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color="fuego.faint" mb={2}>
                    Where these numbers come from
                  </Text>
                  <VStack align="stretch" spacing={1.5}>
                    {g.sources.map((s, k) => (
                      <Box key={k}>
                        {/* A source with no URL is not a broken link — it is a number
                            nobody can check, and saying so is the entire point. */}
                        {s.url ? (
                          <Link href={s.url} isExternal fontSize="12px" color="fuego.accent" _hover={{ textDecoration: "underline" }}>
                            {s.label} ↗
                          </Link>
                        ) : (
                          <Text as="span" fontSize="12px" color="fuego.gold" fontWeight={600}>{s.label}</Text>
                        )}
                        {s.claim && <Text as="span" fontSize="11px" color="fuego.faint"> — {s.claim}</Text>}
                      </Box>
                    ))}
                  </VStack>
                </Box>
              )}

              {!!mine.length && (
                <Wrap spacing={2} mt={3} className="os-noprint">
                  {mine.map((d) => (
                    <WrapItem key={d.id}>
                      <Button
                        size="xs" variant="link" color="fuego.accent" fontSize="13px" fontWeight={600}
                        _hover={{ textDecoration: "underline" }}
                        onClick={() => open(d)}
                      >
                        ✉️ {d.label}
                      </Button>
                    </WrapItem>
                  ))}
                </Wrap>
              )}
            </Box>
          );
        })}
      </VStack>

      <DraftModal draft={active} guidance={drafts.guidance} isOpen={isOpen} onClose={onClose} />
    </VStack>
  );
}
