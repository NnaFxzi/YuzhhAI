import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { KnowledgeBaseErrorCode } from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeExtractionAuthorizationDescriptor,
  KnowledgeExtractionAuthorizationPreparation,
} from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import { KnowledgeBaseServiceError } from '../../services/knowledgeBase';
import { getKnowledgeDocumentErrorKey } from './knowledgeDocumentPresentation';

export interface KnowledgeExtractionDialogFocusable {
  focus: () => void;
  isConnected?: boolean;
}

export interface KnowledgeExtractionDialogKeyboardEvent {
  key: string;
  shiftKey: boolean;
  target: unknown;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export const focusKnowledgeExtractionDialogInitialControl = (
  cancelControl: KnowledgeExtractionDialogFocusable | null,
): void => {
  cancelControl?.focus();
};

export const restoreKnowledgeExtractionDialogOpenerFocus = (
  opener: KnowledgeExtractionDialogFocusable | null,
): void => {
  if (opener?.isConnected !== false) {
    opener?.focus();
  }
};

export const handleKnowledgeExtractionDialogKeyDown = (
  event: KnowledgeExtractionDialogKeyboardEvent,
  controls: readonly KnowledgeExtractionDialogFocusable[],
  onCancel: () => void,
): void => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    onCancel();
    return;
  }
  if (event.key !== 'Tab' || controls.length === 0) {
    return;
  }
  const currentIndex = controls.findIndex(control => control === event.target);
  const shouldWrapBackward = event.shiftKey && currentIndex <= 0;
  const shouldWrapForward = !event.shiftKey && currentIndex === controls.length - 1;
  const target = shouldWrapBackward
    ? controls[controls.length - 1]
    : shouldWrapForward || currentIndex < 0
      ? controls[0]
      : null;
  if (target) {
    event.preventDefault();
    target.focus();
  }
};

export interface KnowledgeExtractionDialogSubmissionController {
  authorize: (preparation: KnowledgeExtractionAuthorizationPreparation) => void;
  send: () => Promise<void>;
  cancel: () => void;
  clearAuthorization: () => void;
  dispose: () => void;
}

export const createKnowledgeExtractionDialogSubmissionController = (options: {
  onSend: (authorizationToken: string) => Promise<void>;
  onClose: () => void;
  onConsumingChange?: (isConsuming: boolean) => void;
  onError?: (error: unknown) => void;
  isMounted?: () => boolean;
}): KnowledgeExtractionDialogSubmissionController => {
  let authorizationToken: string | null = null;
  let consuming = false;
  let active = true;

  return {
    authorize: preparation => {
      if (active && !consuming) {
        authorizationToken = preparation.authorizationToken;
      }
    },
    send: async () => {
      if (!active || consuming || !authorizationToken) {
        return;
      }
      const token = authorizationToken;
      authorizationToken = null;
      consuming = true;
      options.onConsumingChange?.(true);
      try {
        await options.onSend(token);
        if (active) {
          active = false;
          if (options.isMounted?.() !== false) {
            options.onClose();
          }
        }
      } catch (error) {
        if (active) {
          options.onError?.(error);
        }
      } finally {
        consuming = false;
        if (active) {
          options.onConsumingChange?.(false);
        }
      }
    },
    cancel: () => {
      if (!active) {
        return;
      }
      active = false;
      authorizationToken = null;
      if (options.isMounted?.() !== false) {
        options.onClose();
      }
    },
    clearAuthorization: () => {
      authorizationToken = null;
    },
    dispose: () => {
      active = false;
      authorizationToken = null;
    },
  };
};

export interface KnowledgeExtractionDialogPreparationController {
  prepareOnce: () => Promise<KnowledgeExtractionAuthorizationPreparation>;
}

export const createKnowledgeExtractionDialogPreparationController = (
  prepare: () => Promise<KnowledgeExtractionAuthorizationPreparation>,
): KnowledgeExtractionDialogPreparationController => {
  let preparation: Promise<KnowledgeExtractionAuthorizationPreparation> | null = null;
  return {
    prepareOnce: () => {
      if (!preparation) {
        try {
          const pendingPreparation = prepare();
          preparation = pendingPreparation.finally(() => {
            preparation = null;
          });
        } catch (error) {
          preparation = Promise.reject(error);
        }
      }
      return preparation;
    },
  };
};

const formatExpiry = (expiresAt: string): string => {
  const timestamp = Date.parse(expiresAt);
  if (Number.isNaN(timestamp)) {
    return i18nService.t('enterpriseKnowledgeUnknownTime');
  }
  return new Intl.DateTimeFormat(i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
};

export interface WorkspaceKnowledgeExtractionDialogViewProps {
  descriptor: KnowledgeExtractionAuthorizationDescriptor | null;
  isPreparing: boolean;
  isConsuming: boolean;
  errorKey: string | null;
  onCancel: () => void;
  onSend: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  dialogRef?: React.RefObject<HTMLDivElement>;
  cancelButtonRef?: React.RefObject<HTMLButtonElement>;
}

export const WorkspaceKnowledgeExtractionDialogView = ({
  descriptor,
  isPreparing,
  isConsuming,
  errorKey,
  onCancel,
  onSend,
  onKeyDown,
  dialogRef,
  cancelButtonRef,
}: WorkspaceKnowledgeExtractionDialogViewProps): React.ReactElement => (
  <div className="absolute inset-0 z-40 grid place-items-center bg-black/30 px-4 py-6">
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="enterprise-knowledge-extraction-title"
      aria-describedby="enterprise-knowledge-extraction-description"
      className="w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-2xl"
      onKeyDown={onKeyDown}
    >
      <h3 id="enterprise-knowledge-extraction-title" className="text-base font-semibold">
        {i18nService.t('enterpriseKnowledgeExtractionAuthorizationTitle')}
      </h3>
      <p
        id="enterprise-knowledge-extraction-description"
        className="mt-2 text-sm leading-6 text-secondary"
      >
        {i18nService.t('enterpriseKnowledgeExtractionAuthorizationDescription')}
      </p>

      <div role="status" aria-live="polite" aria-atomic="true" className="mt-4">
        {isPreparing ? (
          <p className="text-sm text-secondary">
            {i18nService.t('enterpriseKnowledgeExtractionAuthorizationPreparing')}
          </p>
        ) : errorKey ? (
          <p className="text-sm text-red-600 dark:text-red-300">{i18nService.t(errorKey)}</p>
        ) : descriptor ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-secondary">
              {i18nService.t('enterpriseKnowledgeExtractionAuthorizationDocument')}
            </dt>
            <dd className="min-w-0 break-words">{descriptor.documentDisplayName}</dd>
            <dt className="text-secondary">
              {i18nService.t('enterpriseKnowledgeExtractionAuthorizationProvider')}
            </dt>
            <dd>{descriptor.providerLabel}</dd>
            <dt className="text-secondary">
              {i18nService.t('enterpriseKnowledgeExtractionAuthorizationModel')}
            </dt>
            <dd>{descriptor.modelLabel}</dd>
            <dt className="text-secondary">
              {i18nService.t('enterpriseKnowledgeExtractionAuthorizationPlannedCalls')}
            </dt>
            <dd>{descriptor.plannedModelCalls}</dd>
            <dt className="text-secondary">
              {i18nService.t('enterpriseKnowledgeExtractionAuthorizationExpiresAt')}
            </dt>
            <dd>
              <time dateTime={descriptor.expiresAt}>{formatExpiry(descriptor.expiresAt)}</time>
            </dd>
          </dl>
        ) : null}
        {descriptor?.partial ? (
          <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            {i18nService.t('enterpriseKnowledgeExtractionAuthorizationPartialWarning')}
          </p>
        ) : null}
        {isConsuming ? (
          <p className="mt-3 text-sm text-secondary">
            {i18nService.t('enterpriseKnowledgeExtractionAuthorizationSending')}
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          ref={cancelButtonRef}
          type="button"
          data-testid="knowledge-extraction-cancel"
          className="h-9 rounded-lg border border-border px-3 text-sm font-medium text-secondary"
          onClick={onCancel}
        >
          {i18nService.t('enterpriseKnowledgeCancel')}
        </button>
        <button
          type="button"
          data-testid="knowledge-extraction-send"
          disabled={isPreparing || isConsuming || !descriptor || Boolean(errorKey)}
          className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          onClick={onSend}
        >
          {i18nService.t('enterpriseKnowledgeExtractionAuthorizationSend')}
        </button>
      </div>
    </div>
  </div>
);

export interface WorkspaceKnowledgeExtractionDialogProps {
  prepare: () => Promise<KnowledgeExtractionAuthorizationPreparation>;
  send: (authorizationToken: string) => Promise<void>;
  onClose: () => void;
}

const getSafeErrorKey = (caught: unknown): string =>
  getKnowledgeDocumentErrorKey(
    caught instanceof KnowledgeBaseServiceError
      ? caught.code
      : KnowledgeBaseErrorCode.PersistenceFailed,
  );

export default function WorkspaceKnowledgeExtractionDialog({
  prepare,
  send,
  onClose,
}: WorkspaceKnowledgeExtractionDialogProps): React.ReactElement {
  const [descriptor, setDescriptor] =
    useState<KnowledgeExtractionAuthorizationDescriptor | null>(null);
  const [isPreparing, setIsPreparing] = useState(true);
  const [isConsuming, setIsConsuming] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const prepareRef = useRef(prepare);
  const sendRef = useRef(send);
  const onCloseRef = useRef(onClose);
  const mountedRef = useRef(true);
  const preparationControllerRef = useRef<KnowledgeExtractionDialogPreparationController | null>(
    null,
  );
  if (!preparationControllerRef.current) {
    preparationControllerRef.current =
      createKnowledgeExtractionDialogPreparationController(prepareRef.current);
  }
  const submissionControllerRef = useRef<KnowledgeExtractionDialogSubmissionController | null>(
    null,
  );
  if (!submissionControllerRef.current) {
    submissionControllerRef.current = createKnowledgeExtractionDialogSubmissionController({
      onSend: authorizationToken => sendRef.current(authorizationToken),
      onClose: () => onCloseRef.current(),
      isMounted: () => mountedRef.current,
      onConsumingChange: nextIsConsuming => {
        if (mountedRef.current) {
          setIsConsuming(nextIsConsuming);
        }
      },
      onError: caught => {
        if (mountedRef.current) {
          setErrorKey(getSafeErrorKey(caught));
        }
      },
    });
  }
  useLayoutEffect(() => {
    sendRef.current = send;
    onCloseRef.current = onClose;
  }, [onClose, send]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );

  const close = useCallback(() => {
    submissionControllerRef.current?.cancel();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    setIsPreparing(true);
    setErrorKey(null);
    void preparationControllerRef.current
      ?.prepareOnce()
      .then(preparation => {
        if (!active || !mountedRef.current) {
          return;
        }
        submissionControllerRef.current?.authorize(preparation);
        setDescriptor(preparation.descriptor);
      })
      .catch(caught => {
        if (active && mountedRef.current) {
          submissionControllerRef.current?.clearAuthorization();
          setErrorKey(getSafeErrorKey(caught));
        }
      })
      .finally(() => {
        if (active && mountedRef.current) {
          setIsPreparing(false);
        }
      });
    return () => {
      active = false;
      mountedRef.current = false;
      submissionControllerRef.current?.clearAuthorization();
    };
  }, []);

  useEffect(() => {
    focusKnowledgeExtractionDialogInitialControl(cancelButtonRef.current);
    const opener = openerRef.current;
    return () => restoreKnowledgeExtractionDialogOpenerFocus(opener);
  }, []);

  const submit = useCallback((): void => {
    setErrorKey(null);
    void submissionControllerRef.current?.send();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const controls = dialogRef.current
        ? Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];
      handleKnowledgeExtractionDialogKeyDown(event, controls, close);
    },
    [close],
  );

  return (
    <WorkspaceKnowledgeExtractionDialogView
      descriptor={descriptor}
      isPreparing={isPreparing}
      isConsuming={isConsuming}
      errorKey={errorKey}
      onCancel={close}
      onSend={submit}
      onKeyDown={onKeyDown}
      dialogRef={dialogRef}
      cancelButtonRef={cancelButtonRef}
    />
  );
}
