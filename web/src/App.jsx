import { useEffect, useState, useCallback, useRef } from "react";
import {
  Box, Flex, HStack, Text, Button, Spinner, Circle, Spacer, useToast, Badge,
  Menu, MenuButton, MenuList, MenuItem, MenuDivider, Wrap, WrapItem,
} from "@chakra-ui/react";
import Dashboard from "./components/Dashboard.jsx";
import Journal from "./components/Journal.jsx";
import WhosWho from "./components/WhosWho.jsx";
import ContactList from "./components/ContactList.jsx";
import Testimonials from "./components/Testimonials.jsx";
import Whiteboard from "./components/Whiteboard.jsx";
import Roadmap from "./components/Roadmap.jsx";
import Goals from "./components/Goals.jsx";
import Mission from "./components/Mission.jsx";
import CreateProject from "./components/CreateProject.jsx";
import Settings from "./components/Settings.jsx";
import { usePathname, segments, navigate } from "./router.js";

// Views reachable by URL but not shown as tabs (opened from a button instead).
const EXTRA_VIEWS = ["create", "settings"];

const DEFAULT_MODULES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "journal", label: "Journal" },
  { id: "whoswho", label: "Who's Who" },
  { id: "whiteboard", label: "Whiteboard" },
];

export default function App({ config = {}, projects = [], active, onSwitch }) {
  const brand = config.brand || {};
  // A module with a `url` is an outbound link in the nav rather than a view of
  // its own — it opens in a new tab and never takes part in routing.
  const NAV = config.modules?.length ? config.modules : DEFAULT_MODULES;
  const VIEWS = NAV.filter((v) => !v.url);
  // A tenant can be published read-only — deployed to a public host for someone
  // to READ, with the write endpoints dead at the proxy. Showing them buttons
  // that scaffold projects or trigger a refresh would offer actions that cannot
  // work and should not be theirs to take. Set `"readOnly": true` in that copy's
  // config.json.
  const readOnly = !!config.readOnly;
  const updaterEnabled = !readOnly && !!config.updater?.enabled;

  const [data, setData] = useState(null);
  const [testimonials, setTestimonials] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [job, setJob] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const esRef = useRef(null);
  const toast = useToast();

  // The active module comes from the URL (/:project/:module) so every view is
  // linkable, shareable and works with browser back/forward.
  const path = usePathname();
  const urlView = segments(path)[1] || null;
  const validView = VIEWS.some((v) => v.id === urlView) || EXTRA_VIEWS.includes(urlView);
  const view = validView ? urlView : VIEWS[0]?.id || "dashboard";
  const go = (id) => navigate(`/${active}/${id}`);

  // Normalise a bare /:project into /:project/:defaultModule.
  useEffect(() => {
    if (!validView) navigate(`/${active}/${view}`, { replace: true });
  }, [active, validView, view]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/p/${active}/data`, { cache: "no-store" });
      setData(await r.json());
    } catch (e) {
      /* keep previous data on transient errors */
    }
    // The header bell needs the unread testimonial count even when nobody has
    // that tab open.
    try {
      const rt = await fetch(`/api/p/${active}/testimonials`, { cache: "no-store" });
      setTestimonials(await rt.json());
    } catch (e) { /* leave the last count on screen */ }
  }, [active]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // live-update every 60s
    return () => clearInterval(t);
  }, [load]);

  // Subscribe to the live progress stream (SSE) for the active project.
  const openStream = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`/api/p/${active}/refresh/stream`);
    esRef.current = es;
    es.addEventListener("start", () => { setLogLines([]); setShowLog(true); setRefreshing(true); });
    es.addEventListener("log", (e) => {
      try { const { line } = JSON.parse(e.data); setLogLines((ls) => [...ls, line].slice(-200)); } catch {}
    });
    es.addEventListener("done", (e) => {
      let code = 0; try { code = JSON.parse(e.data).code; } catch {}
      setLogLines((ls) => [...ls, code === 0 ? "✓ Done." : `Exited with code ${code}`]);
      setRefreshing(false);
      setJob(null);
      load();
      es.close(); esRef.current = null;
    });
    es.onerror = () => { /* keep-alive hiccup; browser auto-retries */ };
    return es;
  }, [active, load]);

  useEffect(() => () => { if (esRef.current) esRef.current.close(); }, []);

  const runJob = async (kind, url, firstLine, failTitle) => {
    setRefreshing(true);
    setJob(kind);
    setLogLines([firstLine]);
    setShowLog(true);
    openStream();
    try {
      const r = await fetch(url, { method: "POST" });
      const j = await r.json();
      if (!j.ok) {
        setLogLines((ls) => [...ls, j.status || "could not start"]);
        setRefreshing(false);
        setJob(null);
      }
    } catch (e) {
      toast({ title: failTitle, description: String(e), status: "error" });
      setRefreshing(false);
      setJob(null);
    }
  };

  const refresh = () => runJob("refresh", `/api/p/${active}/refresh`, "Starting refresh…", "Refresh failed");

  // Live progress in a toast: one toast per run, its body replaced as each line
  // arrives off the SSE stream. It names the job so "refreshing" is never an
  // unexplained spinner.
  const progressToastRef = useRef(null);
  useEffect(() => {
    if (!job) return;
    const last = logLines[logLines.length - 1] || "Starting…";
    const body = { title: "Refreshing…", description: last, status: "loading", duration: null, isClosable: false, position: "bottom-right" };
    if (progressToastRef.current == null) progressToastRef.current = toast(body);
    else toast.update(progressToastRef.current, body);
  }, [job, logLines, toast]);

  // Close it out when the run ends, with the outcome rather than a silent vanish.
  const prevJob = useRef(null);
  useEffect(() => {
    if (prevJob.current && !job && progressToastRef.current != null) {
      const last = logLines[logLines.length - 1] || "";
      const failed = /exited with code|could not start|failed/i.test(last);
      toast.update(progressToastRef.current, {
        title: failed ? "Refresh failed" : "Refresh finished",
        description: last,
        status: failed ? "error" : "success",
        duration: 6000, isClosable: true, position: "bottom-right",
      });
      progressToastRef.current = null;
    }
    prevJob.current = job;
  }, [job, logLines, toast]);

  if (!data) {
    return (
      <Flex h="100vh" align="center" justify="center" direction="column" gap={4}>
        <Spinner color="fuego.gold" size="xl" thickness="3px" />
        <Text color="fuego.muted">Loading {brand.name || "Project OS"}…</Text>
      </Flex>
    );
  }

  const newTestimonialCount = testimonials?.items?.filter((t) => t.status === "new").length || 0;
  const hasTestimonialsTab = VIEWS.some((v) => v.id === "testimonials");
  const updated = data.meta?.updatedAt ? new Date(data.meta.updatedAt) : null;

  return (
    <Box minH="100vh">
      {/* Top bar */}
      <Flex
        as="header"
        className="os-chrome"
        position="sticky"
        top={0}
        zIndex={10}
        align="center"
        gap={4}
        px={{ base: 4, md: 8 }}
        py={3}
        bg="rgba(15,13,13,0.86)"
        backdropFilter="blur(10px)"
        borderBottom="1px solid"
        borderColor="fuego.border"
      >
        <Menu>
          <MenuButton
            as={HStack}
            spacing={3}
            cursor="pointer"
            role="group"
            _hover={{ opacity: 0.85 }}
            title="Switch project"
          >
            <HStack spacing={3}>
              <Circle
                size="34px"
                bgGradient={brand.logo || "radial(circle at 32% 30%, #5dade2, #2c6fa6 70%)"}
                boxShadow="0 0 0 4px rgba(93,173,226,0.18)"
                flex="none"
              />
              <Box lineHeight={1} textAlign="left">
                <HStack spacing={1}>
                  <Text fontWeight={700} letterSpacing="0.14em" fontSize="sm" textTransform="uppercase">
                    {brand.name || "Project OS"}
                  </Text>
                  <Text color="fuego.faint" fontSize="10px">▾</Text>
                </HStack>
                <Text fontSize="11px" color="fuego.muted" letterSpacing="0.16em" textTransform="uppercase">
                  {brand.subtitle || "Project OS"}
                </Text>
              </Box>
            </HStack>
          </MenuButton>
          <MenuList bg="fuego.panel" borderColor="fuego.border" minW="220px" py={2} maxH="70vh" overflowY="auto">
            <Text px={3} pb={1} fontSize="10px" letterSpacing="0.14em" textTransform="uppercase" color="fuego.faint">
              Projects
            </Text>
            {projects.map((p) => (
              <MenuItem
                key={p.slug}
                bg="transparent"
                _hover={{ bg: "rgba(224,168,48,0.1)" }}
                onClick={() => p.slug !== active && onSwitch?.(p.slug)}
              >
                <HStack w="100%">
                  <Box>
                    <Text fontSize="14px" fontWeight={600} color={p.slug === active ? "fuego.gold" : "fuego.text"}>{p.name}</Text>
                    <Text fontSize="11px" color="fuego.muted">{p.subtitle}</Text>
                  </Box>
                  <Spacer />
                  {p.slug === active && <Text color="fuego.gold">✓</Text>}
                </HStack>
              </MenuItem>
            ))}
            <MenuDivider borderColor="fuego.border" />
            <Text px={3} pt={1} pb={2} fontSize="10px" color="fuego.faint">
              Add one: <Text as="span" fontFamily="mono">node scaffold.mjs &lt;slug&gt;</Text>
            </Text>
          </MenuList>
        </Menu>

        <Spacer />

        <HStack spacing={3}>
          {hasTestimonialsTab && (
            <Box position="relative">
              <Button
                size="sm"
                variant="outline"
                borderColor="fuego.border"
                color={newTestimonialCount > 0 ? "fuego.gold" : "fuego.muted"}
                _hover={{ bg: "rgba(224,168,48,0.1)" }}
                onClick={() => go("testimonials")}
                title={newTestimonialCount > 0
                  ? `${newTestimonialCount} new testimonial${newTestimonialCount === 1 ? "" : "s"} to review`
                  : "Testimonials"}
              >
                🔔
              </Button>
              {newTestimonialCount > 0 && (
                <Circle
                  position="absolute" top="-8px" right="-8px"
                  minW="21px" h="21px" px="3px" bg="fuego.gold" color="#1a0a08"
                  fontSize="9.5px" fontWeight={800} lineHeight={1}
                  border="2px solid" borderColor="fuego.panel"
                  title={`${newTestimonialCount} new`}
                >
                  🪄{newTestimonialCount}
                </Circle>
              )}
            </Box>
          )}
          {updated && (
            <Text fontSize="11px" color="fuego.faint" display={{ base: "none", sm: "block" }}>
              updated {updated.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </Text>
          )}
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              borderColor="fuego.green"
              color="fuego.green"
              _hover={{ bg: "rgba(39,174,96,0.12)" }}
              onClick={() => go("create")}
              title="Scaffold a Project OS board for another project"
            >
              ＋ New project
            </Button>
          )}
          {updaterEnabled && (
            <Button
              size="sm"
              onClick={refresh}
              isLoading={job === "refresh"}
              loadingText="Refreshing"
              isDisabled={refreshing && job !== "refresh"}
              bg="fuego.red"
              color="white"
              _hover={{ bg: "fuego.accent" }}
            >
              ↻ Refresh now
            </Button>
          )}
          <Button
            as="a"
            href="/logout"
            size="sm"
            variant="outline"
            borderColor="fuego.border"
            color="fuego.muted"
            _hover={{ bg: "rgba(224,168,48,0.1)", color: "fuego.text" }}
            title="Log out"
          >
            ⏻ Log out
          </Button>
        </HStack>
      </Flex>

      {/* Desktop nav — full-width row that WRAPS so every tab is always visible */}
      <Wrap
        className="os-chrome"
        spacing={1}
        px={{ base: 4, md: 8 }}
        py={2}
        display={{ base: "none", md: "flex" }}
        position="sticky"
        top="61px"
        zIndex={9}
        bg="rgba(15,13,13,0.86)"
        backdropFilter="blur(10px)"
        borderBottom="1px solid"
        borderColor="fuego.border"
      >
        {NAV.map((v) => (
          <WrapItem key={v.id}>
            {v.url ? (
              <Button
                as="a"
                href={v.url}
                target="_blank"
                rel="noopener noreferrer"
                size="sm"
                variant="ghost"
                color="fuego.muted"
                _hover={{ color: "fuego.gold", bg: "rgba(224,168,48,0.08)" }}
                fontWeight={600}
                title={v.title || v.url}
              >
                {v.label} <Box as="span" ml={1} opacity={0.65}>↗</Box>
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => go(v.id)}
                color={view === v.id ? "fuego.gold" : "fuego.muted"}
                bg={view === v.id ? "rgba(224,168,48,0.1)" : "transparent"}
                _hover={{ color: "fuego.gold", bg: "rgba(224,168,48,0.08)" }}
                fontWeight={600}
              >
                {v.label}
              </Button>
            )}
          </WrapItem>
        ))}
      </Wrap>

      {/* Mobile nav */}
      <HStack
        className="os-chrome"
        spacing={2}
        px={4}
        py={2}
        overflowX="auto"
        display={{ base: "flex", md: "none" }}
        borderBottom="1px solid"
        borderColor="fuego.border"
      >
        {NAV.map((v) =>
          v.url ? (
            <Button
              key={v.id}
              as="a"
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              size="xs"
              flex="none"
              variant="outline"
              color="fuego.muted"
              borderColor="fuego.border"
            >
              {v.label} ↗
            </Button>
          ) : (
            <Button
              key={v.id}
              size="xs"
              flex="none"
              variant="outline"
              onClick={() => go(v.id)}
              color={view === v.id ? "fuego.gold" : "fuego.muted"}
              borderColor={view === v.id ? "fuego.gold" : "fuego.border"}
            >
              {v.label}
            </Button>
          )
        )}
      </HStack>

      {/* Content */}
      <Box maxW="1120px" mx="auto" px={{ base: 4, md: 8 }} py={{ base: 6, md: 8 }}>
        {view === "dashboard" && <Dashboard data={data} config={config} onNav={go} />}
        {view === "roadmap" && <Roadmap data={data} />}
        {view === "goals" && <Goals data={data} />}
        {view === "mission" && <Mission data={data} />}
        {view === "journal" && <Journal data={data} />}
        {view === "whoswho" && <WhosWho data={data} />}
        {view === "contactlist" && <ContactList />}
        {view === "testimonials" && <Testimonials />}
        {view === "whiteboard" && <Whiteboard />}
        {view === "settings" && <Settings />}
        {view === "create" && <CreateProject projects={projects} onSwitch={onSwitch} />}
      </Box>

      <Flex className="os-chrome" px={8} py={6} borderTop="1px solid" borderColor="fuego.border" color="fuego.faint" fontSize="xs" justify="space-between" wrap="wrap" gap={2}>
        <Text fontFamily="heading" fontStyle="italic" color="fuego.muted" fontSize="md">{brand.signature || ""}</Text>
        <HStack spacing={2}>
          <Text>Day {data.meta?.dayCount}{data.event?.website ? ` · ${data.event.website}` : ""}</Text>
          <Badge bg="rgba(39,174,96,0.16)" color="fuego.green">{brand.liveLabel || "live"}</Badge>
        </HStack>
      </Flex>

      {/* Live refresh progress (SSE) */}
      {showLog && (
        <Box position="fixed" bottom={4} right={4} zIndex={50} w={{ base: "calc(100vw - 32px)", sm: "420px" }}
          bg="fuego.panel" border="1px solid" borderColor="fuego.border" borderRadius="14px" boxShadow="0 12px 34px rgba(0,0,0,0.4)" overflow="hidden">
          <HStack px={4} py={2.5} borderBottom="1px solid" borderColor="fuego.border" bg="rgba(0,0,0,0.2)">
            {refreshing
              ? <Spinner size="xs" color="fuego.gold" thickness="2px" />
              : <Box w="8px" h="8px" borderRadius="full" bg="fuego.green" />}
            <Text fontSize="12px" fontWeight={700} letterSpacing="0.1em" textTransform="uppercase" color="fuego.muted">
              {refreshing ? "Refreshing…" : "Refresh complete"}
            </Text>
            <Spacer />
            <Button size="xs" variant="ghost" color="fuego.faint" onClick={() => setShowLog(false)}>close</Button>
          </HStack>
          <Box maxH="230px" overflowY="auto" px={4} py={3} fontFamily="mono" fontSize="12px" lineHeight={1.7}
            ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
            {logLines.length === 0
              ? <Text color="fuego.faint">Waiting for the updater…</Text>
              : logLines.map((l, i) => (
                  <Text key={i} color={/✦|✓|new (draw|pop)/.test(l) ? "fuego.greenBright" : /fail|error|Exited/i.test(l) ? "fuego.accent" : "fuego.text"}>
                    {l}
                  </Text>
                ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
