export const THEME_STORAGE_KEY = "pbschema-lens-theme";

/** Dark when the visitor chose it, or when they have not chosen and the desktop is dark. */
export function useDarkTheme(stored: string | null, systemPrefersDark: boolean): boolean {
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return systemPrefersDark;
}

/** Inline head script. It cannot import modules, so it calls useDarkTheme by source. */
export function themeBootScript(): string {
  return `try{var stored=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var systemDark=window.matchMedia("(prefers-color-scheme: dark)").matches;var useDark=${useDarkTheme.toString()};if(useDark(stored,systemDark))document.documentElement.classList.add("dark");}catch(e){}`;
}
