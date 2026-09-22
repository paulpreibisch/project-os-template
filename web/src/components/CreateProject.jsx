import { useEffect, useMemo, useState } from "react";
import {
  Box, Heading, Text, VStack, HStack, Button, Input, Textarea, Badge, Spacer,
  useToast, Code,
} from "@chakra-ui/react";

const slugify = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function CreateProject({ projects = [], onSwitch }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [slug, setSlug] = useState("");
  const [live, setLive] = useState([]); // slugs currently registered

  // Keep slug in sync with the name until the user hand-edits the slug.
  useEffect(() => { if (!slugEdited) setSlug(slugify(name)); }, [name, slugEdited]);

  // Poll the registry so the moment the scaffold runs, this page lights up.
  useEffect(() => {
    let on = true;
    const tick = () =>
      fetch("/api/projects", { cache: "no-store" })
        .then((r) => r.json())
        .then((list) => { if (on) setLive(list.map((p) => p.slug)); })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 4000);
    return () => { on = false; clearInterval(t); };
  }, []);

  const exists = slug && live.includes(slug);
  const nm = name || slug || "New Project";

  const prompt = useMemo(() => {
    const s = slug || "my-project";
    return [
      `Set up a "Project OS" board for THIS project.`,
      ``,
      `Run this command from your Project OS checkout (from anywhere, if it's on your`,
      `PATH), filling --dir with the absolute path of the current project folder —`,
      `get it by running \`pwd\` first:`,
      ``,
      `  node scaffold.mjs ${s} "${nm}" --dir "<absolute path to this folder>"`,
      ``,
      `Notes:`,
      `- slug = ${s}  (lowercase, dashes)   name = ${nm}`,
      `- --dir wires the board's Journal to auto-update from the Claude Code sessions`,
      `  you run in this folder.`,
      `- If it prints "already exists", tell me and stop — don't overwrite.`,
      `- After it runs, confirm the board is live at http://localhost:4317/${s}`,
      `  and tell me it now appears in the project dropdown.`,
    ].join("\n");
  }, [slug, nm]);

  const copy = (text, label) =>
    navigator.clipboard.writeText(text).then(() =>
      toast({ title: label, status: "success", duration: 1600 }));

  return (
    <VStack align="stretch" spacing={6} maxW="820px">
      <Box>
        <Heading fontSize="1.6rem" fontStyle="italic">Create a new project OS</Heading>
        <Text color="fuego.muted" fontSize="14px">
          Spin up a fresh board — Dashboard, Journal, Mission, Goals, Roadmap, Who's Who,
          Contact List, Testimonials &amp; Whiteboard — for any project folder where you run
          Claude Code. It joins the dropdown up top automatically.
        </Text>
      </Box>

      {/* Name / slug */}
      <HStack align="end" spacing={4} wrap="wrap">
        <Box flex="1" minW="220px">
          <Text fontSize="11px" color="fuego.muted" mb={1} letterSpacing="0.06em" textTransform="uppercase">Project name</Text>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Client Website Redesign" bg="fuego.panel" borderColor="fuego.border" />
        </Box>
        <Box flex="1" minW="220px">
          <Text fontSize="11px" color="fuego.muted" mb={1} letterSpacing="0.06em" textTransform="uppercase">Slug (URL id)</Text>
          <Input
            value={slug}
            onChange={(e) => { setSlugEdited(true); setSlug(slugify(e.target.value)); }}
            placeholder="client-website-redesign"
            fontFamily="mono"
            bg="fuego.panel"
            borderColor={exists ? "fuego.gold" : "fuego.border"}
          />
        </Box>
      </HStack>

      {/* Paste-prompt */}
      <Box bg="fuego.card" border="1px solid" borderColor="fuego.gold" borderRadius="14px" overflow="hidden">
        <HStack px={4} py={2.5} borderBottom="1px solid" borderColor="fuego.border" bg="rgba(224,168,48,0.06)">
          <Text fontSize="12px" fontWeight={700} letterSpacing="0.1em" textTransform="uppercase" color="fuego.gold">
            Prompt for Claude Code
          </Text>
          <Badge bg="rgba(39,174,96,0.16)" color="fuego.green" fontSize="9px">live</Badge>
          <Spacer />
          <Button size="xs" bg="fuego.gold" color="#111" _hover={{ bg: "#f0b840" }} onClick={() => copy(prompt, "Prompt copied")}>Copy prompt</Button>
        </HStack>
        <Textarea
          value={prompt}
          isReadOnly
          rows={prompt.split("\n").length + 1}
          fontFamily="mono"
          fontSize="12.5px"
          lineHeight={1.6}
          bg="fuego.panel"
          border="0"
          borderRadius="0"
          resize="vertical"
          color="fuego.text"
          _focusVisible={{ boxShadow: "none" }}
        />
      </Box>

      {/* Result — lights up when the scaffold has run */}
      <Box
        bg={exists ? "rgba(39,174,96,0.10)" : "fuego.panel"}
        border="1px solid"
        borderColor={exists ? "fuego.green" : "fuego.border"}
        borderRadius="14px"
        p={5}
      >
        {exists ? (
          <HStack spacing={4} wrap="wrap">
            <Box>
              <Text fontWeight={700} color="fuego.green">✓ “{nm}” is live</Text>
              <Text fontSize="13px" color="fuego.muted">It's now in the project dropdown at the top-left.</Text>
            </Box>
            <Spacer />
            <Button
              bg="fuego.green" color="#06251a" _hover={{ bg: "fuego.greenBright" }}
              onClick={() => (onSwitch ? onSwitch(slug) : (window.location.href = `/${slug}`))}
            >
              Open {nm} OS →
            </Button>
          </HStack>
        ) : (
          <HStack spacing={3}>
            <Box w="9px" h="9px" borderRadius="full" bg="fuego.faint" />
            <Text fontSize="13px" color="fuego.muted">
              Waiting for <Code bg="transparent" color="fuego.gold" px={0}>{slug || "your-slug"}</Code> to be scaffolded… this panel turns green the moment it runs.
            </Text>
          </HStack>
        )}
      </Box>
    </VStack>
  );
}
