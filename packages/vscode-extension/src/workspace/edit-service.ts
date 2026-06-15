import * as fs from 'fs';
import * as nodePath from 'path';

export interface WorkspaceWriteResult {
  existed: boolean;
  oldContent: string;
  newContent: string;
}

export class WorkspaceEditService {
  writeTextFileSync(absPath: string, content: string): WorkspaceWriteResult {
    const existed = fs.existsSync(absPath);
    const oldContent = existed ? fs.readFileSync(absPath, 'utf8') : '';
    const dir = nodePath.dirname(absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
    return { existed, oldContent, newContent: content };
  }
}
