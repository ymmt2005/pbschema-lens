import { describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY, themeBootScript, useDarkTheme } from "./theme.ts";

describe("useDarkTheme", () => {
  it("follows the desktop when the visitor has not chosen", () => {
    expect(useDarkTheme(null, true)).toBe(true);
    expect(useDarkTheme(null, false)).toBe(false);
    expect(useDarkTheme("", true)).toBe(true);
  });

  it("keeps an explicit choice over the desktop", () => {
    expect(useDarkTheme("light", true)).toBe(false);
    expect(useDarkTheme("dark", false)).toBe(true);
  });
});

describe("themeBootScript", () => {
  function run(stored: string | null, systemPrefersDark: boolean): boolean {
    const classes = new Set<string>();
    const document = {
      documentElement: {
        classList: {
          add(name: string) {
            classes.add(name);
          },
        },
      },
    };
    const localStorage = { getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null) };
    const window = { matchMedia: () => ({ matches: systemPrefersDark }) };
    const apply = new Function("document", "localStorage", "window", themeBootScript());
    apply(document, localStorage, window);
    return classes.has("dark");
  }

  it("adds the dark class when the desktop is dark and nothing is saved", () => {
    expect(run(null, true)).toBe(true);
    expect(run(null, false)).toBe(false);
    expect(run("light", true)).toBe(false);
  });
});
