import { slugify } from './utils/files.js';
import {
  clamp,
  estimateDurationSeconds,
  normalizeWhitespace,
  summarizeQuery
} from './utils/text.js';

export function normalizeScenes(rawScenes, config) {
  const scenes = rawScenes.map((scene, index) => {
    const number = parseSceneNumber(scene.scene_id ?? scene.scene_number ?? scene.number, index);
    const sceneLabel = formatSceneLabel(number);
    const scriptText = normalizeWhitespace(
      scene.script_text || scene.narration || scene.text || ''
    );
    const visualIntent = normalizeWhitespace(
      scene.visual_intent || scene.visual_summary || scriptText
    );
    const query = normalizeWhitespace(
      scene.search_query ||
        scene.pexels_image_query ||
        scene.pexels_video_query ||
        scene.google_image_query ||
        summarizeQuery(visualIntent || scriptText)
    );
    const estimatedDuration = estimateDurationSeconds(scriptText, config);
    const duration = normalizeGeneratedDuration(scene.duration_seconds, estimatedDuration);
    const renderDuration = clamp(
      Number(scene.render_duration_seconds || duration),
      config.aiRenderMinDurationSeconds,
      config.aiRenderMaxDurationSeconds
    );
    const imagePrompt = normalizeWhitespace(
      scene.image_prompt || scene.ai_image_prompt || visualIntent || scriptText
    );

    return {
      id: sceneLabel,
      scene_id: sceneLabel,
      scene_label: sceneLabel,
      scene_number: number,
      scene_order: number,
      slug: slugify(sceneLabel + '-' + (query || 'scene')),
      script_text: scriptText,
      narration: scriptText,
      visual_intent: visualIntent,
      visual_summary: visualIntent,
      search_query: query,
      pexels_image_query: query,
      pexels_video_query: query,
      google_image_query: query,
      asset_type: scene.asset_type || 'video',
      orientation: scene.orientation || 'horizontal',
      image_prompt: ensureStyle(imagePrompt, config.imageStylePrompt),
      ai_image_prompt: ensureStyle(imagePrompt, config.imageStylePrompt),
      duration_seconds: duration,
      render_duration_seconds: renderDuration
    };
  });

  const maxScenes = Number(config.maxScenes || 0);
  return maxScenes > 0 ? scenes.slice(0, maxScenes) : scenes;
}

export function heuristicScenesFromScript(script, config) {
  const paragraphs = script
    .split(/\n\s*\n/g)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

  const chunks = paragraphs.length ? paragraphs : [normalizeWhitespace(script)];

  return normalizeScenes(
    chunks.map((scriptText, index) => {
      const query = summarizeQuery(scriptText);
      return {
        scene_id: formatSceneLabel(index + 1),
        script_text: scriptText,
        visual_intent: query || scriptText,
        search_query: query || scriptText,
        asset_type: 'video',
        orientation: 'horizontal',
        image_prompt: scriptText
      };
    }),
    config
  );
}

function parseSceneNumber(value, index) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value || '').match(/(\d+)/);
  return match ? Number(match[1]) : index + 1;
}

function formatSceneLabel(number) {
  return 'scene_' + String(Number(number) || 1).padStart(2, '0');
}

function ensureStyle(prompt, style) {
  const normalizedPrompt = normalizeWhitespace(prompt);
  const normalizedStyle = normalizeWhitespace(style);
  if (!normalizedStyle) return normalizedPrompt;
  if (normalizedPrompt.toLowerCase().includes(normalizedStyle.toLowerCase())) {
    return normalizedPrompt;
  }
  return normalizeWhitespace(normalizedPrompt + ', ' + normalizedStyle);
}

function normalizeGeneratedDuration(value, estimatedDuration) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return estimatedDuration;
  if (raw < estimatedDuration * 0.6 || raw > estimatedDuration * 1.5) return estimatedDuration;
  return Math.round(raw * 2) / 2;
}
