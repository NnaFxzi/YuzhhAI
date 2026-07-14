import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { KnowledgeFactDomain } from '../../../shared/knowledgeBase/constants';
import { i18nService } from '../../services/i18n';
import type { WorkspaceAiKnowledgeProjectionDialogState } from './useWorkspaceAiKnowledge';
import {
  buildWorkspaceKnowledgeFactDialogOwnershipKey,
  createWorkspaceKnowledgeFactDialogSubmissionGuard,
  createWorkspaceKnowledgeFactDialogSubmissionGuardOwner,
  focusWorkspaceKnowledgeFactDialogInitialControl,
  handleWorkspaceKnowledgeFactDialogKeyDown,
  restoreWorkspaceKnowledgeFactDialogFocus,
  WorkspaceKnowledgeFactDialogsView,
} from './WorkspaceKnowledgeFactDialogs';

const companyDialog = {
  kind: 'company_replacement' as const,
  dialogGeneration: 3,
  workspaceGeneration: 1,
  factId: 'private-fact-id',
  factRevision: 4,
  domain: KnowledgeFactDomain.CompanySummary,
  currentFieldValue: 'Current safe company summary',
  fieldRevision: 7,
  isSubmitting: false,
  errorCode: null,
} satisfies WorkspaceAiKnowledgeProjectionDialogState;

const renderDialog = (
  dialog: WorkspaceAiKnowledgeProjectionDialogState,
): string =>
  renderToStaticMarkup(
    React.createElement(WorkspaceKnowledgeFactDialogsView, {
      dialog,
      onCancel: vi.fn(),
      onReplace: vi.fn(),
      onKeepCurrent: vi.fn(),
      onRemoveCurrent: vi.fn(),
      onKeyDown: vi.fn(),
    }),
  );

describe('WorkspaceKnowledgeFactDialogsView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders labelled modal semantics and only safe company replacement data', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const html = renderDialog(companyDialog);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="enterprise-ai-knowledge-fact-dialog-title-3"');
    expect(html).toContain(
      'aria-describedby="enterprise-ai-knowledge-fact-dialog-description-3"',
    );
    expect(html).toContain('enterpriseAiKnowledgeCompanyConflictTitle');
    expect(html).toContain('enterpriseAiKnowledgeCompanyConflictDescription');
    expect(html).toContain('Current safe company summary');
    expect(html).toContain('data-fact-dialog-cancel');
    expect(html).toContain('data-fact-dialog-replace');
    expect(html).not.toContain('data-fact-dialog-keep');
    expect(html).not.toContain('data-fact-dialog-remove');
    expect(html).not.toContain('private-fact-id');
    expect(html).not.toContain('>7<');
  });

  test('renders archive choices while ledgerless recovery omits RemoveCurrent from the DOM', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const archiveHtml = renderDialog({
      kind: 'archive_conflict',
      dialogGeneration: 4,
      workspaceGeneration: 1,
      factId: 'fact-archive',
      factRevision: 2,
      domain: KnowledgeFactDomain.ProductList,
      currentFieldValue: ['Current product A', 'Current product B'],
      fieldRevision: 8,
      isSubmitting: false,
      errorCode: null,
    });
    const ledgerlessHtml = renderDialog({
      kind: 'archive_ledgerless',
      dialogGeneration: 5,
      workspaceGeneration: 1,
      factId: 'fact-ledgerless',
      factRevision: 2,
      domain: KnowledgeFactDomain.ProductList,
      currentFieldValue: null,
      fieldRevision: null,
      isSubmitting: false,
      errorCode: null,
    });

    expect(archiveHtml).toContain('Current product A');
    expect(archiveHtml).toContain('Current product B');
    expect(archiveHtml).toContain('data-fact-dialog-keep');
    expect(archiveHtml).toContain('data-fact-dialog-remove');
    expect(ledgerlessHtml).toContain('enterpriseAiKnowledgeArchiveLedgerlessDescription');
    expect(ledgerlessHtml).toContain('data-fact-dialog-keep');
    expect(ledgerlessHtml).not.toContain('data-fact-dialog-remove');
    expect(ledgerlessHtml).not.toContain('enterpriseAiKnowledgeArchiveRemoveCurrent');
  });

  test('shows fixed live feedback and a visible disabled reason without raw diagnostics', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const html = renderDialog(
      {
        ...companyDialog,
        isSubmitting: true,
        errorCode: 'private SQL /tmp/secret endpoint stack',
      } as unknown as WorkspaceAiKnowledgeProjectionDialogState,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('enterpriseAiKnowledgeMutationSubmitting');
    expect(html).toContain('enterpriseAiKnowledgeMutationDisabledReason');
    expect(html).toContain('disabled=""');
    expect(html).toContain('role="alert"');
    expect(html).toContain('enterpriseAiKnowledgeMutationFailed');
    expect(html).not.toContain('private SQL');
    expect(html).not.toContain('/tmp/secret');
    expect(html).not.toContain('endpoint');
    expect(html).not.toContain('stack');
  });
});

describe('workspace knowledge fact dialog keyboard and submission safety', () => {
  test('focuses Cancel, traps Tab in both directions, and cancels with Escape only while idle', () => {
    const cancel = { focus: vi.fn(), isConnected: true };
    const destructive = { focus: vi.fn(), isConnected: true };
    const onCancel = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const outerEscapeHandler = vi.fn();

    focusWorkspaceKnowledgeFactDialogInitialControl(cancel);
    expect(cancel.focus).toHaveBeenCalledTimes(1);

    handleWorkspaceKnowledgeFactDialogKeyDown(
      {
        key: 'Tab',
        shiftKey: false,
        target: destructive,
        preventDefault,
        stopPropagation,
      },
      [cancel, destructive],
      onCancel,
      false,
    );
    expect(cancel.focus).toHaveBeenCalledTimes(2);
    handleWorkspaceKnowledgeFactDialogKeyDown(
      {
        key: 'Tab',
        shiftKey: true,
        target: cancel,
        preventDefault,
        stopPropagation,
      },
      [cancel, destructive],
      onCancel,
      false,
    );
    expect(destructive.focus).toHaveBeenCalledTimes(1);
    const idleEscape = {
      key: 'Escape',
      shiftKey: false,
      target: destructive,
      preventDefault,
      stopPropagation,
    };
    handleWorkspaceKnowledgeFactDialogKeyDown(
      idleEscape,
      [cancel, destructive],
      onCancel,
      false,
    );
    if (stopPropagation.mock.calls.length === 0) {
      outerEscapeHandler();
    }
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(outerEscapeHandler).not.toHaveBeenCalled();
  });

  test('stops a submitting Escape before it reaches the outer document shortcut', () => {
    const onCancel = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const outerEscapeHandler = vi.fn();
    const submittingEscape = {
      key: 'Escape',
      shiftKey: false,
      target: null,
      preventDefault,
      stopPropagation,
    };

    handleWorkspaceKnowledgeFactDialogKeyDown(
      submittingEscape,
      [],
      onCancel,
      true,
    );
    if (stopPropagation.mock.calls.length === 0) {
      outerEscapeHandler();
    }

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(outerEscapeHandler).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('keeps Tab and Shift+Tab inside a submitting dialog when every action is disabled', () => {
    const dialogContainer = { focus: vi.fn(), isConnected: true };
    const onCancel = vi.fn();

    for (const shiftKey of [false, true]) {
      const preventDefault = vi.fn();
      handleWorkspaceKnowledgeFactDialogKeyDown(
        {
          key: 'Tab',
          shiftKey,
          target: null,
          preventDefault,
          stopPropagation: vi.fn(),
        },
        [],
        onCancel,
        true,
        dialogContainer,
      );
      expect(preventDefault).toHaveBeenCalledTimes(1);
    }

    expect(dialogContainer.focus).toHaveBeenCalledTimes(2);
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('ignores Enter/Space at the dialog level and restores a stable fallback for a removed opener', () => {
    const opener = { focus: vi.fn(), isConnected: false };
    const fallback = { focus: vi.fn(), isConnected: true };
    const cancel = { focus: vi.fn() };
    const destructive = { focus: vi.fn() };
    const onCancel = vi.fn();
    const preventDefault = vi.fn();

    for (const key of ['Enter', ' ']) {
      handleWorkspaceKnowledgeFactDialogKeyDown(
        {
          key,
          shiftKey: false,
          target: cancel,
          preventDefault,
          stopPropagation: vi.fn(),
        },
        [cancel, destructive],
        onCancel,
        false,
      );
    }
    restoreWorkspaceKnowledgeFactDialogFocus(opener, fallback);

    expect(onCancel).not.toHaveBeenCalled();
    expect(destructive.focus).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(opener.focus).not.toHaveBeenCalled();
    expect(fallback.focus).toHaveBeenCalledTimes(1);
  });

  test('restores the stable fallback when there was no opener', () => {
    const fallback = { focus: vi.fn(), isConnected: true };

    restoreWorkspaceKnowledgeFactDialogFocus(null, fallback);

    expect(fallback.focus).toHaveBeenCalledTimes(1);
  });

  test('guards replacement/removal actions against rapid double activation', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>(resolvePromise => {
      resolve = resolvePromise;
    });
    const action = vi.fn(() => pending);
    const guard = createWorkspaceKnowledgeFactDialogSubmissionGuard();

    const first = guard.run(action);
    const duplicate = guard.run(action);
    expect(action).toHaveBeenCalledTimes(1);
    resolve();
    await Promise.all([first, duplicate]);

    await guard.run(async () => undefined);
    expect(guard.isSubmitting()).toBe(false);
  });

  test('a pending guard from an old dialog generation cannot block a new generation', async () => {
    let resolveOld!: () => void;
    const oldPending = new Promise<void>(resolve => {
      resolveOld = resolve;
    });
    const oldAction = vi.fn(() => oldPending);
    const newAction = vi.fn(async () => undefined);
    const oldOwnership = buildWorkspaceKnowledgeFactDialogOwnershipKey(companyDialog);
    const newOwnership = buildWorkspaceKnowledgeFactDialogOwnershipKey({
      ...companyDialog,
      workspaceGeneration: 2,
      factId: 'new-fact-with-reused-dialog-generation',
    });

    const guardOwner = createWorkspaceKnowledgeFactDialogSubmissionGuardOwner();
    const oldSubmission = guardOwner.run(oldOwnership, oldAction);
    await guardOwner.run(newOwnership, newAction);

    expect(oldOwnership).not.toBe(newOwnership);
    expect(guardOwner.isSubmitting(oldOwnership)).toBe(false);
    expect(newAction).toHaveBeenCalledTimes(1);
    resolveOld();
    await oldSubmission;
  });
});
