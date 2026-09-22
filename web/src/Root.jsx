import { useState, useEffect, useMemo } from "react";
import { ChakraProvider, ColorModeScript, Flex, Spinner, Text } from "@chakra-ui/react";
import { makeTheme } from "./theme.js";
import { ProjectContext } from "./project.jsx";
import { usePathname, segments, navigate } from "./router.js";
import App from "./App.jsx";

const LS_KEY = "project-os.active";

export default function Root() {
  const [projects, setProjects] = useState([]);
  const [config, setConfig] = useState(null);

  // The URL is the source of truth: /:project/:module
  const path = usePathname();
  const urlSlug = segments(path)[0] || null;
  const known = projects.some((p) => p.slug === urlSlug);
  const active = known ? urlSlug : null;

  // Load the project list once.
  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => {});
  }, []);

  // Keep the URL pointing at a real project: bare "/" (or an unknown slug)
  // redirects to the last-used project, else the first one.
  useEffect(() => {
    if (!projects.length) return;
    if (known) {
      localStorage.setItem(LS_KEY, urlSlug);
      return;
    }
    const last = localStorage.getItem(LS_KEY);
    const fallback = projects.some((p) => p.slug === last) ? last : projects[0].slug;
    navigate(`/${fallback}`, { replace: true });
  }, [projects, urlSlug, known]);

  // Load the active project's config (branding/theme/modules) whenever it changes.
  useEffect(() => {
    if (!active) return;
    setConfig(null);
    fetch(`/api/p/${active}/config`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig({}));
  }, [active]);

  const theme = useMemo(() => makeTheme(config?.theme), [config]);

  useEffect(() => {
    if (config?.brand?.name) document.title = `${config.brand.name} — ${config.brand.subtitle || "Project OS"}`;
  }, [config]);

  return (
    <ChakraProvider theme={theme}>
      <ColorModeScript initialColorMode={theme.config.initialColorMode} />
      {!active || !config ? (
        <Flex h="100vh" align="center" justify="center" direction="column" gap={4}>
          <Spinner color="fuego.gold" size="xl" thickness="3px" />
          <Text color="fuego.muted">Loading Project OS…</Text>
        </Flex>
      ) : (
        <ProjectContext.Provider value={{ slug: active }}>
          <App
            key={active}
            config={config}
            projects={projects}
            active={active}
            onSwitch={(slug) => navigate(`/${slug}`)}
          />
        </ProjectContext.Provider>
      )}
    </ChakraProvider>
  );
}
