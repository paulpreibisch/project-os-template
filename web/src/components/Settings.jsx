import { useEffect, useState, useCallback } from "react";
import { Box, Heading, Text, VStack, HStack, Select, Switch, Button, Badge, Spinner, Wrap, WrapItem, Divider, useToast } from "@chakra-ui/react";
import { useProject, apiBase } from "../project.jsx";

// A Claude sessions folder name is the project path with separators flattened:
// C--Users-alex-myproject  ->  C:/Users/alex/myproject. Show the readable form.
const pretty = (name) => String(name).replace(/^([A-Z])--/, "$1:/").replace(/-/g, "/");
const isGlobal = (name) => /^C--Users-[^-]+$/.test(name);

const SOURCES = [
  { key: "sessions", label: "Claude Code sessions", hint: "What you and the AI actually did, per day, in the folders selected below." },
];

export default function Settings() {
  const { slug } = useProject();
  const toast = useToast();
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase(slug)}/settings`, { cache: "no-store" });
      setS(await r.json());
    } catch (e) { toast({ title: "Couldn't load settings", description: String(e), status: "error" }); }
  }, [slug, toast]);

  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    setSaving(true);
    try {
      const r = await fetch(`${apiBase(slug)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (j.ok) { setS((prev) => ({ ...prev, ...j.settings })); toast({ title: "Saved", status: "success", duration: 2000 }); }
    } catch (e) { toast({ title: "Couldn't save", description: String(e), status: "error" }); }
    setSaving(false);
  };

  if (!s) return <HStack color="fuego.muted"><Spinner size="sm" /><Text fontSize="13px">Loading settings…</Text></HStack>;

  const folders = s.sessionFolders || [];
  const extras = s.extraSessionDirs || [];
  const toggleExtra = (name) => {
    const next = extras.includes(name) ? extras.filter((x) => x !== name) : [...extras, name];
    save({ extraSessionDirs: next });
  };

  return (
    <VStack align="stretch" spacing={6}>
      <Box>
        <Heading fontSize="1.5rem" fontStyle="italic">Settings</Heading>
        <Text color="fuego.muted" fontSize="14px">What this board reads, and where its journal comes from.</Text>
      </Box>

      {/* ---- Journal sources ---- */}
      <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="14px" p={5}>
        <Heading fontSize="1rem" fontStyle="italic" mb={1}>What the journal records</Heading>
        <Text fontSize="12.5px" color="fuego.faint" mb={4}>
          The journal is the board's memory. It is what lets the morning briefing say
          “you committed to this on Tuesday and nothing has moved since.”
        </Text>
        <VStack align="stretch" spacing={3} divider={<Divider borderColor="rgba(255,255,255,0.04)" />}>
          {SOURCES.map((src) => (
            <HStack key={src.key} align="flex-start" spacing={4}>
              <Switch
                mt="2px" colorScheme="yellow" isChecked={!!s.journalSources?.[src.key]}
                onChange={(e) => save({ journalSources: { [src.key]: e.target.checked } })}
              />
              <Box flex="1">
                <HStack spacing={2} wrap="wrap">
                  <Text fontSize="14px" color="fuego.text">{src.label}</Text>
                  {src.needs && <Badge bg="rgba(224,168,48,0.12)" color="fuego.gold" border="1px solid" borderColor="rgba(224,168,48,0.32)" fontSize="9px" textTransform="uppercase" px={2} py="2px" borderRadius="4px">needs {src.needs}</Badge>}
                </HStack>
                <Text fontSize="12px" color="fuego.muted" mt="2px">{src.hint}</Text>
              </Box>
            </HStack>
          ))}
        </VStack>
      </Box>

      {/* ---- Which sessions folder ---- */}
      <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="14px" p={5}>
        <Heading fontSize="1rem" fontStyle="italic" mb={1}>Which Claude sessions feed this board</Heading>
        <Text fontSize="12.5px" color="fuego.faint" mb={4}>
          Every folder you run Claude Code in keeps its own session history. Pick the main one for this board, then
          add any others worth folding in.
        </Text>

        <Text fontSize="11px" color="fuego.gold" letterSpacing="0.1em" textTransform="uppercase" mb={2}>Main folder</Text>
        <Select
          value={s.sessionsDir || ""}
          onChange={(e) => save({ sessionsDir: e.target.value || null })}
          bg="fuego.panel" borderColor="fuego.border" size="sm" borderRadius="8px" maxW="520px" mb={5}
          isDisabled={saving}
        >
          <option value="">— none —</option>
          {folders.map((f) => (
            <option key={f} value={f}>{pretty(f)}{isGlobal(f) ? "  (global)" : ""}</option>
          ))}
        </Select>

        <Text fontSize="11px" color="fuego.gold" letterSpacing="0.1em" textTransform="uppercase" mb={2}>
          Also include {extras.length > 0 ? `· ${extras.length} selected` : ""}
        </Text>
        <Text fontSize="12px" color="fuego.muted" mb={3}>
          The <b>global</b> folder is the one you get when you run Claude from your home directory — it catches
          everything that wasn't done inside a specific project.
        </Text>
        <Wrap spacing={2}>
          {folders.filter((f) => f !== s.sessionsDir).map((f) => {
            const on = extras.includes(f);
            return (
              <WrapItem key={f}>
                <Button
                  size="xs" variant="outline" fontWeight={500}
                  borderColor={on ? "fuego.gold" : "fuego.border"}
                  color={on ? "fuego.gold" : "fuego.faint"}
                  bg={on ? "rgba(224,168,48,0.08)" : "transparent"}
                  _hover={{ borderColor: "fuego.gold" }}
                  onClick={() => toggleExtra(f)}
                >
                  {on ? "✓ " : "+ "}{pretty(f)}{isGlobal(f) ? " (global)" : ""}
                </Button>
              </WrapItem>
            );
          })}
        </Wrap>
      </Box>

      <Text fontSize="11.5px" color="fuego.faint" lineHeight={1.6}>
        Nothing on this page holds a password — these are only choices about what gets read.
      </Text>
    </VStack>
  );
}
