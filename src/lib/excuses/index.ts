/**
 * Phase 9 sub-chantier 5 commit 1/4 — Excuses public API.
 *
 * Doctrine architecture.md ligne 895 : excuse pré-session ≥2h avant = no-show
 * pas comptabilisé (Q1=A 2h hardcoded Phase 9 KISS).
 *
 * Usage :
 *   import { createExcuse, ExcuseError } from '@/lib/excuses';
 */

// Service functions
export { createExcuse, type CreateExcuseInput, type CreateExcuseResult } from './createExcuse';

// Constants + errors typés
export {
  EXCUSE_WINDOW_HOURS_BEFORE_SESSION,
  EXCUSE_REASON_MAX_LENGTH,
  ExcuseError,
  type ExcuseErrorCode,
} from './_internal';

// Test seam
export { __setExcusesDbForTesting } from './_internal';
