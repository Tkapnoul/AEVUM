import { get } from "../db.js";
import type { SessionUser } from "../auth.js";
import { EXPERT_ROLES } from "../../shared/metrics.js";

export const isExpert = (u: SessionUser) => EXPERT_ROLES.includes(u.role);

/** An expert is linked to a member through the care team or a (non-cancelled) booking. */
export function isLinked(memberId: string, expertId: string): boolean {
  return Boolean(
    get(
      `SELECT 1 FROM care_team WHERE member_id = ? AND expert_id = ?
       UNION SELECT 1 FROM bookings WHERE member_id = ? AND expert_id = ? AND status != 'cancelled'
       LIMIT 1`,
      memberId, expertId, memberId, expertId,
    ),
  );
}

/** A member's health data is visible to the member, admins, and linked experts. */
export function canViewMember(viewer: SessionUser, memberId: string): boolean {
  if (viewer.id === memberId || viewer.role === "admin") return true;
  return isExpert(viewer) && isLinked(memberId, viewer.id);
}
