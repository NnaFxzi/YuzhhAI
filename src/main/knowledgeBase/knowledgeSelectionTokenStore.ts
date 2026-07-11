import { randomUUID } from 'node:crypto';

import {
  KNOWLEDGE_MAX_SELECTION_FILES,
  KNOWLEDGE_SELECTION_TOKEN_TTL_MS,
  type KnowledgeBaseErrorCode,
  KnowledgeBaseErrorCode as KnowledgeBaseErrorCodes,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeFileSelection } from '../../shared/knowledgeBase/types';

export interface SelectedKnowledgeFileInput {
  absolutePath: string;
  displayName: string;
  fileSize: number;
  sourceMtime: number;
}

export interface SelectedKnowledgeFileEntry extends SelectedKnowledgeFileInput {
  itemId: string;
}

interface SelectionTokenEntry {
  ownerId: number;
  expiresAt: number;
  files: SelectedKnowledgeFileEntry[];
}

export class KnowledgeSelectionTokenError extends Error {
  constructor(readonly code: KnowledgeBaseErrorCode) {
    super(code);
    this.name = 'KnowledgeSelectionTokenError';
  }
}

export class KnowledgeSelectionTokenStore {
  private readonly entries = new Map<string, SelectionTokenEntry>();

  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  issue(ownerId: number, files: SelectedKnowledgeFileInput[]): KnowledgeFileSelection {
    if (!Number.isInteger(ownerId) || ownerId < 0 || files.length === 0) {
      throw new KnowledgeSelectionTokenError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    if (files.length > KNOWLEDGE_MAX_SELECTION_FILES) {
      throw new KnowledgeSelectionTokenError(KnowledgeBaseErrorCodes.TooManyFiles);
    }

    const selectedFiles = files.map(file => this.normalizeFile(file));
    const selectionToken = randomUUID();
    this.entries.set(selectionToken, {
      ownerId,
      expiresAt: this.now() + KNOWLEDGE_SELECTION_TOKEN_TTL_MS,
      files: selectedFiles,
    });

    return {
      selectionToken,
      files: selectedFiles.map(file => ({
        itemId: file.itemId,
        displayName: file.displayName,
        fileSize: file.fileSize,
      })),
    };
  }

  consume(
    selectionToken: string,
    ownerId: number,
    itemIds?: readonly string[],
  ): SelectedKnowledgeFileEntry[] {
    const normalizedToken = selectionToken.trim();
    const entry = normalizedToken ? this.entries.get(normalizedToken) : undefined;
    if (!entry || entry.ownerId !== ownerId) {
      throw new KnowledgeSelectionTokenError(KnowledgeBaseErrorCodes.InvalidSelectionToken);
    }
    if (entry.expiresAt < this.now()) {
      this.entries.delete(normalizedToken);
      throw new KnowledgeSelectionTokenError(KnowledgeBaseErrorCodes.InvalidSelectionToken);
    }

    let selectedFiles = entry.files;
    if (itemIds !== undefined) {
      const normalizedItemIds = Array.from(itemIds, itemId =>
        typeof itemId === 'string' ? itemId.trim() : '',
      );
      const requestedItemIds = new Set(normalizedItemIds);
      if (
        normalizedItemIds.length === 0 ||
        normalizedItemIds.length > KNOWLEDGE_MAX_SELECTION_FILES ||
        requestedItemIds.size !== normalizedItemIds.length ||
        normalizedItemIds.some(itemId => !itemId)
      ) {
        throw new KnowledgeSelectionTokenError(KnowledgeBaseErrorCodes.InvalidRequest);
      }
      const availableItemIds = new Set(entry.files.map(file => file.itemId));
      if (normalizedItemIds.some(itemId => !availableItemIds.has(itemId))) {
        throw new KnowledgeSelectionTokenError(KnowledgeBaseErrorCodes.InvalidRequest);
      }
      selectedFiles = entry.files.filter(file => requestedItemIds.has(file.itemId));
    }

    this.entries.delete(normalizedToken);
    return selectedFiles.map(file => ({ ...file }));
  }

  clearOwner(ownerId: number): void {
    for (const [selectionToken, entry] of this.entries) {
      if (entry.ownerId === ownerId) {
        this.entries.delete(selectionToken);
      }
    }
  }

  private normalizeFile(file: SelectedKnowledgeFileInput): SelectedKnowledgeFileEntry {
    const absolutePath = file.absolutePath.trim();
    const displayName = file.displayName.trim();
    if (
      !absolutePath ||
      !displayName ||
      !Number.isFinite(file.fileSize) ||
      file.fileSize < 0 ||
      !Number.isFinite(file.sourceMtime)
    ) {
      throw new KnowledgeSelectionTokenError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    return {
      itemId: randomUUID(),
      absolutePath,
      displayName,
      fileSize: file.fileSize,
      sourceMtime: file.sourceMtime,
    };
  }
}
