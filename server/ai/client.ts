import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

export const anthropic = config.ai.enabled ? new Anthropic() : null;

// Server-side fallback: if a safety classifier declines, the API retries on the recommended fallback model.
export const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
