import { ArtifactPreviewProtocol } from '@shared/artifactPreview/constants';

export function buildLocalFileSrc(filePath: string, cacheKey: number): string {
  const normalized = normalizeLocalPath(filePath);
  const pathForUrl = /^[A-Za-z]:/.test(normalized) || normalized.startsWith('/')
    ? normalized
    : `/${normalized}`;
  const encoded = pathForUrl.split('/').map(encodeURIComponent).join('/');
  const prefix = /^[A-Za-z]:/.test(pathForUrl)
    ? `${ArtifactPreviewProtocol.LocalFile}:///`
    : `${ArtifactPreviewProtocol.LocalFile}://`;
  return `${prefix}${encoded}?v=${cacheKey}`;
}

function normalizeLocalPath(filePath: string): string {
  let normalized = filePath.trim();
  if (normalized.startsWith('file:///')) {
    normalized = normalized.slice(7);
  } else if (normalized.startsWith('file://')) {
    normalized = normalized.slice(7);
  } else if (normalized.startsWith('file:/')) {
    normalized = normalized.slice(5);
  }
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the original path when it contains a literal percent sign.
  }
  if (/^\/[A-Za-z]:/.test(normalized)) {
    normalized = normalized.slice(1);
  }
  return normalized.replace(/\\/g, '/');
}