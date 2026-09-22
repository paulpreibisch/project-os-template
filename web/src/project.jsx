import { createContext, useContext } from "react";

// Active project (tenant) context. Components read the slug to build project-scoped URLs.
export const ProjectContext = createContext({ slug: "demo" });
export const useProject = () => useContext(ProjectContext);

// Project-scoped API base and public-asset URL helpers.
export const apiBase = (slug) => `/api/p/${slug}`;
export const pubUrl = (slug, photo) =>
  !photo ? "" : /^https?:\/\//.test(photo) ? photo : `/pub/${slug}/${photo}`;
