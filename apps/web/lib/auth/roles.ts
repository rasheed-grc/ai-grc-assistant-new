/**
 * RBAC roles — a 1:1 mirror of the backend `UserRole` enum
 * (`packages/domain/.../tenancy/enums.py`). Keeping these identical is what lets a
 * frontend session and a backend `Principal` describe the same identity. If the
 * backend roster changes, change it here too.
 */

export const USER_ROLES = [
  "owner",
  "admin",
  "compliance_manager",
  "risk_manager",
  "analyst",
  "auditor",
  "viewer",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface RoleMeta {
  label: string;
  description: string;
}

export const ROLE_META: Record<UserRole, RoleMeta> = {
  owner: { label: "Owner", description: "Full access to the organization: settings, team, data and approvals." },
  admin: { label: "Administrator", description: "Full administrative access within the tenant." },
  compliance_manager: {
    label: "Compliance Manager",
    description: "Runs the operational GRC lifecycle, including approvals and publishing.",
  },
  risk_manager: {
    label: "Risk Manager",
    description: "Owns the risk register end to end and can drive missions.",
  },
  analyst: {
    label: "Analyst",
    description: "Authors and executes operational work; cannot approve, publish, or delete.",
  },
  auditor: {
    label: "Auditor",
    description: "Read-only access to everything, including the audit trail.",
  },
  viewer: { label: "Viewer", description: "Read-only access to operational and catalog data." },
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/** The single highest-privilege role a user holds, for compact display in the UI. */
export function primaryRole(roles: readonly UserRole[]): UserRole | null {
  for (const role of USER_ROLES) {
    if (roles.includes(role)) return role;
  }
  return null;
}
