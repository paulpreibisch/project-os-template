// Minimal History-API router. The app only ever needs /:project/:module,
// so this avoids pulling in react-router for two path segments.
import { useEffect, useState } from "react";

const EVT = "os:navigate";

export function navigate(to, { replace = false } = {}) {
  if (to === window.location.pathname) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", to);
  window.dispatchEvent(new Event(EVT));
}

export function usePathname() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync); // browser back/forward
    window.addEventListener(EVT, sync); // our own pushState calls
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(EVT, sync);
    };
  }, []);
  return path;
}

export const segments = (path) => path.split("/").filter(Boolean);
