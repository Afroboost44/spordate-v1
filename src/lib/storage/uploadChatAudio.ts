/**
 * BUG #74 — Upload d'un Blob audio enregistré dans un chat vers Firebase Storage.
 *
 * Path : `chats/{chatId}/audio/{timestamp}-{senderId}.{ext}`
 *  - chatId préfixe : permet aux rules Storage de scope l'accès aux membres du match
 *  - timestamp + senderId : unicité (pas de collision même si même chat / même sender)
 *  - ext déduit du MIME (webm | mp4 | ogg)
 *
 * Validation :
 *  - blob.size <= CHAT_AUDIO_MAX_BYTES (5 MB)
 *  - blob.type startsWith 'audio/'
 *  - durationSec <= CHAT_AUDIO_MAX_SECONDS (60s, vérifié côté client recorder)
 *
 * Pattern aligné uploadActivityMedia (DI seam pour tests).
 */

import { CHAT_AUDIO_MAX_BYTES } from '@/lib/pricing/chatPricing';

// =====================================================================
// Errors
// =====================================================================

export type ChatAudioUploadErrorCode =
  | 'invalid-input'
  | 'file-too-large'
  | 'invalid-content-type'
  | 'upload-failed';

export class ChatAudioUploadError extends Error {
  public readonly code: ChatAudioUploadErrorCode;
  public readonly details?: Record<string, unknown>;
  constructor(code: ChatAudioUploadErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = 'ChatAudioUploadError';
    this.code = code;
    this.details = details;
  }
}

// =====================================================================
// Helpers
// =====================================================================

function extensionFromMime(mime: string): string {
  const lower = (mime || '').toLowerCase();
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('mp4')) return 'mp4';
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('wav')) return 'wav';
  return 'webm';
}

function buildPath(chatId: string, senderId: string, blob: Blob): string {
  const ts = Date.now();
  const ext = extensionFromMime(blob.type);
  return `chats/${chatId}/audio/${ts}-${senderId}.${ext}`;
}

// =====================================================================
// DI seam (test injection)
// =====================================================================

interface StorageLike {
  ref(path: string): {
    put(blob: Blob): Promise<{ ref: { getDownloadURL(): Promise<string> } }>;
  };
}

let _storageOverride: StorageLike | null = null;

/** @internal — tests uniquement. */
export function __setStorageForTesting(mock: StorageLike | null): void {
  _storageOverride = mock;
}

// =====================================================================
// uploadChatAudio
// =====================================================================

export interface UploadChatAudioResult {
  url: string;
  path: string;
  contentType: string;
}

export async function uploadChatAudio(
  blob: Blob,
  chatId: string,
  senderId: string,
): Promise<UploadChatAudioResult> {
  if (!blob || !chatId || !senderId) {
    throw new ChatAudioUploadError('invalid-input', { hasBlob: !!blob, chatId, senderId });
  }
  if (!blob.type || !blob.type.startsWith('audio/')) {
    throw new ChatAudioUploadError('invalid-content-type', { type: blob.type });
  }
  if (blob.size > CHAT_AUDIO_MAX_BYTES) {
    throw new ChatAudioUploadError('file-too-large', {
      size: blob.size,
      max: CHAT_AUDIO_MAX_BYTES,
    });
  }

  const path = buildPath(chatId, senderId, blob);

  try {
    if (_storageOverride) {
      const ref = _storageOverride.ref(path);
      const snap = await ref.put(blob);
      const url = await snap.ref.getDownloadURL();
      return { url, path, contentType: blob.type };
    }
    // Prod : import dynamic firebase/storage
    const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const { default: app } = await import('@/lib/firebase');
    if (!app) {
      throw new ChatAudioUploadError('upload-failed', { reason: 'firebase-not-initialized' });
    }
    const storage = getStorage(app);
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, blob, { contentType: blob.type });
    const url = await getDownloadURL(fileRef);
    return { url, path, contentType: blob.type };
  } catch (err) {
    if (err instanceof ChatAudioUploadError) throw err;
    throw new ChatAudioUploadError('upload-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
