"""RBAC matrix (SECURITY.md §4). The single place that decides who may do what."""

from __future__ import annotations

from enum import StrEnum

from .enums import ROLE_RANK, Role


class Permission(StrEnum):
    ORG_DELETE = "org.delete"
    ORG_MANAGE = "org.manage"
    MEMBERS_READ = "members.read"
    MEMBERS_MANAGE = "members.manage"
    PROJECT_READ = "project.read"
    PROJECT_WRITE = "project.write"
    PROJECT_DELETE = "project.delete"
    SURVEY_EDIT = "survey.edit"
    SURVEY_PUBLISH = "survey.publish"
    RESPONSES_READ_RAW = "responses.read_raw"
    RESPONSES_EXPORT = "responses.export"
    RESPONSES_DELETE = "responses.delete"
    ANALYTICS_READ = "analytics.read"
    AI_USE = "ai.use"
    AI_ANALYZE = "ai.analyze"
    REPORTS_CREATE = "reports.create"
    REPORTS_READ = "reports.read"
    AUDIT_READ = "audit.read"
    INTEGRATIONS_MANAGE = "integrations.manage"
    AI_USAGE_READ = "ai.usage.read"


P = Permission

_VIEWER = {P.PROJECT_READ, P.ANALYTICS_READ, P.REPORTS_READ, P.MEMBERS_READ}
_ANALYST = _VIEWER | {P.RESPONSES_READ_RAW, P.RESPONSES_EXPORT, P.AI_ANALYZE, P.REPORTS_CREATE}
_EDITOR = _ANALYST - {P.RESPONSES_EXPORT} | {
    P.PROJECT_WRITE,
    P.PROJECT_DELETE,
    P.SURVEY_EDIT,
    P.SURVEY_PUBLISH,
    P.AI_USE,
}
_ADMIN = (
    _EDITOR
    | _ANALYST
    | {
        P.ORG_MANAGE,
        P.MEMBERS_MANAGE,
        P.RESPONSES_DELETE,
        P.AUDIT_READ,
        P.INTEGRATIONS_MANAGE,
        P.AI_USAGE_READ,
    }
)
_OWNER = _ADMIN | {P.ORG_DELETE}

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.VIEWER: frozenset(_VIEWER),
    Role.ANALYST: frozenset(_ANALYST),
    Role.EDITOR: frozenset(_EDITOR),
    Role.ADMIN: frozenset(_ADMIN),
    Role.OWNER: frozenset(_OWNER),
}


def has_permission(role: Role, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS[role]


def can_assign_role(actor: Role, target_role: Role) -> bool:
    """OWNER can assign any role; ADMIN can assign up to ADMIN (never OWNER)."""
    if actor == Role.OWNER:
        return True
    if actor == Role.ADMIN:
        return target_role != Role.OWNER
    return False


def can_manage_member(actor: Role, member_role: Role) -> bool:
    """ADMIN cannot modify an OWNER; nobody below ADMIN manages members."""
    if actor == Role.OWNER:
        return True
    return actor == Role.ADMIN and ROLE_RANK[member_role] < ROLE_RANK[Role.OWNER]
