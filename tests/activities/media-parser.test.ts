/**
 * Tests Phase 9.5 c4 — mediaParser pure unit (parseVideoUrl + isImageUrl).
 *
 * Exécution :
 *   npm run test:activities:media-parser
 *
 * Pattern : pure unit tests (no emulator) — helpers stateless.
 *
 * Couverture (MP1-MP6 + bonus) :
 *   MP1 youtube watch?v=ID → provider=youtube + videoId + embedUrl
 *   MP2 youtu.be/ID → idem
 *   MP3 vimeo.com/ID → provider=vimeo + videoId + embedUrl
 *   MP4 drive.google.com/file/d/ID/view → provider=drive + fileId + embedUrl preview
 *   MP5 invalid URL → null
 *   MP6 isImageUrl extensions check (jpg/png/gif/webp/svg/avif)
 *
 * Bonus :
 *   - youtube embed/ format
 *   - youtube avec query params extra (&t=120)
 *   - drive open?id= format
 *   - vimeo player.vimeo.com/video/
 *   - empty/null input → null/false
 *   - Firebase Storage URL (firebasestorage.googleapis.com) → image extension match
 */

import { parseVideoUrl, isImageUrl, getVideoThumbnail } from '../../src/lib/activities/mediaParser';

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, info?: unknown): void {
  console.log(`FAIL  ${label}`, info ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================

async function main(): Promise<void> {
  // ===================================================================
  // MP1 youtube watch?v=
  // ===================================================================
  section('MP1 youtube watch?v=ID → provider=youtube + videoId + embedUrl');
  {
    const r = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    if (
      r &&
      r.provider === 'youtube' &&
      r.videoId === 'dQw4w9WgXcQ' &&
      r.embedUrl === 'https://www.youtube.com/embed/dQw4w9WgXcQ'
    ) {
      pass('MP1 youtube watch parsed correctly');
    } else {
      fail('MP1 unexpected', r);
    }
  }

  // ===================================================================
  // MP2 youtu.be short
  // ===================================================================
  section('MP2 youtu.be/ID → provider=youtube + videoId + embedUrl');
  {
    const r = parseVideoUrl('https://youtu.be/abc12345678');
    if (
      r &&
      r.provider === 'youtube' &&
      r.videoId === 'abc12345678' &&
      r.embedUrl === 'https://www.youtube.com/embed/abc12345678'
    ) {
      pass('MP2 youtu.be parsed correctly');
    } else {
      fail('MP2 unexpected', r);
    }
  }

  // ===================================================================
  // MP3 vimeo.com/ID
  // ===================================================================
  section('MP3 vimeo.com/ID → provider=vimeo + videoId + embedUrl player');
  {
    const r = parseVideoUrl('https://vimeo.com/123456789');
    if (
      r &&
      r.provider === 'vimeo' &&
      r.videoId === '123456789' &&
      r.embedUrl === 'https://player.vimeo.com/video/123456789'
    ) {
      pass('MP3 vimeo.com parsed correctly');
    } else {
      fail('MP3 unexpected', r);
    }
  }

  // ===================================================================
  // MP4 drive.google.com/file/d/ID/view
  // ===================================================================
  section('MP4 drive.google.com/file/d/ID/view → provider=drive + fileId + preview embedUrl');
  {
    const r = parseVideoUrl('https://drive.google.com/file/d/1aBc2DeF3GhI4JkL5MnO/view');
    if (
      r &&
      r.provider === 'drive' &&
      r.videoId === '1aBc2DeF3GhI4JkL5MnO' &&
      r.embedUrl === 'https://drive.google.com/file/d/1aBc2DeF3GhI4JkL5MnO/preview'
    ) {
      pass('MP4 drive parsed correctly');
    } else {
      fail('MP4 unexpected', r);
    }
  }

  // ===================================================================
  // MP5 invalid URL → null
  // ===================================================================
  section('MP5 invalid URL → null');
  {
    const tests = [
      'https://example.com/random-page',
      'not-a-url',
      'https://google.com',
      '',
      null,
      undefined,
    ];
    let allOk = true;
    for (const t of tests) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (parseVideoUrl(t as any) !== null) {
        allOk = false;
        fail(`MP5 ${JSON.stringify(t)} should be null`);
        break;
      }
    }
    if (allOk) pass('MP5 invalid URLs all → null (6 cases)');
  }

  // ===================================================================
  // MP6 isImageUrl extensions
  // ===================================================================
  section('MP6 isImageUrl extensions check');
  {
    const trueCases = [
      'https://example.com/photo.jpg',
      'https://example.com/photo.JPEG',
      'https://example.com/photo.png',
      'https://example.com/photo.gif',
      'https://example.com/photo.webp',
      'https://example.com/photo.svg',
      'https://example.com/photo.avif',
    ];
    const falseCases = [
      'https://example.com/video.mp4',
      'https://example.com/page.html',
      'https://example.com/no-extension',
      '',
    ];
    let allOk = true;
    for (const t of trueCases) {
      if (!isImageUrl(t)) {
        allOk = false;
        fail(`MP6 ${t} should be true`);
        break;
      }
    }
    for (const t of falseCases) {
      if (isImageUrl(t)) {
        allOk = false;
        fail(`MP6 ${t} should be false`);
        break;
      }
    }
    if (allOk) pass('MP6 isImageUrl 7 true + 4 false cases');
  }

  // ===================================================================
  // Bonus : youtube embed/ format
  // ===================================================================
  section('Bonus youtube embed/ format');
  {
    const r = parseVideoUrl('https://www.youtube.com/embed/dQw4w9WgXcQ');
    if (r && r.provider === 'youtube' && r.videoId === 'dQw4w9WgXcQ') {
      pass('Bonus youtube embed/ parsed');
    } else {
      fail('Bonus youtube embed', r);
    }
  }

  // ===================================================================
  // Bonus : youtube avec query params extra
  // ===================================================================
  section('Bonus youtube watch?v= avec params extra (&t=120)');
  {
    const r = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120');
    if (r && r.videoId === 'dQw4w9WgXcQ') {
      pass('Bonus youtube avec params');
    } else {
      fail('Bonus youtube params', r);
    }
  }

  // ===================================================================
  // Bonus : drive open?id= format
  // ===================================================================
  section('Bonus drive.google.com/open?id=ID');
  {
    const r = parseVideoUrl('https://drive.google.com/open?id=1aBc2DeF3GhI4JkL5MnO');
    if (r && r.provider === 'drive' && r.videoId === '1aBc2DeF3GhI4JkL5MnO') {
      pass('Bonus drive open?id= parsed');
    } else {
      fail('Bonus drive open', r);
    }
  }

  // ===================================================================
  // Bonus : Vimeo player URL
  // ===================================================================
  section('Bonus player.vimeo.com/video/ID');
  {
    const r = parseVideoUrl('https://player.vimeo.com/video/123456789');
    if (r && r.provider === 'vimeo' && r.videoId === '123456789') {
      pass('Bonus vimeo player.vimeo parsed');
    } else {
      fail('Bonus vimeo player', r);
    }
  }

  // ===================================================================
  // Bonus : Firebase Storage URL avec extension dans le path
  // ===================================================================
  section('Bonus Firebase Storage URL (firebasestorage.googleapis.com) image');
  {
    const url =
      'https://firebasestorage.googleapis.com/v0/b/spordate-prod.appspot.com/o/partners%2Fuid123%2Factivities%2F1715000000-photo.jpg?alt=media&token=abc';
    if (isImageUrl(url)) {
      pass('Bonus Firebase Storage URL image → isImageUrl=true (extension dans path)');
    } else {
      fail('Bonus Firebase Storage should match', url);
    }
  }

  // ===================================================================
  // Phase 9.5 c5 — getVideoThumbnail tests
  // ===================================================================
  section('MP7 getVideoThumbnail YouTube → img.youtube.com hqdefault.jpg');
  {
    const item = {
      type: 'video' as const,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      provider: 'youtube' as const,
    };
    const thumb = getVideoThumbnail(item);
    if (thumb === 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg') {
      pass('MP7 YouTube thumb URL hqdefault.jpg correct');
    } else {
      fail('MP7 YouTube thumb mismatch', { thumb });
    }
    // Variante avec videoId déjà stocké (pas de re-parse)
    const item2 = {
      type: 'video' as const,
      url: 'https://example.invalid/whatever',
      provider: 'youtube' as const,
      videoId: 'abc12345678',
    };
    const thumb2 = getVideoThumbnail(item2);
    if (thumb2 === 'https://img.youtube.com/vi/abc12345678/hqdefault.jpg') {
      pass('MP7 YouTube thumb avec videoId stocké (pas de re-parse)');
    } else {
      fail('MP7 YouTube stored videoId', { thumb2 });
    }
  }

  section('MP8 getVideoThumbnail Vimeo → null (oEmbed defer Phase 10)');
  {
    const item = {
      type: 'video' as const,
      url: 'https://vimeo.com/123456789',
      provider: 'vimeo' as const,
    };
    const thumb = getVideoThumbnail(item);
    if (thumb === null) {
      pass('MP8 Vimeo thumb=null (caller fallback placeholder Lucide Video icon)');
    } else {
      fail('MP8 Vimeo should be null', { thumb });
    }
  }

  section('MP9 getVideoThumbnail Drive → null (no stable thumb)');
  {
    const item = {
      type: 'video' as const,
      url: 'https://drive.google.com/file/d/1aBc2DeF3GhI4JkL5MnO/view',
      provider: 'drive' as const,
    };
    const thumb = getVideoThumbnail(item);
    if (thumb === null) {
      pass('MP9 Drive thumb=null (caller fallback placeholder)');
    } else {
      fail('MP9 Drive should be null', { thumb });
    }
  }

  section('MP10 getVideoThumbnail item.type=image → null (skip non-video)');
  {
    const item = {
      type: 'image' as const,
      url: 'https://example.com/photo.jpg',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const thumb = getVideoThumbnail(item as any);
    if (thumb === null) {
      pass('MP10 image item → null (defensive skip)');
    } else {
      fail('MP10 image should return null', { thumb });
    }
  }

  console.log('');
  console.log('====== Résumé Media Parser (MP1-MP6 + bonus + MP7-MP10 c5) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);

  if (_failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
