import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeText } from '../utils/files.js';

const PPRO_TICKS_PER_FRAME_AT_30 = 10160000;

export function writePremiereXml({ outPath, title, outputFileName, scenes, tracks, config, useRenderDuration = false }) {
  const fps = config.fps;
  const timeline = buildTimeline(scenes, fps, useRenderDuration);
  const totalFrames = timeline.reduce((max, scene) => Math.max(max, scene.end), 0);

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xmeml version="5">',
    '  <sequence>',
    '    <name>' + xmlEscape(title) + '</name>',
    '    <duration>' + totalFrames + '</duration>',
    rateXml(fps, 4),
    '    <media>',
    '      <video>',
    formatXml(config, 8),
    ...tracks.map((track, index) => trackXml(track, index, timeline, config)),
    '      </video>',
    '    </media>',
    '  </sequence>',
    '</xmeml>',
    ''
  ].join('\n');

  writeText(outPath, xml);
  return {
    path: outPath,
    fileName: outputFileName || basename(outPath),
    totalScenes: scenes.length,
    totalTracks: tracks.length,
    totalFrames,
    totalSeconds: totalFrames / fps
  };
}

export function buildTracksByOption(assets, label) {
  const byOption = new Map();
  for (const asset of assets) {
    const option = Number(asset.option || asset.image_rank || 1);
    if (!byOption.has(option)) {
      byOption.set(option, {
        name: label + '_' + option,
        option,
        clips: []
      });
    }
    byOption.get(option).clips.push(asset);
  }
  if (!byOption.size) return [{ name: label + '_1', option: 1, clips: [] }];
  return [...byOption.values()].sort((a, b) => a.option - b.option);
}

export function buildCombinedTracks(assets) {
  return [
    { name: 'ai_image', option: 1, clips: assets.aiImages || [] },
    { name: 'pexels_image_1', option: 1, clips: (assets.pexelsImages || []).filter((asset) => Number(asset.option || 1) === 1) },
    { name: 'pexels_image_2', option: 2, clips: (assets.pexelsImages || []).filter((asset) => Number(asset.option || 1) === 2) },
    { name: 'pexels_image_3', option: 3, clips: (assets.pexelsImages || []).filter((asset) => Number(asset.option || 1) === 3) },
    { name: 'pexels_video', option: 1, clips: assets.pexelsVideos || [] },
    { name: 'google_image_1', option: 1, clips: (assets.brightDataImages || []).filter((asset) => Number(asset.option || 1) === 1) },
    { name: 'google_image_2', option: 2, clips: (assets.brightDataImages || []).filter((asset) => Number(asset.option || 1) === 2) },
    { name: 'google_image_3', option: 3, clips: (assets.brightDataImages || []).filter((asset) => Number(asset.option || 1) === 3) }
  ];
}

function buildTimeline(scenes, fps, useRenderDuration) {
  let cursor = 0;
  return scenes.map((scene) => {
    const seconds = useRenderDuration
      ? Number(scene.render_duration_seconds || scene.duration_seconds || 4)
      : Number(scene.duration_seconds || 4);
    const durationFrames = secondsToFrames(seconds, fps);
    const row = {
      ...scene,
      start: cursor,
      end: cursor + durationFrames,
      durationFrames
    };
    cursor += durationFrames;
    return row;
  });
}

function trackXml(track, trackIndex, timeline, config) {
  const clipsByScene = new Map((track.clips || []).map((clip) => [clip.sceneId || clip.scene_id, clip]));
  const lines = ['        <track>'];

  for (const [sceneIndex, scene] of timeline.entries()) {
    const clip = clipsByScene.get(scene.id) || clipsByScene.get(scene.scene_id);
    if (clip) {
      lines.push(clipItemXml({ clip, scene, sceneIndex, trackIndex, config, track }));
    }
  }

  lines.push('        </track>');
  return lines.join('\n');
}

function clipItemXml({ clip, scene, sceneIndex, trackIndex, config, track }) {
  const clipName = clip.name || clip.file_name || clip.output_file_name || basename(clip.path || 'asset');
  const clipId = 'clipitem-' + (trackIndex + 1) + '-' + (sceneIndex + 1);
  const fileId = 'file-' + (trackIndex + 1) + '-' + (sceneIndex + 1);
  const pathurl = getPathUrl(clip, config);
  const width = clip.width || clip.imageMediaMetadata?.width || config.frameSize.width;
  const height = clip.height || clip.imageMediaMetadata?.height || config.frameSize.height;
  const label = scene.scene_label + '_' + (track.name || clip.type || 'asset');

  return [
    '          <clipitem id="' + xmlEscape(clipId) + '">',
    '            <name>' + xmlEscape(clipName) + '</name>',
    '            <duration>' + scene.durationFrames + '</duration>',
    rateXml(config.fps, 12),
    '            <start>' + scene.start + '</start>',
    '            <end>' + scene.end + '</end>',
    '            <enabled>TRUE</enabled>',
    '            <in>0</in>',
    '            <out>' + scene.durationFrames + '</out>',
    '            <pproTicksIn>0</pproTicksIn>',
    '            <pproTicksOut>' + scene.durationFrames * PPRO_TICKS_PER_FRAME_AT_30 + '</pproTicksOut>',
    '            <file id="' + xmlEscape(fileId) + '">',
    '              <name>' + xmlEscape(clipName) + '</name>',
    '              <pathurl>' + xmlEscape(pathurl) + '</pathurl>',
    rateXml(config.fps, 14),
    '              <duration>' + scene.durationFrames + '</duration>',
    '              <media>',
    '                <video>',
    '                  <duration>' + scene.durationFrames + '</duration>',
    '                  <samplecharacteristics>',
    '                    <width>' + width + '</width>',
    '                    <height>' + height + '</height>',
    '                    <anamorphic>FALSE</anamorphic>',
    '                    <pixelaspectratio>square</pixelaspectratio>',
    '                    <fielddominance>none</fielddominance>',
    '                  </samplecharacteristics>',
    '                </video>',
    '              </media>',
    '            </file>',
    '            <labels>',
    '              <label2>' + xmlEscape(label) + '</label2>',
    '            </labels>',
    '          </clipitem>'
  ].join('\n');
}

function getPathUrl(clip, config) {
  const fileName = clip.name || clip.file_name || clip.output_file_name || basename(clip.path || 'asset');
  if (config.xml?.pathMode === 'tmp-filename') {
    return 'file://localhost//tmp/' + encodeURIComponent(fileName).replace(/%2F/g, '/');
  }
  return pathToFileURL(clip.path).href;
}

function formatXml(config, indent) {
  const space = ' '.repeat(indent);
  return [
    space + '<format>',
    space + '  <samplecharacteristics>',
    rateXml(config.fps, indent + 4),
    space + '    <width>' + config.frameSize.width + '</width>',
    space + '    <height>' + config.frameSize.height + '</height>',
    space + '    <anamorphic>FALSE</anamorphic>',
    space + '    <pixelaspectratio>square</pixelaspectratio>',
    space + '    <fielddominance>none</fielddominance>',
    space + '  </samplecharacteristics>',
    space + '</format>'
  ].join('\n');
}

function rateXml(fps, indent = 0) {
  const space = ' '.repeat(indent);
  return [
    space + '<rate>',
    space + '  <timebase>' + fps + '</timebase>',
    space + '  <ntsc>false</ntsc>',
    space + '</rate>'
  ].join('\n');
}

function secondsToFrames(seconds, fps) {
  return Math.max(1, Math.round(Number(seconds) * fps));
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
