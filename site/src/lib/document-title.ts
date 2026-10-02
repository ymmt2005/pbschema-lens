export interface TitledPage {
  urlPath: string;
  fullName: string;
}

const STATIC_TITLES: Record<string, string> = {
  "/explore/": "Used-by explorer",
  "/graph/": "Package graph",
  "/diff/": "Schema diff",
  "/source/": "Source",
};

/** Document title matching the pre-rewrite layout: `page · site`, or the site title alone on the home page. */
export function documentTitle(path: string, siteTitle: string, pages: readonly TitledPage[]): string {
  const route = !path || path === "/" ? "/" : path.endsWith("/") ? path : `${path}/`;
  if (route === "/") return siteTitle;
  const page = pages.find((item) => item.urlPath === route && item.fullName);
  if (page) return `${page.fullName} · ${siteTitle}`;
  const label = STATIC_TITLES[route];
  if (label) return `${label} · ${siteTitle}`;
  return `Not found · ${siteTitle}`;
}
