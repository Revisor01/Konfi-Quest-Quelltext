
DROP INDEX IF EXISTS idx_chat_rooms_org;            -- identisch zu idx_chat_rooms_organization_id
DROP INDEX IF EXISTS idx_invite_codes_code;         -- redundant zu Unique invite_codes_code_key
DROP INDEX IF EXISTS idx_refresh_tokens_token_hash; -- redundant zu Unique refresh_tokens_token_hash_key
