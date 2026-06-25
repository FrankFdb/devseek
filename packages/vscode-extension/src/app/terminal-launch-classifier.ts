import * as fs from 'fs';
import * as nodePath from 'path';
import { containsRuntimeExecutableSegment } from '../tools/shell-command-analysis';

export { containsRuntimeExecutableSegment } from '../tools/shell-command-analysis';

const VISUAL_OR_INTERACTIVE_COMMAND_RE =
  /(?:图形|窗口|界面|GUI|graphics?|window|visual|render|draw|X11|OpenGL|GLFW|GLUT|SDL2?|SFML|Qt|GTK|Cocoa|Win32)/i;

const VISUAL_SOURCE_RE =
  /(?:#include\s+[<"][^>"]*(?:X11\/|GL\/|GLFW\/|SDL2\/|SFML\/|QApplication|QWidget|gtk\/)|\b(?:XOpenDisplay|XCreateSimpleWindow|XMapWindow|XDrawArc|XDrawRectangle|XDrawLines|XNextEvent|XFlush|glut|glfw|SDL_|sf::RenderWindow|QApplication|gtk_init|CreateWindow|WinMain)\b|target_link_libraries\s*\([^)]*(?:X11|GL|glut|glfw|SDL2|sfml|Qt|GTK))/i;

export interface TerminalLaunchClassificationInput {
  command: string;
  workdir?: string;
  workspaceRoot?: string;
}

export function shouldUseManualReviewLaunchMode(input: TerminalLaunchClassificationInput): boolean {
  if (!containsRuntimeExecutableSegment(input.command)) return false;
  if (VISUAL_OR_INTERACTIVE_COMMAND_RE.test(input.command)) return true;
  return VISUAL_SOURCE_RE.test(readVisualSourceHints(input.command, input.workdir, input.workspaceRoot));
}

function readVisualSourceHints(command: string, workdir?: string, workspaceRoot?: string): string {
  const dirs = candidateSourceDirs(command, workdir, workspaceRoot);
  const chunks: string[] = [];
  let totalLength = 0;
  for (const dir of dirs) {
    try {
      const names = fs.readdirSync(dir).slice(0, 80);
      for (const name of names) {
        if (!looksLikeVisualSourceCandidate(name)) continue;
        const filePath = nodePath.join(dir, name);
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > 300_000) continue;
        const chunk = fs.readFileSync(filePath, 'utf8').slice(0, 8000);
        chunks.push(chunk);
        totalLength += chunk.length;
        if (totalLength > 32_000) return chunks.join('\n');
      }
    } catch {
      // Source hints are best-effort only; terminal execution must not depend on them.
    }
  }
  return chunks.join('\n');
}

function candidateSourceDirs(command: string, workdir?: string, workspaceRoot?: string): string[] {
  const root = workspaceRoot ? nodePath.resolve(workspaceRoot) : '';
  const dirs = new Set<string>();
  const addDir = (dir: string | undefined) => {
    if (!dir) return;
    const abs = nodePath.resolve(root && !nodePath.isAbsolute(dir) ? nodePath.join(root, dir) : dir);
    if (root && !isInsideWorkspace(abs, root)) return;
    dirs.add(abs);
  };
  addDir(workdir);

  const pathRe = /(?:^|[\s=:(,])(['"]?)(\/[^'"`\s;&|)]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pathRe.exec(command)) !== null) {
    const rawPath = cleanToken(match[2] || '');
    if (!rawPath || rawPath === '/dev/null') continue;
    const segments = rawPath.split('/').filter(Boolean);
    const buildIndex = segments.findIndex(s => s === '.devseek-build' || s === '.devseek-builds' || s === 'build');
    if (buildIndex > 0) {
      addDir('/' + segments.slice(0, buildIndex).join('/'));
    } else {
      addDir(nodePath.dirname(rawPath));
    }
  }
  return [...dirs].slice(0, 6);
}

function looksLikeVisualSourceCandidate(name: string): boolean {
  return /^(?:CMakeLists\.txt|.*\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm|rs|py|js|ts))$/i.test(name);
}

function cleanToken(token: string): string {
  return token.trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/[),]+$/g, '');
}

function isInsideWorkspace(filePath: string, workspaceRoot: string): boolean {
  const rel = nodePath.relative(nodePath.resolve(workspaceRoot), nodePath.resolve(filePath));
  return rel === '' || (!!rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel));
}
