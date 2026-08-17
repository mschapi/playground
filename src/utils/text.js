export function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function wordCount(value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return 0;
  return normalized.split(/\s+/).length;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function estimateDurationSeconds(text, config) {
  const words = wordCount(text);
  const estimated = Math.ceil(words / config.wordsPerSecond);
  return clamp(
    estimated,
    config.minSceneDurationSeconds,
    config.maxSceneDurationSeconds
  );
}

export function summarizeQuery(text, maxWords = 8) {
  const stop = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'que',
    'en', 'con', 'por', 'para', 'y', 'o', 'a', 'se', 'su', 'sus', 'al', 'lo',
    'es', 'son', 'como', 'mientras', 'pero'
  ]);
  return normalizeWhitespace(text)
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase())
    .filter((word) => word.length > 2 && !stop.has(word))
    .slice(0, maxWords)
    .join(' ');
}

export function chunkWords(text, maxWords = 8, maxChars = 38) {
  const words = normalizeWhitespace(text).split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = [];
  for (const word of words) {
    const candidate = [...current, word];
    if (
      current.length > 0 &&
      (candidate.length > maxWords || candidate.join(' ').length > maxChars)
    ) {
      chunks.push(current.join(' '));
      current = [word];
    } else {
      current = candidate;
    }
  }
  if (current.length) chunks.push(current.join(' '));
  return chunks;
}

