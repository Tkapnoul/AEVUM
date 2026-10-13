export type ThemePref = "system" | "dark" | "light";

export function getTheme(): ThemePref {
  try {
    const v = localStorage.getItem("aevum.theme");
    if (v === "dark" || v === "light") return v;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
  try {
    localStorage.setItem("aevum.theme", pref);
  } catch {
    /* storage unavailable */
  }
}
