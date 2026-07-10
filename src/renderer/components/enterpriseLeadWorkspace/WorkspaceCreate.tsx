import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  DocumentTextIcon,
  FolderOpenIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import React, { useState } from 'react';

import { EnterpriseLeadExtractionSourceKind } from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceSettings,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import {
  buildManualEnterpriseLeadWorkspaceDraft,
  createWorkspaceFromUploadedMaterials,
  getWorkspaceCreateBranchScreen,
  type MaterialUploadItem,
  WorkspaceCreateBranchScreen,
  WorkspaceCreateStartMode,
  type WorkspaceCreateStartMode as WorkspaceCreateStartModeType,
} from './enterpriseLeadWorkspaceUi';
import { WorkspaceMaterialUpload } from './WorkspaceMaterialUpload';
import { buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig } from './WorkspaceWorkbench';

interface WorkspaceCreateProps {
  onCreated: (workspaceId: string) => void;
  onCancel: () => void;
}

interface StartModeOption {
  id: WorkspaceCreateStartModeType;
  titleKey: string;
  descriptionKey: string;
  badgeKey: string;
  icon: React.ReactNode;
}

const formatWorkspaceNameText = (key: string, name: string): string =>
  i18nService.t(key).replace('{name}', name);

const normalizeOptionalFileSize = (fileSize?: number | null): number | undefined =>
  typeof fileSize === 'number' && Number.isFinite(fileSize) && fileSize > 0 ? fileSize : undefined;

export const createWorkspaceFromUploadedMaterial = async ({
  workspaceName,
  sourceText,
  sourceLabel,
  fileName,
  fileSize,
  settings,
  onCreated,
  service = enterpriseLeadWorkspaceService,
}: {
  workspaceName: string;
  sourceText: string;
  sourceLabel: string;
  fileName?: string;
  fileSize?: number | null;
  settings?: EnterpriseLeadWorkspaceSettings;
  onCreated: (workspaceId: string) => void;
  service?: Pick<typeof enterpriseLeadWorkspaceService, 'createWorkspace' | 'processDocumentSource'>;
}): Promise<EnterpriseLeadWorkspace | null> => {
  const cleanSourceText = sourceText.trim();
  if (!cleanSourceText) {
    throw new Error('Uploaded material text is required');
  }

  return createWorkspaceFromUploadedMaterials({
    workspaceName,
    items: [
      {
        id: 'singular-legacy',
        filePath: '',
        fileName: fileName?.trim() || sourceLabel.trim(),
        fileSize: normalizeOptionalFileSize(fileSize),
        kind: EnterpriseLeadExtractionSourceKind.File,
        text: cleanSourceText,
      },
    ],
    settings,
    onCreated,
    service,
  });
};

const startModeOptions: StartModeOption[] = [
  {
    id: WorkspaceCreateStartMode.Material,
    titleKey: 'enterpriseLeadCreateModeMaterialTitle',
    descriptionKey: 'enterpriseLeadCreateModeMaterialDesc',
    badgeKey: 'enterpriseLeadCreateModeRecommended',
    icon: <FolderOpenIcon className="h-5 w-5" />,
  },
  {
    id: WorkspaceCreateStartMode.Paste,
    titleKey: 'enterpriseLeadCreateModePasteTitle',
    descriptionKey: 'enterpriseLeadCreateModePasteDesc',
    badgeKey: 'enterpriseLeadCreateModeOptional',
    icon: <ClipboardDocumentIcon className="h-5 w-5" />,
  },
  {
    id: WorkspaceCreateStartMode.Blank,
    titleKey: 'enterpriseLeadCreateModeBlankTitle',
    descriptionKey: 'enterpriseLeadCreateModeBlankDesc',
    badgeKey: 'enterpriseLeadCreateModeOptional',
    icon: <PlusIcon className="h-5 w-5" />,
  },
];

export const WorkspaceCreate: React.FC<WorkspaceCreateProps> = ({ onCreated, onCancel }) => {
  const [workspaceName, setWorkspaceName] = useState('');
  const [selectedMode, setSelectedMode] = useState<WorkspaceCreateStartModeType>(
    WorkspaceCreateStartMode.Material,
  );
  const [branchScreen, setBranchScreen] = useState<WorkspaceCreateBranchScreen | null>(null);
  const [materials, setMaterials] = useState<MaterialUploadItem[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const workspaceDisplayName =
    workspaceName.trim() || i18nService.t('enterpriseLeadCreateDefaultWorkspaceName');
  const isBusy = isCreating;

  const handleCancel = (): void => {
    if (isBusy) {
      return;
    }

    onCancel();
  };

  const handleNext = (): void => {
    setError([]);
    setBranchScreen(getWorkspaceCreateBranchScreen(selectedMode));
  };

  const handleBackToDetails = (): void => {
    setError([]);
    setBranchScreen(null);
  };

  const createWorkspaceFromDraft = async (draft: EnterpriseLeadWorkspaceDraft): Promise<void> => {
    setIsCreating(true);
    setError([]);

    try {
      const workspace = await enterpriseLeadWorkspaceService.createWorkspace(draft);
      if (!workspace) {
        setError([i18nService.t('enterpriseLeadCreateFailed')]);
        return;
      }

      onCreated(workspace.id);
    } catch {
      setError([i18nService.t('enterpriseLeadCreateFailed')]);
    } finally {
      setIsCreating(false);
    }
  };

  const createWorkspaceFromExtractedText = async (
    sourceText: string,
    sourceKind: EnterpriseLeadExtractionSourceKind,
    sourceLabel: string,
  ): Promise<void> => {
    const cleanSourceText = sourceText.trim();
    if (!cleanSourceText) {
      setError([i18nService.t('enterpriseLeadDraftEmpty')]);
      return;
    }

    setIsCreating(true);
    setError([]);

    try {
      const draft = await enterpriseLeadWorkspaceService.extractDraft(cleanSourceText);
      if (!draft) {
        setError([i18nService.t('enterpriseLeadExtractFailed')]);
        return;
      }

      const workspace = await enterpriseLeadWorkspaceService.createWorkspace({
        ...draft,
        name: workspaceDisplayName,
        source: {
          kind: sourceKind,
          label: sourceLabel,
          text: cleanSourceText,
        },
        settings: buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig(),
      });
      if (!workspace) {
        setError([i18nService.t('enterpriseLeadCreateFailed')]);
        return;
      }

      onCreated(workspace.id);
    } catch {
      setError([i18nService.t('enterpriseLeadCreateFailed')]);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateFromMaterial = (): void => {
    if (materials.length === 0) {
      setError([i18nService.t('enterpriseLeadCreateMaterialRequired')]);
      return;
    }

    setIsCreating(true);
    setError([]);
    const dialogApi = window.electron?.dialog;
    const ocrService = dialogApi?.extractImageText
      ? {
          extractImageText: (filePath: string) => dialogApi.extractImageText(filePath),
        }
      : undefined;
    void createWorkspaceFromUploadedMaterials({
      workspaceName: workspaceDisplayName,
      items: materials,
      settings: buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig(),
      onCreated,
      ocrService,
      onOcrProgress: ({ itemId, progress }) => {
        setMaterials(current =>
          current.map(item =>
            item.id === itemId
              ? { ...item, ocrProgress: Math.max(0, Math.min(1, progress)) }
              : item,
          ),
        );
      },
    })
      .then(workspace => {
        if (!workspace) {
          setError([i18nService.t('enterpriseLeadCreateFailed')]);
        }
      })
      .catch(() => {
        setError([i18nService.t('enterpriseLeadCreateFailed')]);
      })
      .finally(() => {
        setIsCreating(false);
        setMaterials(current =>
          current.map(item =>
            item.kind === 'image' && item.ocrProgress !== undefined
              ? { ...item, ocrProgress: item.text ? 1 : 0 }
              : item,
          ),
        );
      });
  };

  const handleCreateFromPaste = (): void => {
    if (!pasteText.trim()) {
      setError([i18nService.t('enterpriseLeadCreatePasteRequired')]);
      return;
    }

    void createWorkspaceFromExtractedText(
      pasteText,
      EnterpriseLeadExtractionSourceKind.Manual,
      i18nService.t('enterpriseLeadCreatePasteSourceLabel'),
    );
  };

  const handleCreateBlank = (): void => {
    void createWorkspaceFromDraft(
      buildManualEnterpriseLeadWorkspaceDraft({
        name: workspaceDisplayName,
        mode: WorkspaceCreateStartMode.Blank,
        sourceLabel: i18nService.t('enterpriseLeadCreateBlankSourceLabel'),
        settings: buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig(),
      }),
    );
  };

  const handleSkipMaterial = (): void => {
    void createWorkspaceFromDraft(
      buildManualEnterpriseLeadWorkspaceDraft({
        name: workspaceDisplayName,
        mode: WorkspaceCreateStartMode.Blank,
        sourceLabel: i18nService.t('enterpriseLeadCreateBlankSourceLabel'),
        settings: buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig(),
      }),
    );
  };

  const renderError = (): React.ReactNode => {
    if (error.length === 0) {
      return null;
    }

    return (
      <div
        className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300"
        role="alert"
      >
        {error.length === 1 ? (
          <span>{error[0]}</span>
        ) : (
          <ul className="list-disc pl-4">
            {error.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const renderPanelHeader = (
    titleKey: string,
    description: React.ReactNode,
    onBack: () => void,
  ): React.ReactNode => (
    <div className="mb-8 flex items-start justify-between gap-6">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold leading-tight text-foreground">
          {i18nService.t(titleKey)}
        </h1>
        <p className="mt-3 text-base leading-7 text-secondary">{description}</p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={isBusy}
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-secondary transition-colors hover:bg-surface-raised hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {i18nService.t('back')}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isBusy}
          className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-secondary transition-colors hover:bg-surface-raised hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {i18nService.t('enterpriseLeadCreateCancel')}
        </button>
      </div>
    </div>
  );

  const renderDetailsStep = (): React.ReactNode => (
    <>
      <div className="mb-8 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold leading-tight text-foreground">
            {i18nService.t('enterpriseLeadCreateWorkspace')}
          </h1>
          <p className="mt-3 text-base leading-7 text-secondary">
            {i18nService.t('enterpriseLeadCreateStartSubtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isBusy}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-secondary transition-colors hover:bg-surface-raised hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {i18nService.t('enterpriseLeadCreateReturnHome')}
        </button>
      </div>

      <div className="grid gap-6">
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-foreground">
            {i18nService.t('enterpriseLeadCreateWorkspaceNameLabel')}
          </span>
          <input
            value={workspaceName}
            onChange={event => {
              setWorkspaceName(event.target.value);
              setError([]);
            }}
            placeholder={i18nService.t('enterpriseLeadCreateWorkspaceNamePlaceholder')}
            className="h-12 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-secondary focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>

        <div className="grid gap-2">
          <span className="text-sm font-semibold text-foreground">
            {i18nService.t('enterpriseLeadCreateStartModeLabel')}
          </span>
          <div className="grid gap-3">
            {startModeOptions.map(option => {
              const isSelected = selectedMode === option.id;

              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedMode(option.id);
                    setError([]);
                  }}
                  className={`grid min-h-[76px] grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                    isSelected
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-border bg-background hover:border-primary/30 hover:bg-surface-raised'
                  }`}
                >
                  <span className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-primary">
                    {option.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">
                      {i18nService.t(option.titleKey)}
                    </span>
                    <span className="mt-1 block text-sm leading-5 text-secondary">
                      {i18nService.t(option.descriptionKey)}
                    </span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      isSelected ? 'bg-primary/10 text-primary' : 'text-secondary'
                    }`}
                  >
                    {i18nService.t(option.badgeKey)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {renderError()}

      <div className="mt-8 border-t border-border/70 pt-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-sm leading-5 text-secondary">
            {i18nService.t('enterpriseLeadCreateNextHint')}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isBusy}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-secondary transition-colors hover:bg-surface-raised hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {i18nService.t('enterpriseLeadCreateCancel')}
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {i18nService.t('enterpriseLeadCreateNext')}
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );

  const renderMaterialStep = (): React.ReactNode => (
    <>
      {renderPanelHeader(
        'enterpriseLeadCreateMaterialTitle',
        formatWorkspaceNameText('enterpriseLeadCreateMaterialSubtitle', workspaceDisplayName),
        handleBackToDetails,
      )}

      <WorkspaceMaterialUpload
        items={materials}
        onItemsChange={setMaterials}
        onError={setError}
        disabled={isBusy}
      />

      {renderError()}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm leading-5 text-secondary">
          {i18nService.t('enterpriseLeadCreateMaterialFooterHint')}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isBusy}
            className="inline-flex h-11 items-center rounded-lg border border-transparent px-4 text-sm font-semibold text-secondary transition-colors hover:bg-surface-raised hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {i18nService.t('enterpriseLeadCreateCancel')}
          </button>
          <button
            type="button"
            onClick={handleSkipMaterial}
            disabled={isBusy}
            className="inline-flex h-11 items-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {i18nService.t('enterpriseLeadCreateSkipForNow')}
          </button>
          <button
            type="button"
            onClick={handleCreateFromMaterial}
            disabled={isBusy}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <CheckIcon className="h-4 w-4" />
            )}
            {i18nService.t('enterpriseLeadCreateEnterWorkspace')}
          </button>
        </div>
      </div>
    </>
  );

  const renderPasteStep = (): React.ReactNode => (
    <>
      {renderPanelHeader(
        'enterpriseLeadCreatePasteTitle',
        formatWorkspaceNameText('enterpriseLeadCreatePasteSubtitle', workspaceDisplayName),
        handleBackToDetails,
      )}

      <label className="grid gap-2">
        <span className="text-sm font-semibold text-foreground">
          {i18nService.t('enterpriseLeadCreatePasteFieldLabel')}
        </span>
        <textarea
          value={pasteText}
          onChange={event => {
            setPasteText(event.target.value);
            setError([]);
          }}
          placeholder={i18nService.t('enterpriseLeadCreatePastePlaceholder')}
          className="min-h-[190px] resize-y rounded-lg border border-border bg-background px-3 py-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-secondary focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            setPasteText(i18nService.t('enterpriseLeadCreatePasteSampleText'));
            setError([]);
          }}
          className="rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary/30 hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <span className="block text-sm font-semibold text-foreground">
            {i18nService.t('enterpriseLeadCreatePasteSampleTitle')}
          </span>
          <span className="mt-1 block text-sm leading-5 text-secondary">
            {i18nService.t('enterpriseLeadCreatePasteSampleDesc')}
          </span>
        </button>
        <button
          type="button"
          onClick={handleCreateBlank}
          disabled={isBusy}
          className="rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary/30 hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="block text-sm font-semibold text-foreground">
            {i18nService.t('enterpriseLeadCreatePasteSkipTitle')}
          </span>
          <span className="mt-1 block text-sm leading-5 text-secondary">
            {i18nService.t('enterpriseLeadCreatePasteSkipDesc')}
          </span>
        </button>
      </div>

      {renderError()}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm leading-5 text-secondary">
          {i18nService.t('enterpriseLeadCreatePasteFooterHint')}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isBusy}
            className="inline-flex h-11 items-center rounded-lg border border-transparent px-4 text-sm font-semibold text-secondary transition-colors hover:bg-surface-raised hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {i18nService.t('enterpriseLeadCreateCancel')}
          </button>
          <button
            type="button"
            onClick={handleCreateFromPaste}
            disabled={isBusy}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <DocumentTextIcon className="h-4 w-4" />
            )}
            {i18nService.t('enterpriseLeadCreatePasteSubmit')}
          </button>
        </div>
      </div>
    </>
  );

  const renderBlankStep = (): React.ReactNode => (
    <>
      {renderPanelHeader(
        'enterpriseLeadCreateBlankTitle',
        formatWorkspaceNameText('enterpriseLeadCreateBlankSubtitle', workspaceDisplayName),
        handleBackToDetails,
      )}

      <div className="rounded-lg border border-border bg-surface-raised p-5">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-base font-semibold text-foreground">
            {i18nService.t('enterpriseLeadCreateBlankSummaryTitle')}
          </h2>
          <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
            {i18nService.t('enterpriseLeadCreateBlankSummaryBadge')}
          </span>
        </div>
        <ul className="mt-4 grid gap-2">
          {[
            'enterpriseLeadCreateBlankPointUploadLater',
            'enterpriseLeadCreateBlankPointBuildFirst',
            'enterpriseLeadCreateBlankPointKeepName',
          ].map(key => (
            <li
              key={key}
              className="grid grid-cols-[8px_minmax(0,1fr)] items-center gap-3 text-sm leading-6 text-secondary"
            >
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span>{i18nService.t(key)}</span>
            </li>
          ))}
        </ul>
      </div>

      {renderError()}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm leading-5 text-secondary">
          {i18nService.t('enterpriseLeadCreateBlankFooterHint')}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isBusy}
            className="inline-flex h-11 items-center rounded-lg border border-transparent px-4 text-sm font-semibold text-secondary transition-colors hover:bg-surface-raised hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {i18nService.t('enterpriseLeadCreateCancel')}
          </button>
          <button
            type="button"
            onClick={handleCreateBlank}
            disabled={isBusy}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <CheckIcon className="h-4 w-4" />
            )}
            {i18nService.t('enterpriseLeadCreateBlankSubmit')}
          </button>
        </div>
      </div>
    </>
  );

  const renderBranchStep = (): React.ReactNode => {
    if (branchScreen === WorkspaceCreateBranchScreen.Paste) {
      return renderPasteStep();
    }

    if (branchScreen === WorkspaceCreateBranchScreen.Blank) {
      return renderBlankStep();
    }

    return renderMaterialStep();
  };

  return (
    <div className="flex min-h-full flex-1 items-center justify-center overflow-y-auto bg-background px-6 py-10">
      <section className="w-full max-w-3xl rounded-xl border border-border bg-surface px-8 py-8 shadow-lg shadow-black/5 sm:px-12 sm:py-11">
        {branchScreen ? renderBranchStep() : renderDetailsStep()}
      </section>
    </div>
  );
};

export default WorkspaceCreate;