"""subscriptions: plans, a subscription per workspace, monthly usage; one-time link purposes

Revision ID: 0010_subscriptions
Revises: 0009_gifts
Create Date: 2026-10-17 12:19:24.079648+00:00

The workspace limits added for gifts (0009) move to subscriptions: gifted workspaces get the
«trial» plan with their own survey limit, every other workspace the unlimited «enterprise»
plan, so nothing changes for anyone on upgrade.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0010_subscriptions'
down_revision: str | None = '0009_gifts'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ALL_FEATURES = '["cx", "integrations", "exports", "ai_analysis", "ai_followup"]'

# Frozen copy of the default plans at the time of this migration (app.domain.subscription).
PLANS = [
    # code, name_ar, name_en, description_ar, description_en, is_trial, days, surveys, responses, members, ai, features, order
    ("trial", "تجريبية", "Trial", "لتجربة المنصة كاملة لفترة محدودة.", "Try the whole platform for a limited time.",
     True, 14, 3, 300, 3, 300000, ALL_FEATURES, 1),
    ("basic", "أساسية", "Basic", "لقياس الأثر والرضا في جهة واحدة.",
     "Impact and satisfaction measurement for one organization.",
     False, 365, 10, 1000, 3, 500000, '["exports", "ai_analysis", "ai_followup"]', 2),
    ("pro", "احترافية", "Professional", "كل الوحدات، ومنها تجربة العملاء وتكامل المتاجر.",
     "Every module, including customer experience and store integrations.",
     False, 365, 50, 5000, 10, 1500000, ALL_FEATURES, 3),
    ("enterprise", "مؤسسات", "Enterprise", "بلا حدود للاستبانات والردود والأعضاء.",
     "No limits on surveys, responses or members.",
     False, None, None, None, None, None, ALL_FEATURES, 4),
]


def upgrade() -> None:
    op.create_table('subscription_plans',
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('name_ar', sa.String(length=80), nullable=False),
    sa.Column('name_en', sa.String(length=80), nullable=False),
    sa.Column('description_ar', sa.Text(), server_default='', nullable=False),
    sa.Column('description_en', sa.Text(), server_default='', nullable=False),
    sa.Column('is_trial', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('default_days', sa.Integer(), nullable=True),
    sa.Column('max_surveys', sa.Integer(), nullable=True),
    sa.Column('max_responses_per_month', sa.Integer(), nullable=True),
    sa.Column('max_members', sa.Integer(), nullable=True),
    sa.Column('ai_daily_tokens', sa.Integer(), nullable=True),
    sa.Column('features', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('is_archived', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_subscription_plans')),
    sa.UniqueConstraint('code', name=op.f('uq_subscription_plans_code'))
    )
    op.create_table('subscriptions',
    sa.Column('organization_id', sa.UUID(), nullable=False),
    sa.Column('plan_id', sa.UUID(), nullable=False),
    sa.Column('period_started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('period_ends_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('pending_days', sa.Integer(), nullable=True),
    sa.Column('surveys_used', sa.Integer(), server_default='0', nullable=False),
    sa.Column('overrides', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    sa.Column('suspended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('suspension_reason', sa.String(length=300), server_default='', nullable=False),
    sa.Column('admin_note', sa.Text(), server_default='', nullable=False),
    sa.Column('notices', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    sa.Column('updated_by_id', sa.UUID(), nullable=True),
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_subscriptions_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['plan_id'], ['subscription_plans.id'], name=op.f('fk_subscriptions_plan_id_subscription_plans'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], name=op.f('fk_subscriptions_updated_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_subscriptions')),
    sa.UniqueConstraint('organization_id', name=op.f('uq_subscriptions_organization_id'))
    )
    op.create_index(op.f('ix_subscriptions_plan_id'), 'subscriptions', ['plan_id'], unique=False)
    op.create_table('usage_monthly',
    sa.Column('organization_id', sa.UUID(), nullable=False),
    sa.Column('month', sa.String(length=7), nullable=False),
    sa.Column('responses', sa.Integer(), server_default='0', nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_usage_monthly_organization_id_organizations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('organization_id', 'month', name=op.f('pk_usage_monthly'))
    )
    op.add_column('password_reset_tokens', sa.Column('purpose', sa.Enum('RESET', 'ACTIVATE', name='tokenpurpose', native_enum=False, length=16), server_default='RESET', nullable=False))
    op.add_column('password_reset_tokens', sa.Column('created_by_id', sa.UUID(), nullable=True))
    op.create_foreign_key(op.f('fk_password_reset_tokens_created_by_id_users'), 'password_reset_tokens', 'users', ['created_by_id'], ['id'], ondelete='SET NULL')

    # ---- data: plans, a subscription for every workspace, monthly usage so far
    insert = sa.text(
        "INSERT INTO subscription_plans (id, code, name_ar, name_en, description_ar, description_en, is_trial, "
        "default_days, max_surveys, max_responses_per_month, max_members, ai_daily_tokens, features, sort_order) "
        "VALUES (gen_random_uuid(), :code, :name_ar, :name_en, :d_ar, :d_en, :trial, :days, :surveys, :responses, "
        ":members, :ai, CAST(:features AS jsonb), :sort)"
    )
    for code, name_ar, name_en, d_ar, d_en, trial, days, surveys, responses, members, ai, features, order in PLANS:
        op.execute(
            insert.bindparams(
                code=code, name_ar=name_ar, name_en=name_en, d_ar=d_ar, d_en=d_en, trial=trial, days=days,
                surveys=surveys, responses=responses, members=members, ai=ai, features=features, sort=order,
            )
        )
    # Gifted workspaces → «trial» with their own limits; a gift not activated yet starts its
    # period on activation. Every other workspace → «enterprise» (unlimited), as before.
    op.execute(
        """
        INSERT INTO subscriptions (id, organization_id, plan_id, period_started_at, period_ends_at, pending_days,
                                   surveys_used, overrides)
        SELECT gen_random_uuid(), o.id,
               (SELECT p.id FROM subscription_plans p WHERE p.code = CASE
                    WHEN o.survey_limit IS NOT NULL OR o.trial_ends_at IS NOT NULL OR g.id IS NOT NULL
                    THEN 'trial' ELSE 'enterprise' END),
               CASE WHEN g.status = 'PENDING' THEN NULL ELSE COALESCE(g.activated_at, o.created_at) END,
               o.trial_ends_at,
               CASE WHEN g.status = 'PENDING' THEN g.trial_days ELSE NULL END,
               o.surveys_published,
               jsonb_strip_nulls(jsonb_build_object('surveys', o.survey_limit,
                                                    'ai_daily_tokens', o.ai_daily_token_limit))
        FROM organizations o
        LEFT JOIN LATERAL (
            SELECT gifts.id, gifts.status, gifts.activated_at, gifts.trial_days FROM gifts
            WHERE gifts.organization_id = o.id ORDER BY gifts.created_at DESC LIMIT 1
        ) g ON true
        """
    )
    op.execute(
        """
        INSERT INTO usage_monthly (organization_id, month, responses)
        SELECT r.organization_id,
               to_char(r.created_at AT TIME ZONE COALESCE(
                   (SELECT name FROM pg_timezone_names WHERE name = o.timezone LIMIT 1), 'UTC'), 'YYYY-MM'),
               count(*)
        FROM responses r JOIN organizations o ON o.id = r.organization_id
        WHERE r.status = 'COMPLETED'
        GROUP BY 1, 2
        """
    )
    op.drop_column('organizations', 'survey_limit')
    op.drop_column('organizations', 'trial_ends_at')
    op.drop_column('organizations', 'surveys_published')
    op.drop_column('organizations', 'ai_daily_token_limit')


def downgrade() -> None:
    op.add_column('organizations', sa.Column('ai_daily_token_limit', sa.INTEGER(), autoincrement=False, nullable=True))
    op.add_column('organizations', sa.Column('surveys_published', sa.INTEGER(), server_default=sa.text('0'), autoincrement=False, nullable=False))
    op.add_column('organizations', sa.Column('trial_ends_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True))
    op.add_column('organizations', sa.Column('survey_limit', sa.INTEGER(), autoincrement=False, nullable=True))
    # Trial limits go back to the workspace; other plans had no workspace-level limits.
    op.execute(
        """
        UPDATE organizations o SET
            surveys_published = s.surveys_used,
            survey_limit = CASE WHEN p.is_trial THEN COALESCE((s.overrides->>'surveys')::int, p.max_surveys) END,
            trial_ends_at = CASE WHEN p.is_trial THEN s.period_ends_at END,
            ai_daily_token_limit = CASE WHEN p.is_trial THEN COALESCE((s.overrides->>'ai_daily_tokens')::int,
                                                                       p.ai_daily_tokens) END
        FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.organization_id = o.id
        """
    )
    op.execute("DELETE FROM password_reset_tokens WHERE purpose <> 'RESET'")
    op.drop_constraint(op.f('fk_password_reset_tokens_created_by_id_users'), 'password_reset_tokens', type_='foreignkey')
    op.drop_column('password_reset_tokens', 'created_by_id')
    op.drop_column('password_reset_tokens', 'purpose')
    op.drop_table('usage_monthly')
    op.drop_index(op.f('ix_subscriptions_plan_id'), table_name='subscriptions')
    op.drop_table('subscriptions')
    op.drop_table('subscription_plans')
