// Everything that talks to the Atlas servers lives here, so it is easy to change.
export const API_BASE = 'https://atlas.synapt.workers.dev';
export const API_URL = `${API_BASE}/v1/chat/completions`;
export const API_GUIDE_URL = `${API_BASE}/api`;

// Voice: first the authenticated public endpoint (uses the user's own key),
// then the site's own voice endpoint as a fallback (see worker/ for the proxy patch).
export const VOICE_URL = `${API_BASE}/v1/voice/chat`;
export const VOICE_URL_FALLBACK = `${API_BASE}/voice/chat`;

export const ATLAS_LOGO = '/assets/atlas-logo.png';

export const AVAILABLE_MODELS = ['Ai-2', 'Ai-3', 'Star-1', 'Star-2'] as const;
export const DEFAULT_MODEL = 'star-1';
export const THINKING_MODEL = 'star-2';

// ---- Attachments (same numbers as the website) ----
export const MAX_ATTACH_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 4;
export const IMG_MAX_SIDE = 1024;
export const IMG_QUALITY = 0.7;
export const IMG_SKIP_BELOW_BYTES = 60_000;
export const THUMB_SIDE = 160;
export const TEXT_MAX_CHARS = 24_000;

// ---- Token saving (history sent with every request) ----
export const HISTORY_MAX_MESSAGES = 16;
export const HISTORY_CHAR_BUDGET = 36_000;
export const OLD_ASSISTANT_CAP = 12_000;
export const OLD_FILE_PREVIEW_CHARS = 1_200;
export const IMAGE_KEEP_WINDOW = 6; // an image stays attached only while it is this recent

// ---- Voice ----
export const VOICE_MAX_SECONDS = 120;
export const VOICE_MIN_BYTES = 1500;
export const VOICE_TIMEOUT_MS = 60_000;

// Compact version of the website's formatting prompt: enables tables + SEARCH/REPLACE edits.
export const SYSTEM_PROMPT =
  'Format: markdown; use pipe tables when useful. To change existing code/files, do not rewrite them: ' +
  'give a short explanation, then fenced blocks of the form\n' +
  '<<<<<<< SEARCH\n(exact old lines, verbatim)\n=======\n(new lines)\n>>>>>>> REPLACE\n' +
  'To insert, SEARCH the line before and repeat it in REPLACE; to delete, leave REPLACE empty. ' +
  'Output a whole file only if it is new or the user asks.';
