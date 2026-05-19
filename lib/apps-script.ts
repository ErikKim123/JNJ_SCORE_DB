// Compatibility shim — pages import from this file; underlying impl moved to
// lib/api-client.ts (Supabase-backed /api/db/* routes). Old AppsScriptError
// name is preserved so existing catch blocks keep working.

export { ApiError as AppsScriptError, getCompetitions, getJudges, getEvent, getRound, submitRound } from './api-client';
