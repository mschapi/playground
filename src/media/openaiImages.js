import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { downloadFile, fetchJson } from '../utils/http.js';
import { ensureDir, writeJson } from '../utils/files.js';

export async function generateAiImages(scenes, config, outDir) {
  if (!config.openai.apiKey) throw new Error('Falta OPENAI_API_KEY para generar imagenes IA');
  ensureDir(outDir);

  const assets = [];
  const errors = [];
  for (const scene of scenes) {
    const extension = config.openai.imageFormat || 'png';
    const outputFileName = scene.output_file_name ||
      scene.run_id + '_' + scene.scene_label + '_ai.' + extension;
    const filePath = join(outDir, outputFileName);
    const originalPrompt = scene.image_prompt || scene.ai_image_prompt || scene.visual_summary || scene.script_text;

    let generated = null;
    let lastError = null;
    for (const prompt of imagePromptAttempts(scene, originalPrompt)) {
      try {
        generated = await requestImage({ prompt, filePath, extension, scene, config });
        break;
      } catch (error) {
        lastError = error;
        if (!isSafetyError(error)) break;
      }
    }

    if (!generated) {
      errors.push({
        scene_id: scene.scene_id,
        scene_label: scene.scene_label,
        scene_number: scene.scene_number,
        message: lastError?.message || 'No se pudo generar imagen IA'
      });
      continue;
    }

    assets.push({
      type: 'ai-image',
      sceneId: scene.id,
      scene_id: scene.scene_id,
      scene_label: scene.scene_label,
      sceneNumber: scene.scene_number,
      option: 1,
      path: filePath,
      name: outputFileName,
      file_name: outputFileName,
      output_file_name: outputFileName,
      output_full_path: '/tmp/' + outputFileName,
      durationSeconds: scene.render_duration_seconds,
      prompt: generated.prompt,
      promptFallback: generated.promptFallback
    });
  }

  if (errors.length) writeJson(join(outDir, 'openai-image-errors.json'), errors);
  return assets;
}

async function requestImage({ prompt, filePath, extension, scene, config }) {
  const body = {
    model: config.openai.imageModel,
    prompt,
    size: config.openai.imageSize,
    quality: config.openai.imageQuality
  };

  if (config.openai.imageModel.startsWith('gpt-image')) {
    body.output_format = extension;
  } else {
    body.response_format = 'b64_json';
  }

  const response = await fetchJson(
    'https://api.openai.com/v1/images/generations',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + config.openai.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    },
    'OpenAI image scene ' + scene.scene_number
  );

  const item = response.data?.[0];
  if (!item) throw new Error('OpenAI no devolvio imagen para escena ' + scene.scene_number);

  if (item.b64_json) {
    writeFileSync(filePath, Buffer.from(item.b64_json, 'base64'));
  } else if (item.url) {
    await downloadFile(item.url, filePath);
  } else {
    throw new Error('Respuesta de imagen sin b64_json/url para escena ' + scene.scene_number);
  }

  return { prompt, promptFallback: prompt !== (scene.image_prompt || scene.ai_image_prompt) };
}

function imagePromptAttempts(scene, originalPrompt) {
  const safeBase = [
    'Cinematic editorial still, realistic but safe, no text, no logos, no gore, no injuries, no weapons, no restraints.',
    'Represent the concept visually without depicting abuse or explicit harm.',
    'Scene context:',
    scene.visual_summary || scene.search_query || scene.script_text || scene.scene_label
  ].join(' ');
  return [String(originalPrompt || safeBase), safeBase];
}

function isSafetyError(error) {
  return /safety|moderation|blocked|policy|abuse/i.test(String(error?.message || ''));
}
