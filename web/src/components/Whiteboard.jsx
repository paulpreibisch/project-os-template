import { useEffect, useState } from "react";
import {
  Box, Heading, Text, VStack, HStack, Button, Input, Textarea, Badge, useToast, Spacer, IconButton, Flex,
} from "@chakra-ui/react";
import { useProject } from "../project.jsx";
import { usePathname, segments, navigate } from "../router.js";

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
}
function toPlainText(html) {
  const t = document.createElement("div");
  t.innerHTML = html;
  return t.innerText.trim();
}
// Full standalone documents (printables) render in an isolated iframe so their
// print CSS / @page rules never leak into the app. Snippets stay inline.
const isFullDoc = (html) => /^\s*(<!doctype|<html)/i.test(html || "");

function IndexRow({ item, active, onSelect }) {
  const doc = isFullDoc(item.content);
  return (
    <Box
      as="button"
      textAlign="left"
      w="100%"
      px={4} py={3}
      borderRadius="10px"
      border="1px solid"
      borderColor={active ? "fuego.gold" : "transparent"}
      bg={active ? "rgba(224,168,48,0.10)" : "transparent"}
      _hover={{ bg: active ? "rgba(224,168,48,0.12)" : "rgba(255,255,255,0.04)" }}
      onClick={() => onSelect(item.id)}
      transition="background .12s"
    >
      <HStack spacing={2} mb={1}>
        <Badge
          bg={doc ? "rgba(224,168,48,0.16)" : "rgba(93,173,226,0.15)"}
          color={doc ? "fuego.gold" : "fuego.blue"}
          fontSize="8px" textTransform="uppercase"
        >{doc ? "printable" : (item.language || "html")}</Badge>
        <Spacer />
        <Text fontSize="10px" color="fuego.faint" whiteSpace="nowrap">{fmtDate(item.created_at)}</Text>
      </HStack>
      <Text fontWeight={600} fontSize="13px" color={active ? "fuego.gold" : "fuego.text"} noOfLines={2}>
        {item.title}
      </Text>
    </Box>
  );
}

function Detail({ item, onDelete }) {
  const toast = useToast();
  const { slug } = useProject();
  const rawUrl = `/api/p/${slug}/whiteboard/${item.id}/raw`;
  const shareUrl = `${window.location.origin}/${slug}/whiteboard/${item.id}`;
  const doc = isFullDoc(item.content);
  const copy = (text, label) =>
    navigator.clipboard.writeText(text).then(() => toast({ title: label, status: "success", duration: 1500 }));
  return (
    <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="14px" overflow="hidden">
      <HStack px={5} py={3} borderBottom="1px solid" borderColor="fuego.border" spacing={3}>
        <Text fontWeight={700} fontSize="15px" noOfLines={1}>{item.title}</Text>
        <Badge
          bg={doc ? "rgba(224,168,48,0.16)" : "rgba(93,173,226,0.15)"}
          color={doc ? "fuego.gold" : "fuego.blue"}
          fontSize="9px" textTransform="uppercase"
        >{doc ? "printable" : (item.language || "html")}</Badge>
        <Spacer />
        <Text fontSize="11px" color="fuego.faint" whiteSpace="nowrap" display={{ base: "none", md: "block" }}>{fmtDate(item.created_at)}</Text>
        {/* Every item opens in a tab, not just the printables. A note is just as
            likely to want its own window — to read alongside the thing it
            describes, or to keep open while working through it — and the /raw
            route now wraps a snippet in the board's own styling, so a fragment
            lands as a readable page rather than unstyled black-on-white. */}
        <Button
          size="xs" variant="ghost" color="fuego.gold"
          onClick={() => window.open(rawUrl, "_blank", "noopener")}
        >{doc ? "Open · Print ⧉" : "Open ⧉"}</Button>
        {!doc && (
          <Button size="xs" variant="ghost" color="fuego.muted" onClick={() => copy(toPlainText(item.content), "Text copied")}>Copy text</Button>
        )}
        <Button size="xs" variant="ghost" color="fuego.muted" onClick={() => copy(item.content, "HTML copied")}>Copy HTML</Button>
        <Button size="xs" variant="ghost" color="fuego.muted" onClick={() => copy(shareUrl, "Link copied")}>Copy link 🔗</Button>
        <IconButton aria-label="Delete" size="xs" variant="ghost" color="fuego.muted" _hover={{ color: "fuego.accent" }} icon={<span>✕</span>} onClick={() => onDelete(item)} />
      </HStack>
      {doc ? (
        <Box bg="#d9d4cc">
          <Box
            as="iframe"
            title={item.title}
            src={rawUrl}
            sandbox="allow-same-origin allow-modals allow-popups"
            w="100%" h="72vh" border="0" display="block"
          />
        </Box>
      ) : (
        <Box
          px={6} py={5} fontSize="15px" color="fuego.text"
          sx={{
            "& h1,& h2,& h3": { fontFamily: "heading", color: "#fff", mb: 2, mt: 1, lineHeight: 1.2 },
            "& h3": { fontSize: "1.05rem" },
            "& p": { mb: 3, lineHeight: 1.6, color: "var(--chakra-colors-fuego-muted)" },
            "& a": { color: "var(--chakra-colors-fuego-gold)" },
            "& ul,& ol": { pl: 5, mb: 3 },
            "& code": { bg: "rgba(255,255,255,0.06)", px: 1, borderRadius: "4px", fontSize: "0.85em" },
            "& blockquote": { borderLeft: "3px solid", borderColor: "fuego.gold", pl: 3, color: "var(--chakra-colors-fuego-muted)" },
          }}
          dangerouslySetInnerHTML={{ __html: item.content }}
        />
      )}
    </Box>
  );
}

export default function Whiteboard() {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const { slug } = useProject();
  const base = `/api/p/${slug}/whiteboard`;

  // The open item comes from the URL (/:project/whiteboard/:itemId) so each one
  // is linkable, shareable and works with browser back/forward — same contract
  // the module tabs already use.
  const path = usePathname();
  const selectedId = segments(path)[2] || null;
  const select = (id) => navigate(`/${slug}/whiteboard/${id}`);

  const load = (preferId) =>
    fetch(base, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list = d.items || [];
        setItems(list);
        if (preferId && list.some((i) => i.id === preferId)) select(preferId);
      })
      .catch(() => {});
  useEffect(() => { load(); }, [slug]);

  // Normalise a bare /:project/whiteboard — and any id that no longer exists —
  // onto the first item, so a stale or deleted link lands somewhere real.
  useEffect(() => {
    if (!items.length) return;
    if (!selectedId || !items.some((i) => i.id === selectedId)) {
      navigate(`/${slug}/whiteboard/${items[0].id}`, { replace: true });
    }
  }, [items, selectedId, slug]);

  const add = async () => {
    if (!content.trim()) { toast({ title: "Add some HTML content first", status: "warning" }); return; }
    setBusy(true);
    try {
      const r = await fetch(base, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || "Untitled", content, language: "html" }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "failed");
      const created = await r.json();
      setTitle(""); setContent(""); setOpen(false);
      await load(created.id);
      toast({ title: "Added to whiteboard", status: "success" });
    } catch (e) {
      toast({ title: "Could not add", description: String(e.message || e), status: "error" });
    } finally { setBusy(false); }
  };

  const del = async (item) => {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    await fetch(`${base}/${item.id}`, { method: "DELETE" });
    load(); // the normalise effect re-points the URL if the open item just went away
  };

  const selected = items.find((i) => i.id === selectedId) || null;

  return (
    <VStack align="stretch" spacing={5}>
      <HStack>
        <Box>
          <Heading fontSize="1.5rem" fontStyle="italic">Whiteboard</Heading>
          <Text color="fuego.muted" fontSize="14px">Printables, snippets &amp; notes. Pick one from the index to view it.</Text>
        </Box>
        <Spacer />
        <Button bg="fuego.red" color="white" _hover={{ bg: "fuego.accent" }} onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "+ New item"}
        </Button>
      </HStack>

      {open && (
        <Box bg="fuego.card" border="1px solid" borderColor="fuego.border" borderRadius="14px" p={5}>
          <VStack align="stretch" spacing={3}>
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} bg="fuego.panel" borderColor="fuego.border" />
            <Textarea
              placeholder="HTML content — e.g. <h3>Heading</h3><p>Paragraph…</p>  (or a full <!doctype html> printable)"
              value={content} onChange={(e) => setContent(e.target.value)}
              rows={10} fontFamily="mono" fontSize="13px" bg="fuego.panel" borderColor="fuego.border"
            />
            <HStack>
              <Text fontSize="11px" color="fuego.faint">Tip: paste HTML directly. A full document is shown as a printable.</Text>
              <Spacer />
              <Button onClick={add} isLoading={busy} bg="fuego.gold" color="#111" _hover={{ bg: "#f0b840" }}>Add to whiteboard</Button>
            </HStack>
          </VStack>
        </Box>
      )}

      {items.length === 0 ? (
        <Text color="fuego.muted" fontSize="14px">Nothing on the whiteboard yet — click “+ New item”.</Text>
      ) : (
        <Flex align="stretch" gap={5} direction={{ base: "column", md: "row" }}>
          {/* Index column */}
          <VStack
            align="stretch"
            spacing={1}
            flex="none"
            w={{ base: "100%", md: "270px" }}
            maxH={{ md: "78vh" }}
            overflowY={{ md: "auto" }}
            bg="fuego.panel"
            border="1px solid"
            borderColor="fuego.border"
            borderRadius="14px"
            p={2}
          >
            <Text px={3} pt={2} pb={1} fontSize="10px" letterSpacing="0.14em" textTransform="uppercase" color="fuego.faint">
              Index · {items.length}
            </Text>
            {items.map((it) => (
              <IndexRow key={it.id} item={it} active={it.id === selectedId} onSelect={select} />
            ))}
          </VStack>

          {/* Detail column */}
          <Box flex="1" minW={0}>
            {selected ? (
              <Detail item={selected} onDelete={del} />
            ) : (
              <Text color="fuego.muted" fontSize="14px" p={5}>Select an item from the index.</Text>
            )}
          </Box>
        </Flex>
      )}
    </VStack>
  );
}
