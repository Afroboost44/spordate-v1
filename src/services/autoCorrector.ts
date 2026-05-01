/**
 * Spordateur V2 — Auto-Correction Service
 * Monitors error patterns and automatically fixes known issues
 * Server-side patterns using Firebase Admin SDK patterns
 */

import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  writeBatch,
  increment,
  Timestamp,
} from 'firebase/firestore';

import type { UserProfile, Match, Transaction, Booking, ErrorLog } from '@/types/firestore';
import { updateUserCredits, updateMatch, updateBooking, resolveError, logError } from '@/services/firestore';

// ===================== TYPES =====================

export interface CorrectionResult {
  pattern: string;
  itemId: string;
  description: string;
  fixed: boolean;
  details?: Record<string, unknown>;
}

export interface AutoCorrectorReport {
  timestamp: string;
  totalScanned: number;
  totalFixed: number;
  corrections: CorrectionResult[];
  errors: string[];
}

// ===================== AUTO-CORRECTION PATTERNS =====================

/**
 * Pattern 1: Negative credits
 * Fixes users with negative credit balance by resetting to 0
 */
async function fixNegativeCredits(): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];

  try {
    const usersSnap = await getDocs(collection(db, 'users'));

    for (const userDoc of usersSnap.docs) {
      const user = userDoc.data() as UserProfile;

      if (user.credits < 0) {
        const previousBalance = user.credits;

        // Reset to 0
        await updateDoc(doc(db, 'users', user.uid), { credits: 0 });

        // Log the correction
        await logError({
          source: 'function',
          level: 'warning',
          message: `Auto-corrected negative credits for user ${user.uid}`,
          stackTrace: 'Auto-correction: Pattern 1 - Negative Credits',
          userId: user.uid,
          url: 'auto-corrector',
          userAgent: 'auto-corrector/v2',
          metadata: { previousBalance, correctedTo: 0 },
        });

        results.push({
          pattern: 'negative_credits',
          itemId: user.uid,
          description: `Reset negative credits (${previousBalance}) to 0`,
          fixed: true,
          details: { userId: user.uid, previousBalance, correctedTo: 0 },
        });
      }
    }
  } catch (error) {
    console.error('[AutoCorrector] Error fixing negative credits:', error);
  }

  return results;
}

/**
 * Pattern 2: Orphan transactions
 * Finds transactions marked as succeeded but no credits were granted
 */
async function fixOrphanTransactions(): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];

  try {
    const txSnap = await getDocs(
      query(collection(db, 'transactions'), where('status', '==', 'succeeded'))
    );

    for (const txDoc of txSnap.docs) {
      const tx = txDoc.data() as Transaction;

      // Check if credits were actually granted
      if (tx.creditsGranted === 0 || tx.creditsGranted === undefined) {
        const creditsToGrant = tx.creditsGranted || 1; // Default to 1 if missing

        try {
          // Grant the credits
          await updateUserCredits(
            tx.userId,
            creditsToGrant,
            'purchase',
            `Orphan transaction recovery: ${tx.transactionId}`,
            tx.transactionId
          );

          // Mark as resolved
          await resolveError(tx.transactionId);

          results.push({
            pattern: 'orphan_transaction',
            itemId: tx.transactionId,
            description: `Granted ${creditsToGrant} credits for orphan transaction`,
            fixed: true,
            details: {
              transactionId: tx.transactionId,
              userId: tx.userId,
              creditsGranted: creditsToGrant,
              amount: tx.amount,
            },
          });
        } catch (error) {
          results.push({
            pattern: 'orphan_transaction',
            itemId: tx.transactionId,
            description: `Failed to grant credits for orphan transaction`,
            fixed: false,
            details: { error: String(error) },
          });
        }
      }
    }
  } catch (error) {
    console.error('[AutoCorrector] Error fixing orphan transactions:', error);
  }

  return results;
}

/**
 * Pattern 3: Expired matches not cleaned
 * Sets status to "expired" for matches past their expiration time
 */
async function fixExpiredMatches(): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];

  try {
    const matchSnap = await getDocs(
      query(
        collection(db, 'matches'),
        where('status', '==', 'pending')
      )
    );

    const now = Timestamp.now();

    for (const matchDoc of matchSnap.docs) {
      const match = matchDoc.data() as Match;

      if (match.expiresAt && match.expiresAt < now) {
        // Update status to expired
        await updateMatch(match.matchId, { status: 'expired' });

        results.push({
          pattern: 'expired_match_cleanup',
          itemId: match.matchId,
          description: `Marked expired match as "expired"`,
          fixed: true,
          details: {
            matchId: match.matchId,
            userIds: match.userIds,
            expiresAt: match.expiresAt.toDate().toISOString(),
          },
        });
      }
    }
  } catch (error) {
    console.error('[AutoCorrector] Error fixing expired matches:', error);
  }

  return results;
}

/**
 * Pattern 4: Unlocked chats without confirmed booking
 * Re-locks chats if no confirmed booking exists
 */
async function fixUnlockedChatsWithoutBooking(): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];

  try {
    const chatsSnap = await getDocs(
      query(
        collection(db, 'matches'),
        where('chatUnlocked', '==', true)
      )
    );

    for (const chatDoc of chatsSnap.docs) {
      const match = chatDoc.data() as Match;

      // Check if there's a confirmed booking linked to this match
      const bookingsSnap = await getDocs(
        query(
          collection(db, 'bookings'),
          where('matchId', '==', match.matchId),
          where('status', '==', 'confirmed')
        )
      );

      if (bookingsSnap.empty) {
        // Re-lock the chat
        await updateMatch(match.matchId, { chatUnlocked: false });

        results.push({
          pattern: 'unlocked_chat_without_booking',
          itemId: match.matchId,
          description: `Re-locked chat without confirmed booking`,
          fixed: true,
          details: {
            matchId: match.matchId,
            userIds: match.userIds,
          },
        });
      }
    }
  } catch (error) {
    console.error('[AutoCorrector] Error fixing unlocked chats:', error);
  }

  return results;
}

/**
 * Pattern 5: Double payments detected
 * Flags duplicate transactions within 5 minutes for the same user and amount
 */
async function flagDoublePacements(): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];

  try {
    const txSnap = await getDocs(
      query(
        collection(db, 'transactions'),
        where('status', '==', 'succeeded')
      )
    );

    const transactions = txSnap.docs.map(d => d.data() as Transaction);

    // Group by userId and check for duplicates
    const userTransactions: Record<string, Transaction[]> = {};

    for (const tx of transactions) {
      if (!userTransactions[tx.userId]) {
        userTransactions[tx.userId] = [];
      }
      userTransactions[tx.userId].push(tx);
    }

    // Check each user's transactions for duplicates
    for (const [userId, userTxs] of Object.entries(userTransactions)) {
      for (let i = 0; i < userTxs.length; i++) {
        for (let j = i + 1; j < userTxs.length; j++) {
          const tx1 = userTxs[i];
          const tx2 = userTxs[j];

          // Check if same amount and within 5 minutes
          const timeDiff = Math.abs(
            tx1.createdAt.toMillis() - tx2.createdAt.toMillis()
          );

          if (tx1.amount === tx2.amount && timeDiff < 5 * 60 * 1000) {
            // Flag for admin refund
            await logError({
              source: 'function',
              level: 'critical',
              message: `Potential double payment detected for user ${userId}`,
              stackTrace: 'Auto-correction: Pattern 5 - Double Payment Detection',
              userId,
              url: 'auto-corrector',
              userAgent: 'auto-corrector/v2',
              metadata: {
                transactionId1: tx1.transactionId,
                transactionId2: tx2.transactionId,
                amount: tx1.amount,
                timeDiffSeconds: timeDiff / 1000,
              },
            });

            results.push({
              pattern: 'double_payment',
              itemId: tx1.transactionId,
              description: `Flagged potential double payment with ${tx2.transactionId}`,
              fixed: false, // Requires manual admin review
              details: {
                transactionId1: tx1.transactionId,
                transactionId2: tx2.transactionId,
                userId,
                amount: tx1.amount,
                timeDiffSeconds: timeDiff / 1000,
              },
            });

            // Only flag once per transaction pair
            break;
          }
        }
      }
    }
  } catch (error) {
    console.error('[AutoCorrector] Error detecting double payments:', error);
  }

  return results;
}

// ===================== MAIN AUTO-CORRECTOR FUNCTION =====================

/**
 * Run all auto-correction patterns
 * Returns a comprehensive report
 */
export async function runAutoCorrections(): Promise<AutoCorrectorReport> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const errors: string[] = [];
  let totalScanned = 0;
  let totalFixed = 0;
  const corrections: CorrectionResult[] = [];

  console.log('[AutoCorrector] Starting auto-correction cycle...');

  // Pattern 1: Negative Credits
  try {
    const results = await fixNegativeCredits();
    corrections.push(...results);
    totalScanned += (await getDocs(collection(db, 'users'))).size;
    totalFixed += results.filter(r => r.fixed).length;
    console.log(`[AutoCorrector] Pattern 1: Found ${results.length} negative credit issues`);
  } catch (error) {
    const msg = `Pattern 1 (Negative Credits) failed: ${error}`;
    errors.push(msg);
    console.error(msg);
  }

  // Pattern 2: Orphan Transactions
  try {
    const results = await fixOrphanTransactions();
    corrections.push(...results);
    totalScanned += (await getDocs(query(collection(db, 'transactions'), where('status', '==', 'succeeded')))).size;
    totalFixed += results.filter(r => r.fixed).length;
    console.log(`[AutoCorrector] Pattern 2: Found ${results.length} orphan transactions`);
  } catch (error) {
    const msg = `Pattern 2 (Orphan Transactions) failed: ${error}`;
    errors.push(msg);
    console.error(msg);
  }

  // Pattern 3: Expired Matches
  try {
    const results = await fixExpiredMatches();
    corrections.push(...results);
    totalScanned += (await getDocs(query(collection(db, 'matches'), where('status', '==', 'pending')))).size;
    totalFixed += results.filter(r => r.fixed).length;
    console.log(`[AutoCorrector] Pattern 3: Found ${results.length} expired matches`);
  } catch (error) {
    const msg = `Pattern 3 (Expired Matches) failed: ${error}`;
    errors.push(msg);
    console.error(msg);
  }

  // Pattern 4: Unlocked Chats Without Booking
  try {
    const results = await fixUnlockedChatsWithoutBooking();
    corrections.push(...results);
    totalScanned += (await getDocs(query(collection(db, 'matches'), where('chatUnlocked', '==', true)))).size;
    totalFixed += results.filter(r => r.fixed).length;
    console.log(`[AutoCorrector] Pattern 4: Found ${results.length} unlocked chats without booking`);
  } catch (error) {
    const msg = `Pattern 4 (Unlocked Chats) failed: ${error}`;
    errors.push(msg);
    console.error(msg);
  }

  // Pattern 5: Double Payments
  try {
    const results = await flagDoublePacements();
    corrections.push(...results);
    totalScanned += (await getDocs(query(collection(db, 'transactions'), where('status', '==', 'succeeded')))).size;
    totalFixed += results.filter(r => r.fixed).length;
    console.log(`[AutoCorrector] Pattern 5: Found ${results.length} potential double payments`);
  } catch (error) {
    const msg = `Pattern 5 (Double Payments) failed: ${error}`;
    errors.push(msg);
    console.error(msg);
  }

  const endTime = Date.now();

  const report: AutoCorrectorReport = {
    timestamp,
    totalScanned,
    totalFixed,
    corrections,
    errors,
  };

  console.log(`[AutoCorrector] Cycle completed in ${endTime - startTime}ms`, report);

  return report;
}

/**
 * Run a specific pattern (useful for testing)
 */
export async function runSinglePattern(
  pattern: 'negative_credits' | 'orphan_transactions' | 'expired_matches' | 'unlocked_chats' | 'double_payments'
): Promise<CorrectionResult[]> {
  switch (pattern) {
    case 'negative_credits':
      return fixNegativeCredits();
    case 'orphan_transactions':
      return fixOrphanTransactions();
    case 'expired_matches':
      return fixExpiredMatches();
    case 'unlocked_chats':
      return fixUnlockedChatsWithoutBooking();
    case 'double_payments':
      return flagDoublePacements();
    default:
      throw new Error(`Unknown pattern: ${pattern}`);
  }
}

// ===================== EXPORTS =====================
// (CorrectionResult et AutoCorrectorReport déjà exportés via `export interface` ci-dessus)
