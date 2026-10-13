const env = process.env;

const isProd = env.NODE_ENV === "production";

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET === "change-me")) {
  throw new Error("JWT_SECRET must be set to a long random value in production");
}

export const config = {
  isProd,
  port: Number(env.PORT ?? 8787),
  publicUrl: (env.PUBLIC_URL ?? "http://localhost:8787").replace(/\/$/, ""),
  jwtSecret: new TextEncoder().encode(env.JWT_SECRET ?? "dev-only-secret-do-not-use-in-production"),
  databasePath: env.DATABASE_PATH ?? "./data/aevum.db",
  videoBaseUrl: (env.VIDEO_BASE_URL ?? "https://meet.jit.si").replace(/\/$/, ""),
  clinicTimeZone: env.CLINIC_TIME_ZONE ?? "Europe/Athens",
  ai: {
    enabled: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    model: env.AEVUM_AI_MODEL ?? "claude-opus-5-5",
    effort: (env.AEVUM_AI_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  },
};
