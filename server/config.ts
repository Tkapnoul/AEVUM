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
  /**
   * Free alternative to the Anthropic API: any OpenAI-compatible chat endpoint. GEMINI_API_KEY alone selects
   * Google's free tier; AI_BASE_URL (+ AI_API_KEY, AI_MODEL) selects anything else (Groq, OpenRouter, a local Ollama).
   * Used only when no Anthropic key is set.
   */
  freeAi: (() => {
    const baseUrl = env.AI_BASE_URL || (env.GEMINI_API_KEY ? "https://generativelanguage.googleapis.com/v1beta/openai" : "");
    if (!baseUrl) return null;
    return {
      baseUrl: baseUrl.replace(/\/$/, ""),
      apiKey: env.AI_API_KEY || env.GEMINI_API_KEY || "",
      // "gemini-flash-latest" follows Google's current free Flash model, so it doesn't go stale.
      model: env.AI_MODEL || (env.GEMINI_API_KEY && !env.AI_BASE_URL ? "gemini-flash-latest" : "llama3.1"),
      label: env.GEMINI_API_KEY && !env.AI_BASE_URL ? "Gemini" : "AI",
    };
  })(),
};

/** Which AI backend answers: Anthropic when its key is set, else the free OpenAI-compatible one, else none (rules only). */
export const aiProvider: "anthropic" | "free" | null = config.ai.enabled ? "anthropic" : config.freeAi ? "free" : null;
