import path from 'node:path';

export const resolveKnowledgeDocumentIndexWorkerPath = (input: {
  isPackaged: boolean;
  moduleDirectory: string;
  resourcesPath: string;
}): string => input.isPackaged
  ? path.join(
      input.resourcesPath,
      'app.asar.unpacked',
      'dist-electron',
      'knowledge-index-worker.js',
    )
  : path.join(input.moduleDirectory, 'knowledge-index-worker.js');
