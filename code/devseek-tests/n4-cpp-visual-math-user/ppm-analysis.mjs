import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function readPpmStats(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const bytes = fs.readFileSync(filePath);
  const parsed = ppmHeader(bytes);
  if (!parsed || parsed.maxValue <= 0 || parsed.maxValue > 65_535) return null;
  const colors = new Map();
  const samples = [];
  let sampled = 0;
  if (parsed.magic === 'P6' && parsed.maxValue <= 255) {
    const pixelCount = parsed.width * parsed.height;
    const stride = Math.max(1, Math.floor(pixelCount / 25_000));
    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
      const offset = parsed.dataOffset + pixel * 3;
      if (offset + 2 >= bytes.length) break;
      const key = addColor(colors, bytes[offset], bytes[offset + 1], bytes[offset + 2]);
      samples.push({ key, x: pixel % parsed.width, y: Math.floor(pixel / parsed.width) });
      sampled += 1;
    }
  } else if (parsed.magic === 'P3') {
    const values = bytes.subarray(parsed.dataOffset).toString('ascii').trim().split(/\s+/u).map(Number);
    const pixelCount = Math.floor(values.length / 3);
    const stride = Math.max(1, Math.floor(pixelCount / 25_000));
    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
      const offset = pixel * 3;
      const key = addColor(colors, values[offset], values[offset + 1], values[offset + 2]);
      samples.push({ key, x: pixel % parsed.width, y: Math.floor(pixel / parsed.width) });
      sampled += 1;
    }
  }
  const rankedColors = [...colors.entries()].sort((left, right) => right[1] - left[1]);
  const [dominantKey, dominant = 0] = rankedColors[0] ?? [null, 0];
  const nonDominantSamples = dominantKey === null ? [] : samples.filter(sample => sample.key !== dominantKey);
  return {
    filePath,
    magic: parsed.magic,
    width: parsed.width,
    height: parsed.height,
    maxValue: parsed.maxValue,
    bytes: bytes.length,
    sampledPixels: sampled,
    uniqueSampledColors: colors.size,
    nonDominantRatio: sampled > 0 ? Number((1 - dominant / sampled).toFixed(4)) : 0,
    dominantSampledColor: dominantKey === null ? null : colorSummary(dominantKey, dominant, sampled),
    topSampledColors: rankedColors.slice(0, 4).map(([key, count]) => colorSummary(key, count, sampled)),
    nonDominantSampledPixels: nonDominantSamples.length,
    nonDominantBounds: sampleBounds(nonDominantSamples),
    nonDominantQuadrants: sampleQuadrants(nonDominantSamples, parsed.width, parsed.height),
  };
}

export function ppmLooksGraphical(stats) {
  const expected = graphicalPpmExpectation();
  return Boolean(stats
    && stats.width >= expected.minimumWidth
    && stats.height >= expected.minimumHeight
    && stats.uniqueSampledColors >= expected.minimumUniqueSampledColors
    && stats.nonDominantRatio >= expected.minimumNonDominantRatio);
}

export function graphicalPpmExpectation() {
  return {
    minimumWidth: 640,
    minimumHeight: 480,
    minimumUniqueSampledColors: 6,
    minimumNonDominantRatio: 0.02,
  };
}

function ppmHeader(bytes) {
  let offset = 0;
  const tokens = [];
  while (tokens.length < 4 && offset < bytes.length) {
    while (offset < bytes.length && /\s/u.test(String.fromCharCode(bytes[offset]))) offset += 1;
    if (bytes[offset] === 35) {
      while (offset < bytes.length && bytes[offset] !== 10) offset += 1;
      continue;
    }
    const start = offset;
    while (offset < bytes.length && !/\s/u.test(String.fromCharCode(bytes[offset]))) offset += 1;
    if (offset > start) tokens.push(bytes.subarray(start, offset).toString('ascii'));
  }
  const [magic, width, height, maxValue] = tokens;
  if (!['P3', 'P6'].includes(magic)) return null;
  if (offset >= bytes.length || !/\s/u.test(String.fromCharCode(bytes[offset]))) return null;
  offset += bytes[offset] === 13 && bytes[offset + 1] === 10 ? 2 : 1;
  return { magic, width: Number(width), height: Number(height), maxValue: Number(maxValue), dataOffset: offset };
}

function colorSummary(key, count, sampled) {
  return {
    rgb: key.split(',').map(Number),
    count,
    ratio: sampled > 0 ? Number((count / sampled).toFixed(4)) : 0,
  };
}

function sampleBounds(samples) {
  if (samples.length === 0) return null;
  return samples.reduce((bounds, sample) => ({
    minX: Math.min(bounds.minX, sample.x),
    minY: Math.min(bounds.minY, sample.y),
    maxX: Math.max(bounds.maxX, sample.x),
    maxY: Math.max(bounds.maxY, sample.y),
  }), {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
}

function sampleQuadrants(samples, width, height) {
  const counts = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
  for (const sample of samples) {
    const vertical = sample.y < height / 2 ? 'top' : 'bottom';
    const horizontal = sample.x < width / 2 ? 'Left' : 'Right';
    counts[`${vertical}${horizontal}`] += 1;
  }
  return counts;
}

function addColor(colors, red, green, blue) {
  const key = `${red},${green},${blue}`;
  colors.set(key, (colors.get(key) || 0) + 1);
  return key;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  const filePath = process.argv[2] ? path.resolve(process.argv[2]) : '';
  if (!filePath) {
    console.error('Usage: node verify-ppm.mjs <snapshot.ppm>');
    process.exitCode = 2;
  } else {
    const stats = readPpmStats(filePath);
    const report = {
      ok: ppmLooksGraphical(stats),
      expected: graphicalPpmExpectation(),
      observed: stats,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  }
}
