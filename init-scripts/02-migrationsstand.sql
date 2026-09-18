-- ====================================================================
-- Migrationsstand des Dumps aus 01-create-schema.sql
--
-- ERZEUGT, NICHT VON HAND GEPFLEGT.
-- Quelle: backend/tests/schema/prod-migrations.txt
-- Erneuern mit: bash init-scripts/refresh.sh
--
-- Das Schema oben enthaelt diese Migrationen bereits. Ohne die Eintraege
-- hier wuerde backend/database.js sie beim ersten Backend-Start erneut
-- anwenden. Alles, was danach kommt, laeuft regulaer nach.
-- ====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (name) VALUES
    ('064_add_missing_fks.sql'),
    ('064_add_missing_indexes.sql'),
    ('064_consolidate_inline_schemas.sql'),
    ('068_refresh_tokens.sql'),
    ('075_wrapped.sql'),
    ('076_badges_rename_migrations.sql'),
    ('077_activity_requests_rename_konfi_id.sql'),
    ('078_add_idempotency_keys.sql'),
    ('079_add_invite_codes.sql'),
    ('080_add_push_foundation.sql'),
    ('081_roles_descriptions.sql'),
    ('082_self_auto_deletion.sql'),
    ('083_org_konfi_limit.sql'),
    ('084_user_push_enabled.sql'),
    ('085_levels_icon_deemojify.sql'),
    ('086_org_kirchenkreis.sql'),
    ('087_org_trial.sql'),
    ('088_org_contact_name.sql'),
    ('089_org_license_reminder.sql'),
    ('090_drop_legacy_badges.sql'),
    ('091_event_is_konfirmation.sql'),
    ('092_sync_schema_drift.sql'),
    ('093_konfspruch.sql'),
    ('094_jahrgang_konfspruch_enabled.sql'),
    ('095_push_tokens_unique_token.sql'),
    ('096_konfi_role_for_all_orgs.sql'),
    ('097_fix_sqlite_global_unique_to_per_org.sql'),
    ('098_fix_teamer_chat_participant_type.sql'),
    ('099_chat_participants_allow_teamer.sql'),
    ('100_chat_participants_unique.sql'),
    ('101_user_organizations.sql'),
    ('102_chat_rooms_cascade.sql'),
    ('103_jahrgang_deletion_reminder.sql'),
    ('104_team_chat.sql'),
    ('105_apm_snapshots.sql'),
    ('106_poll_anonymous_exclusive.sql'),
    ('107_users_bible_translation.sql'),
    ('108_event_registration_push.sql'),
    ('109_socketio_pg_adapter.sql'),
    ('110_activity_categories_integrity.sql'),
    ('111_cleanup_orphaned_direct_rooms.sql'),
    ('112_add_missing_org_fks.sql'),
    ('113_drop_redundant_duplicate_fks.sql'),
    ('114_add_chat_fks.sql'),
    ('115_not_null_hardening.sql'),
    ('116_drop_duplicate_indexes.sql'),
    ('117_fix_chat_participant_user_types.sql'),
    ('118_challenges.sql'),
    ('119_challenges_created_by_set_null.sql'),
    ('120_event_teamer_kontingent.sql'),
    ('121_challenges_audience.sql'),
    ('122_challenges_audience_default_team.sql'),
    ('123_password_resets_token_hashen.sql')
ON CONFLICT (name) DO NOTHING;
