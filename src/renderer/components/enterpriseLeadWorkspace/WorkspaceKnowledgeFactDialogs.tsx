import React, { useCallback, useEffect, useRef } from 'react';

import { i18nService } from '../../services/i18n';
import {
  WorkspaceAiKnowledgeProjectionDialogKind,
  type WorkspaceAiKnowledgeProjectionDialogState,
} from './useWorkspaceAiKnowledge';
import {
  focusKnowledgeExtractionDialogInitialControl,
  handleKnowledgeExtractionDialogKeyDown,
  type KnowledgeExtractionDialogFocusable,
  type KnowledgeExtractionDialogKeyboardEvent,
  restoreKnowledgeExtractionDialogOpenerFocus,
} from './WorkspaceKnowledgeExtractionDialog';

export interface WorkspaceKnowledgeFactDialogSubmissionGuard {
  run: (action: () => Promise<void> | void) => Promise<void>;
  isSubmitting: () => boolean;
}

export const createWorkspaceKnowledgeFactDialogSubmissionGuard =
  (): WorkspaceKnowledgeFactDialogSubmissionGuard => {
    let submitting = false;
    let inFlight: Promise<void> | null = null;
    return {
      run: action => {
        if (submitting) {
          return inFlight ?? Promise.resolve();
        }
        submitting = true;
        try {
          let owned!: Promise<void>;
          owned = Promise.resolve(action()).finally(() => {
            if (inFlight === owned) {
              inFlight = null;
              submitting = false;
            }
          });
          inFlight = owned;
          return owned;
        } catch {
          submitting = false;
          return Promise.resolve();
        }
      },
      isSubmitting: () => submitting,
    };
  };

export interface WorkspaceKnowledgeFactDialogSubmissionGuardOwner {
  run: (
    ownershipKey: string,
    action: () => Promise<void> | void,
  ) => Promise<void>;
  isSubmitting: (ownershipKey: string) => boolean;
}

export const buildWorkspaceKnowledgeFactDialogOwnershipKey = (
  dialog: Pick<
    WorkspaceAiKnowledgeProjectionDialogState,
    | 'workspaceGeneration'
    | 'dialogGeneration'
    | 'kind'
    | 'factId'
    | 'factRevision'
  >,
): string =>
  JSON.stringify([
    dialog.workspaceGeneration,
    dialog.dialogGeneration,
    dialog.kind,
    dialog.factId,
    dialog.factRevision,
  ]);

export const createWorkspaceKnowledgeFactDialogSubmissionGuardOwner =
  (): WorkspaceKnowledgeFactDialogSubmissionGuardOwner => {
    let ownedKey: string | null = null;
    let guard = createWorkspaceKnowledgeFactDialogSubmissionGuard();
    const getGuard = (ownershipKey: string): WorkspaceKnowledgeFactDialogSubmissionGuard => {
      if (ownedKey !== ownershipKey) {
        ownedKey = ownershipKey;
        guard = createWorkspaceKnowledgeFactDialogSubmissionGuard();
      }
      return guard;
    };
    return {
      run: (ownershipKey, action) => getGuard(ownershipKey).run(action),
      isSubmitting: ownershipKey =>
        ownedKey === ownershipKey && guard.isSubmitting(),
    };
  };

export const focusWorkspaceKnowledgeFactDialogInitialControl = (
  cancelControl: KnowledgeExtractionDialogFocusable | null,
): void => {
  focusKnowledgeExtractionDialogInitialControl(cancelControl);
};

export const restoreWorkspaceKnowledgeFactDialogFocus = (
  opener: KnowledgeExtractionDialogFocusable | null,
  fallback: KnowledgeExtractionDialogFocusable | null,
): void => {
  if (opener && opener.isConnected !== false) {
    restoreKnowledgeExtractionDialogOpenerFocus(opener);
    return;
  }
  restoreKnowledgeExtractionDialogOpenerFocus(fallback);
};

export const handleWorkspaceKnowledgeFactDialogKeyDown = (
  event: KnowledgeExtractionDialogKeyboardEvent,
  controls: readonly KnowledgeExtractionDialogFocusable[],
  onCancel: () => void,
  isSubmitting: boolean,
  dialogContainer?: KnowledgeExtractionDialogFocusable | null,
): void => {
  if (isSubmitting && event.key === 'Tab') {
    event.preventDefault();
    dialogContainer?.focus();
    return;
  }
  if (isSubmitting && event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  handleKnowledgeExtractionDialogKeyDown(event, controls, onCancel);
};

export interface WorkspaceKnowledgeFactDialogsViewProps {
  dialog: WorkspaceAiKnowledgeProjectionDialogState;
  onCancel: () => void;
  onReplace: () => void;
  onKeepCurrent: () => void;
  onRemoveCurrent: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  dialogRef?: React.RefObject<HTMLDivElement>;
  cancelButtonRef?: React.RefObject<HTMLButtonElement>;
}

const renderCurrentFieldValue = (
  value: string | string[] | null,
): React.ReactElement | null => {
  if (value === null) {
    return null;
  }
  return Array.isArray(value) ? (
    <ul className="mt-3 list-disc space-y-1 pl-5">
      {value.map((item, index) => (
        <li key={`${index}:${item}`}>{item}</li>
      ))}
    </ul>
  ) : (
    <p className="mt-3 break-words rounded-lg bg-muted px-3 py-2">{value}</p>
  );
};

export const WorkspaceKnowledgeFactDialogsView = ({
  dialog,
  onCancel,
  onReplace,
  onKeepCurrent,
  onRemoveCurrent,
  onKeyDown,
  dialogRef,
  cancelButtonRef,
}: WorkspaceKnowledgeFactDialogsViewProps): React.ReactElement => {
  const titleId = `enterprise-ai-knowledge-fact-dialog-title-${dialog.dialogGeneration}`;
  const descriptionId = `enterprise-ai-knowledge-fact-dialog-description-${dialog.dialogGeneration}`;
  const isCompany =
    dialog.kind === WorkspaceAiKnowledgeProjectionDialogKind.CompanyReplacement;
  const isLedgerless =
    dialog.kind === WorkspaceAiKnowledgeProjectionDialogKind.ArchiveLedgerless;
  const titleKey = isCompany
    ? 'enterpriseAiKnowledgeCompanyConflictTitle'
    : 'enterpriseAiKnowledgeArchiveConflictTitle';
  const descriptionKey = isCompany
    ? 'enterpriseAiKnowledgeCompanyConflictDescription'
    : isLedgerless
      ? 'enterpriseAiKnowledgeArchiveLedgerlessDescription'
      : 'enterpriseAiKnowledgeArchiveConflictDescription';

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/30 px-4 py-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <h3 id={titleId} className="text-base font-semibold">
          {i18nService.t(titleKey)}
        </h3>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-secondary">
          {i18nService.t(descriptionKey)}
        </p>
        {!isLedgerless ? renderCurrentFieldValue(dialog.currentFieldValue) : null}

        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={i18nService.t('enterpriseAiKnowledgeMutationLiveStatus')}
          className="mt-4 text-sm text-secondary"
        >
          {dialog.isSubmitting
            ? i18nService.t('enterpriseAiKnowledgeMutationSubmitting')
            : null}
        </div>
        {dialog.errorCode ? (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">
            {i18nService.t('enterpriseAiKnowledgeMutationFailed')}
          </p>
        ) : null}
        {dialog.isSubmitting ? (
          <p className="mt-2 text-sm text-secondary">
            {i18nService.t('enterpriseAiKnowledgeMutationDisabledReason')}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            data-fact-dialog-cancel
            disabled={dialog.isSubmitting}
            onClick={onCancel}
          >
            {i18nService.t('enterpriseAiKnowledgeDialogCancel')}
          </button>
          {isCompany ? (
            <button
              type="button"
              data-fact-dialog-replace
              disabled={dialog.isSubmitting}
              onClick={onReplace}
            >
              {i18nService.t('enterpriseAiKnowledgeCompanyReplace')}
            </button>
          ) : (
            <>
              <button
                type="button"
                data-fact-dialog-keep
                disabled={dialog.isSubmitting}
                onClick={onKeepCurrent}
              >
                {i18nService.t('enterpriseAiKnowledgeArchiveKeepCurrent')}
              </button>
              {!isLedgerless ? (
                <button
                  type="button"
                  data-fact-dialog-remove
                  disabled={dialog.isSubmitting}
                  onClick={onRemoveCurrent}
                >
                  {i18nService.t('enterpriseAiKnowledgeArchiveRemoveCurrent')}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export interface WorkspaceKnowledgeFactDialogsProps {
  dialog: WorkspaceAiKnowledgeProjectionDialogState | null;
  onCancel: () => void;
  onReplace: () => Promise<void> | void;
  onKeepCurrent: () => Promise<void> | void;
  onRemoveCurrent: () => Promise<void> | void;
  fallbackFocusRef?: React.RefObject<HTMLElement>;
}

export const WorkspaceKnowledgeFactDialogs = ({
  dialog,
  onCancel,
  onReplace,
  onKeepCurrent,
  onRemoveCurrent,
  fallbackFocusRef,
}: WorkspaceKnowledgeFactDialogsProps): React.ReactElement | null => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const submissionGuardRef =
    useRef<WorkspaceKnowledgeFactDialogSubmissionGuardOwner | null>(null);
  if (!submissionGuardRef.current) {
    submissionGuardRef.current =
      createWorkspaceKnowledgeFactDialogSubmissionGuardOwner();
  }
  const dialogOwnershipKey = dialog
    ? buildWorkspaceKnowledgeFactDialogOwnershipKey(dialog)
    : null;

  useEffect(() => {
    if (!dialogOwnershipKey) {
      return;
    }
    openerRef.current =
      typeof document === 'undefined'
        ? null
        : (document.activeElement as HTMLElement | null);
    focusWorkspaceKnowledgeFactDialogInitialControl(cancelButtonRef.current);
    const opener = openerRef.current;
    const fallback = fallbackFocusRef?.current ?? null;
    return () => {
      restoreWorkspaceKnowledgeFactDialogFocus(opener, fallback);
    };
  }, [dialogOwnershipKey, fallbackFocusRef]);

  const runGuarded = useCallback(
    (action: () => Promise<void> | void): void => {
      if (dialogOwnershipKey) {
        void submissionGuardRef.current?.run(dialogOwnershipKey, action);
      }
    },
    [dialogOwnershipKey],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const controls = dialogRef.current
        ? Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];
      handleWorkspaceKnowledgeFactDialogKeyDown(
        event,
        controls,
        onCancel,
        dialog?.isSubmitting ?? false,
        dialogRef.current,
      );
    },
    [dialog?.isSubmitting, onCancel],
  );

  if (!dialog) {
    return null;
  }

  return (
    <WorkspaceKnowledgeFactDialogsView
      dialog={dialog}
      onCancel={onCancel}
      onReplace={() => runGuarded(onReplace)}
      onKeepCurrent={() => runGuarded(onKeepCurrent)}
      onRemoveCurrent={() => runGuarded(onRemoveCurrent)}
      onKeyDown={onKeyDown}
      dialogRef={dialogRef}
      cancelButtonRef={cancelButtonRef}
    />
  );
};

export default WorkspaceKnowledgeFactDialogs;
