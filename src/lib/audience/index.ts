/**
 * Phase 9 sub-chantier 6 commit 1/4 — Audience helpers public API.
 *
 * Doctrine architecture.md §9.sexies G : female-safety women-priority quota active Phase 9.
 * Q3=A + Q4=A hard enforcement booking 'women-only' + 'men-only'.
 * Q2=C matching boost mixed-priority-women defer Phase 10.
 *
 * Usage :
 *   import { isAllowedByAudience, AudienceError, AUDIENCE_TYPES } from '@/lib/audience';
 */

export {
  AUDIENCE_TYPES,
  isAudienceType,
  isAllowedByAudience,
  assertAllowedByAudience,
  AudienceError,
  type AudienceType,
  type AudienceErrorCode,
} from './_internal';
