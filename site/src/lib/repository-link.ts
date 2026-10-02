// repositoryLinkLabel is the visible text for a source.repository URL.
export function repositoryLinkLabel(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "View repository";
  }
  if (host === "github.com" || host.endsWith(".github.com")) {
    return "View on GitHub";
  }
  if (host === "gitlab.com" || host.endsWith(".gitlab.com")) {
    return "View on GitLab";
  }
  return "View repository";
}

export function isExternalHref(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:");
}
