// Everything brand- and business-specific lives here so the app can be aligned
// with the company's own positioning without touching feature code.
//
// NOTE: the company's site (dizzy-input-831080.framer.app/join) could not be
// fetched from the build environment (blocked by network policy). The values
// below are a neutral longevity-membership baseline built around the brand
// name AEVUM. Replace plans, pillars and copy with the real ones from the site.

export type Locale = "el" | "en";
type Text = Record<Locale, string>;

export interface Plan {
  id: string;
  name: Text;
  /** Included 1-1 sessions per month, by expert role. */
  sessionsPerMonth: Partial<Record<"coach" | "doctor" | "nutritionist" | "physio", number>>;
}

export const company = {
  name: "AEVUM",
  tagline: {
    el: "Η υγεία σου, μετρημένη και καθοδηγούμενη.",
    en: "Your health, measured and guided.",
  } satisfies Text,
  supportEmail: "support@aevum.example",
  /** Roles automatically assigned to every new member's care team. */
  careTeamRoles: ["coach", "doctor"] as const,
  /** The four pillars the app's data and coaching are organised around. */
  pillars: [
    { key: "sleep", label: { el: "Ύπνος", en: "Sleep" } },
    { key: "recovery", label: { el: "Αποκατάσταση", en: "Recovery" } },
    { key: "activity", label: { el: "Κίνηση", en: "Movement" } },
    { key: "stress", label: { el: "Στρες", en: "Stress" } },
  ],
  plans: [
    {
      id: "member",
      name: { el: "Μέλος", en: "Member" },
      sessionsPerMonth: { coach: 2, doctor: 1 },
    },
  ] satisfies Plan[],
  goals: [
    { key: "sleep_better", label: { el: "Καλύτερος ύπνος", en: "Sleep better" } },
    { key: "more_energy", label: { el: "Περισσότερη ενέργεια", en: "More energy" } },
    { key: "lose_weight", label: { el: "Απώλεια βάρους", en: "Lose weight" } },
    { key: "fitness", label: { el: "Φυσική κατάσταση", en: "Fitness" } },
    { key: "stress_less", label: { el: "Λιγότερο στρες", en: "Less stress" } },
    { key: "longevity", label: { el: "Μακροζωία", en: "Longevity" } },
  ],
};
