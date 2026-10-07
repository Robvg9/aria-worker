export type MissionArtifact = {
  id: string;
  name: string;
  path?: string;
  kind: 'html' | 'image' | 'video' | 'audio' | 'document' | 'archive' | 'application' | 'file' | 'unknown';
  viewUrl?: string;
  downloadUrl?: string;
  sourceUrl?: string;
  repo?: string;
  ref?: string;
  commitSha?: string;
  previewable: boolean;
};

const ARIA_ORIGIN = 'https://aria.robvg9.workers.dev';
const GITHUB_RE = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([^/]+(?:\/[^/]+)*)\/(.+)$/i;
const GITHUB_RAW_RE = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+(?:\/[^/]+)*)\/(.+)$/i;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstObjectValue(value: any, keys: string[]): string {
  for (const key of keys) {
    const v = text(value?.[key]);
    if (v) return v;
  }
  return '';
}

function githubPartsFromObject(value: any): { repo: string; ref: string; path: string; sourceUrl?: string } | null {
  const source = firstObjectValue(value, ['html_url', 'view_url', 'preview_url', 'source_url', 'artifact_url']);
  const download = firstObjectValue(value, ['download_url', 'raw_url', 'rawUrl']);
  const fromHtml = source.match(GITHUB_RE);
  if (fromHtml) return { repo: fromHtml[1], ref: fromHtml[2], path: fromHtml[3], sourceUrl: source };
  const fromRaw = download.match(GITHUB_RAW_RE);
  if (fromRaw) return { repo: fromRaw[1], ref: fromRaw[2], path: fromRaw[3], sourceUrl: source || download };

  const repo = firstObjectValue(value, ['repo', 'repository', 'repository_full_name', 'repo_full_name']);
  const ref = firstObjectValue(value, ['branch', 'ref', 'head_ref']);
  const path = firstObjectValue(value, ['path', 'file_path', 'filename']);
  if (repo.includes('/') && ref && path) return { repo, ref, path, sourceUrl: source || download || undefined };
  return null;
}

function parseDirectArtifact(value: any): Omit<MissionArtifact, 'id' | 'kind' | 'previewable'> | null {
  if (!value || typeof value !== 'object') return null;
  const viewUrl = firstObjectValue(value, ['view_url', 'preview_url', 'artifact_url']);
  const downloadUrl = firstObjectValue(value, ['download_url', 'downloadUrl', 'artifact_download_url', 'signed_url', 'signedUrl', 'public_url', 'publicUrl']);
  const sourceUrl = firstObjectValue(value, ['source_url', 'sourceUrl', 'html_url', 'artifact_url']);
  const path = firstObjectValue(value, ['path', 'file_path', 'filename']);
  const name = firstObjectValue(value, ['name', 'filename']) || (path ? path.split('/').pop() || '' : '');
  const github = githubPartsFromObject(value);

  if (!viewUrl && !downloadUrl && !sourceUrl && !github && !path) return null;

  return {
    name: name || 'Artefacto',
    path: path || github?.path,
    repo: github?.repo,
    ref: github?.ref,
    commitSha: firstObjectValue(value, ['commit_sha', 'commitSha', 'sha']) || undefined,
    viewUrl: viewUrl || undefined,
    downloadUrl: downloadUrl || undefined,
    sourceUrl: sourceUrl || github?.sourceUrl,
  };
}

function inferKind(path = '', name = '', mime = ''): MissionArtifact['kind'] {
  const value = (path + ' ' + name).toLowerCase();
  const type = mime.toLowerCase();
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(value)) return 'image';
  if (type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(value)) return 'video';
  if (type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac)$/i.test(value)) return 'audio';
  if (type === 'text/html' || /\.html?$/i.test(value)) return 'html';
  if (/\.(zip|tar|gz|7z|rar)$/i.test(value) || type.includes('zip')) return 'archive';
  if (/\.(apk|exe|msi|dmg|deb|appimage)$/i.test(value)) return 'application';
  if (type.includes('pdf') || /\.(pdf|docx?|xlsx?|pptx?)$/i.test(value)) return 'document';
  if (path || name) return 'file';
  return 'unknown';
}

function previewPath(repo: string, ref: string, path: string, download = false): string {
  const params = new URLSearchParams({ repo, ref, path });
  return ARIA_ORIGIN + (download ? '/artifact/download?' : '/artifact/view?') + params.toString();
}

function walk(value: any, depth = 0, out: any[] = []): any[] {
  if (depth > 7 || value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, depth + 1, out);
    return out;
  }
  if (typeof value !== 'object') return out;
  out.push(value);
  for (const child of Object.values(value)) walk(child, depth + 1, out);
  return out;
}

export function missionArtifacts(mission: any): MissionArtifact[] {
  const results = mission?.checkpoint?.results;
  if (!results || typeof results !== 'object') return [];

  const candidates = walk(results);
  const artifacts: MissionArtifact[] = [];

  for (const value of candidates) {
    const candidate = parseDirectArtifact(value);
    if (!candidate) continue;

    const mime = firstObjectValue(value, ['mime_type', 'mimeType', 'content_type', 'contentType']);
    const kind = inferKind(candidate.path, candidate.name, mime);
    const repo = candidate.repo || '';
    const ref = candidate.ref || '';

    let viewUrl = candidate.viewUrl;
    let downloadUrl = candidate.downloadUrl;
    const sourceUrl = candidate.sourceUrl;

    if (repo && ref && candidate.path) {
      viewUrl = previewPath(repo, ref, candidate.path, false);
      downloadUrl = previewPath(repo, ref, candidate.path, true);
    }

    const previewable = Boolean(viewUrl) && kind !== 'unknown';
    if (!viewUrl && !downloadUrl) continue;

    const key = [candidate.name, candidate.path, viewUrl, downloadUrl].filter(Boolean).join('|');
    if (artifacts.some(a => a.id === key)) continue;

    artifacts.push({
      id: key,
      name: candidate.name,
      path: candidate.path,
      kind,
      viewUrl: viewUrl || sourceUrl,
      downloadUrl,
      sourceUrl,
      repo: candidate.repo,
      ref: candidate.ref,
      commitSha: candidate.commitSha,
      previewable,
    });
  }

  // Prefer the physically verified file-read result over duplicate connector envelopes.
  artifacts.sort((a, b) => {
    const score = (x: MissionArtifact) =>
      (x.downloadUrl ? 3 : 0) +
      (x.viewUrl ? 2 : 0) +
      (x.path ? 1 : 0) +
      (x.kind !== 'unknown' ? 1 : 0);
    return score(b) - score(a);
  });

  return artifacts.slice(0, 12);
}

export function artifactKindLabel(kind: MissionArtifact['kind']): string {
  const labels: Record<MissionArtifact['kind'], string> = {
    html: 'Página web',
    image: 'Imagen',
    video: 'Vídeo',
    audio: 'Audio',
    document: 'Documento',
    archive: 'Paquete',
    application: 'Aplicación',
    file: 'Archivo',
    unknown: 'Resultado',
  };
  return labels[kind];
}
