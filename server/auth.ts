import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { get } from "./db.js";
import type { Role } from "../shared/metrics.js";

export const SESSION_COOKIE = "aevum_session";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  locale: string;
  is_admin: number;
}

export type AppEnv = { Variables: { user: SessionUser } };

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

const signSession = (userId: string) =>
  new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`).sign(config.jwtSecret);

/**
 * Browsers get an httpOnly cookie. The native app (Capacitor) talks to the API from its own
 * origin, so it asks for the session token in the response and sends it as a Bearer header.
 */
export async function startSession(c: Context, userId: string, native = false): Promise<string | undefined> {
  const token = await signSession(userId);
  if (native) return token;
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return undefined;
}

export function endSession(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Session JWTs in an Authorization header (native app). Device tokens start with "aev_" and are handled elsewhere. */
export function bearerSession(c: Context): string | null {
  const h = c.req.header("authorization");
  return h?.startsWith("Bearer ") && !h.startsWith("Bearer aev_") ? h.slice(7) : null;
}

async function readSession(c: Context): Promise<SessionUser | null> {
  const token = bearerSession(c) ?? getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return get<SessionUser>("SELECT id, email, name, role, locale, is_admin FROM users WHERE id = ?", payload.sub) ?? null;
  } catch {
    return null;
  }
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
};

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const u = c.get("user");
    if (!roles.includes(u.role) && !(roles.includes("admin") && u.is_admin)) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user").is_admin) return c.json({ error: "forbidden" }, 403);
  await next();
};
