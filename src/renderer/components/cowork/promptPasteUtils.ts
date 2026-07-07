export interface PromptClipboardData<TFile> {
  files?: ArrayLike<TFile> | null;
  items?: ArrayLike<PromptClipboardItem<TFile>> | null;
  types?: ArrayLike<string> | null;
  getData?: (format: string) => string;
}

export interface PromptClipboardItem<TFile> {
  kind?: string;
  getAsFile?: () => TFile | null;
}

export interface PromptPasteDecision<TFile> {
  files: TFile[];
  shouldPreventDefault: boolean;
}

const TextClipboardFormats = ['text/plain', 'text', 'text/html'];

const getClipboardText = <TFile>(
  clipboardData: PromptClipboardData<TFile>,
  format: string,
): string => {
  try {
    return clipboardData.getData?.(format) ?? '';
  } catch {
    return '';
  }
};

const hasTextualClipboardData = <TFile>(clipboardData: PromptClipboardData<TFile>): boolean => {
  if (TextClipboardFormats.some(format => getClipboardText(clipboardData, format).length > 0)) {
    return true;
  }

  const types = Array.from(clipboardData.types ?? [], type => type.toLowerCase());
  return TextClipboardFormats.some(format => types.includes(format));
};

const getClipboardFiles = <TFile>(clipboardData: PromptClipboardData<TFile>): TFile[] => {
  const files = Array.from(clipboardData.files ?? []);
  if (files.length > 0) return files;

  const itemFiles: TFile[] = [];
  for (const item of Array.from(clipboardData.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile?.() ?? null;
    if (file !== null) {
      itemFiles.push(file);
    }
  }
  return itemFiles;
};

export const resolvePromptPasteDecision = <TFile>(
  clipboardData: PromptClipboardData<TFile> | null,
): PromptPasteDecision<TFile> => {
  if (!clipboardData) {
    return {
      files: [],
      shouldPreventDefault: false,
    };
  }

  const files = getClipboardFiles(clipboardData);

  return {
    files,
    shouldPreventDefault: files.length > 0 && !hasTextualClipboardData(clipboardData),
  };
};
