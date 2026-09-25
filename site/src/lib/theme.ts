export const THEME_STORAGE_KEY = "pbschema-lens-theme";

export const THEME_CHOICES = [
  { value: "system", label: "Follow desktop" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number]["value"];

/** Saved light/dark wins. Anything else, including a cleared choice, follows the desktop. */
export function themeChoice(stored: string | null): ThemeChoice {
  if (stored === "light" || stored === "dark") return stored;
  return "system";
}

/** null clears storage so the desktop theme applies again. */
export function themeStorageValue(choice: string): "light" | "dark" | null {
  if (choice === "light" || choice === "dark") return choice;
  return null;
}

/** Dark when the visitor chose it, or when they follow the desktop and the desktop is dark. */
export function useDarkTheme(stored: string | null, systemPrefersDark: boolean): boolean {
  const choice = themeChoice(stored);
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return systemPrefersDark;
}

/** Inline head script. It cannot import modules, so it calls useDarkTheme by source. */
export function themeBootScript(): string {
  return `try{var stored=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var systemDark=window.matchMedia("(prefers-color-scheme: dark)").matches;var themeChoice=${themeChoice.toString()};var useDark=${useDarkTheme.toString()};if(useDark(stored,systemDark))document.documentElement.classList.add("dark");}catch(e){}`;
}
