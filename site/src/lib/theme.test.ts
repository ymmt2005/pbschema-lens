import { describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY, themeBootScript, themeChoice, themeMenuScript, themeStorageValue, useDarkTheme } from "./theme.ts";

describe("themeChoice", () => {
  it("follows the desktop unless light or dark is saved", () => {
    expect(themeChoice(null)).toBe("system");
    expect(themeChoice("")).toBe("system");
    expect(themeChoice("system")).toBe("system");
    expect(themeChoice("light")).toBe("light");
    expect(themeChoice("dark")).toBe("dark");
  });
});

describe("themeStorageValue", () => {
  it("clears storage when the visitor follows the desktop", () => {
    expect(themeStorageValue("system")).toBeNull();
    expect(themeStorageValue("light")).toBe("light");
    expect(themeStorageValue("dark")).toBe("dark");
  });
});

describe("useDarkTheme", () => {
  it("follows the desktop when the visitor has not chosen", () => {
    expect(useDarkTheme(null, true)).toBe(true);
    expect(useDarkTheme(null, false)).toBe(false);
    expect(useDarkTheme("", true)).toBe(true);
    expect(useDarkTheme("system", true)).toBe(true);
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

describe("themeMenuScript", () => {
  function selected(stored: string | null): string {
    let value = "system";
    const document = {
      getElementById() {
        return {
          get value() {
            return value;
          },
          set value(next: string) {
            value = next;
          },
        };
      },
    };
    const localStorage = { getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null) };
    const apply = new Function("document", "localStorage", themeMenuScript());
    apply(document, localStorage);
    return value;
  }

  it("selects the saved choice, or desktop when nothing is saved", () => {
    expect(selected(null)).toBe("system");
    expect(selected("light")).toBe("light");
    expect(selected("dark")).toBe("dark");
  });
});
