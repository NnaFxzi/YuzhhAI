import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

import type { KnowledgeExtractionAuthorizationPreparation } from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import {
  createKnowledgeExtractionDialogPreparationController,
  createKnowledgeExtractionDialogSubmissionController,
  focusKnowledgeExtractionDialogInitialControl,
  handleKnowledgeExtractionDialogKeyDown,
  restoreKnowledgeExtractionDialogOpenerFocus,
  WorkspaceKnowledgeExtractionDialogView,
} from './WorkspaceKnowledgeExtractionDialog';

const preparation = (): KnowledgeExtractionAuthorizationPreparation => ({
  authorizationToken: 'secret-authorization-token',
  descriptor: {
    workspaceId: 'workspace-a',
    documentId: 'document-a',
    documentVersionId: 'version-a',
    documentDisplayName: 'Factory Manual.pdf',
    providerId: 'provider-private-id',
    providerLabel: 'Safe Provider',
    modelId: 'model-private-id',
    modelLabel: 'Safe Model',
    plannedModelCalls: 3,
    partial: true,
    expiresAt: '2026-07-13T15:30:00.000Z',
  },
});

describe('WorkspaceKnowledgeExtractionDialogView', () => {
  test('renders the safe authorization descriptor with locked dialog semantics', () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceKnowledgeExtractionDialogView, {
        descriptor: preparation().descriptor,
        isPreparing: false,
        isConsuming: false,
        errorKey: null,
        onCancel: vi.fn(),
        onSend: vi.fn(),
        onKeyDown: vi.fn(),
      }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="enterprise-knowledge-extraction-title"');
    expect(html).toContain('aria-describedby="enterprise-knowledge-extraction-description"');
    expect(html).toContain('Factory Manual.pdf');
    expect(html).toContain('Safe Provider');
    expect(html).toContain('Safe Model');
    expect(html).toContain('>3<');
    expect(html).toContain(
      i18nService.t('enterpriseKnowledgeExtractionAuthorizationPartialWarning'),
    );
    expect(html).toContain('dateTime="2026-07-13T15:30:00.000Z"');
    expect(html).toContain('data-testid="knowledge-extraction-cancel"');
    expect(html).toContain('data-testid="knowledge-extraction-send"');
    expect(html).not.toContain('secret-authorization-token');
    expect(html).not.toContain('provider-private-id');
    expect(html).not.toContain('model-private-id');
  });

  test('keeps cancel available while preparation or consumption disables paid send', () => {
    for (const props of [
      { isPreparing: true, isConsuming: false },
      { isPreparing: false, isConsuming: true },
    ]) {
      const html = renderToStaticMarkup(
        React.createElement(WorkspaceKnowledgeExtractionDialogView, {
          descriptor: props.isPreparing ? null : preparation().descriptor,
          errorKey: null,
          onCancel: vi.fn(),
          onSend: vi.fn(),
          onKeyDown: vi.fn(),
          ...props,
        }),
      );
      const cancelStart = html.indexOf('data-testid="knowledge-extraction-cancel"');
      const sendStart = html.indexOf('data-testid="knowledge-extraction-send"');
      expect(cancelStart).toBeGreaterThanOrEqual(0);
      expect(html.slice(cancelStart, sendStart)).not.toContain('disabled=""');
      expect(html.slice(sendStart)).toContain('disabled=""');
    }
  });

  test('keeps preparation errors live while cancel remains outside the mutable status region', () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceKnowledgeExtractionDialogView, {
        descriptor: null,
        isPreparing: false,
        isConsuming: false,
        errorKey: 'enterpriseKnowledgeErrorPersistence',
        onCancel: vi.fn(),
        onSend: vi.fn(),
        onKeyDown: vi.fn(),
      }),
    );
    const liveRegionStart = html.indexOf('role="status"');
    const actionsStart = html.indexOf('class="mt-5 flex justify-end gap-2"');
    const cancelStart = html.indexOf('data-testid="knowledge-extraction-cancel"');

    expect(html).toContain('text-red-600');
    expect(actionsStart).toBeGreaterThan(liveRegionStart);
    expect(cancelStart).toBeGreaterThan(actionsStart);
    expect(html.slice(liveRegionStart, actionsStart)).not.toContain(
      'data-testid="knowledge-extraction-cancel"',
    );
  });
});

describe('knowledge extraction dialog authorization lifecycle', () => {
  test('reuses one preparation promise when a StrictMode effect setup is replayed', async () => {
    const expected = preparation();
    const prepare = vi.fn(async () => expected);
    const controller = createKnowledgeExtractionDialogPreparationController(prepare);

    const firstSetup = controller.prepareOnce();
    const strictModeReplay = controller.prepareOnce();

    expect(prepare).toHaveBeenCalledTimes(1);
    await expect(firstSetup).resolves.toBe(expected);
    await expect(strictModeReplay).resolves.toBe(expected);
  });

  test('cancel and dispose clear authorization without a durable send', async () => {
    const onSend = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const cancelled = createKnowledgeExtractionDialogSubmissionController({ onSend, onClose });
    cancelled.authorize(preparation());
    cancelled.cancel();
    await cancelled.send();

    const disposed = createKnowledgeExtractionDialogSubmissionController({ onSend, onClose });
    disposed.authorize(preparation());
    disposed.dispose();
    await disposed.send();

    expect(onSend).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('rapid paid-send activation consumes one token exactly once', async () => {
    let resolveSend!: () => void;
    const sendResult = new Promise<void>(resolve => {
      resolveSend = resolve;
    });
    const onSend = vi.fn(() => sendResult);
    const onClose = vi.fn();
    const controller = createKnowledgeExtractionDialogSubmissionController({ onSend, onClose });
    controller.authorize(preparation());

    const first = controller.send();
    const second = controller.send();

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('secret-authorization-token');
    resolveSend();
    await Promise.all([first, second]);
    await controller.send();
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('does not let an unmounted old submission close a newer dialog intent', async () => {
    let resolveSend!: () => void;
    const sendResult = new Promise<void>(resolve => {
      resolveSend = resolve;
    });
    let mounted = true;
    const onClose = vi.fn();
    const controller = createKnowledgeExtractionDialogSubmissionController({
      onSend: () => sendResult,
      onClose,
      isMounted: () => mounted,
    });
    controller.authorize(preparation());

    const submission = controller.send();
    mounted = false;
    resolveSend();
    await submission;

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('knowledge extraction dialog keyboard and focus behavior', () => {
  test('traps Tab and Shift+Tab and routes Escape through cancel', () => {
    const cancel = { focus: vi.fn() };
    const send = { focus: vi.fn() };
    const onCancel = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    handleKnowledgeExtractionDialogKeyDown(
      { key: 'Tab', shiftKey: false, target: send, preventDefault, stopPropagation },
      [cancel, send],
      onCancel,
    );
    expect(cancel.focus).toHaveBeenCalledTimes(1);

    handleKnowledgeExtractionDialogKeyDown(
      { key: 'Tab', shiftKey: true, target: cancel, preventDefault, stopPropagation },
      [cancel, send],
      onCancel,
    );
    expect(send.focus).toHaveBeenCalledTimes(1);

    const escape = {
      key: 'Escape',
      shiftKey: false,
      target: send,
      preventDefault,
      stopPropagation,
    };
    handleKnowledgeExtractionDialogKeyDown(
      escape,
      [cancel, send],
      onCancel,
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(3);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  test('focuses cancel initially and restores only a connected opener', () => {
    const cancel = { focus: vi.fn(), isConnected: true };
    const connectedOpener = { focus: vi.fn(), isConnected: true };
    const removedOpener = { focus: vi.fn(), isConnected: false };

    focusKnowledgeExtractionDialogInitialControl(cancel);
    restoreKnowledgeExtractionDialogOpenerFocus(connectedOpener);
    restoreKnowledgeExtractionDialogOpenerFocus(removedOpener);

    expect(cancel.focus).toHaveBeenCalledTimes(1);
    expect(connectedOpener.focus).toHaveBeenCalledTimes(1);
    expect(removedOpener.focus).not.toHaveBeenCalled();
  });
});
