import React, { useEffect, useState } from 'react';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import type { OpenClawEngineStatus } from '../../types/cowork';

const SLOW_HINT_AFTER_MS = 15000;
export const STARTUP_COMPLETION_HOLD_MS = 1000;

const resolveEngineStatusText = (status: OpenClawEngineStatus): string => {
  switch (status.phase) {
    case 'not_installed':
      return i18nService.t('coworkOpenClawNotInstalledNotice');
    case 'installing':
      return i18nService.t('coworkOpenClawInstalling');
    case 'ready':
      return i18nService.t('coworkOpenClawReadyNotice');
    case 'starting':
      return i18nService.t('coworkOpenClawStarting');
    case 'error':
      return i18nService.t('coworkOpenClawError');
    case 'running':
    default:
      return i18nService.t('coworkOpenClawRunning');
  }
};

const resolveEngineStatusLabel = (status: OpenClawEngineStatus): string => {
  if (status.phase === 'starting' && status.progressPercent === 100) {
    return i18nService.t('engineStartingStatusReady');
  }

  if (status.phase === 'starting') {
    return i18nService.t('engineStartingStatusConnecting');
  }

  return resolveEngineStatusText(status);
};

export function shouldHoldStartupOverlayForCompletion(
  previousStatus: OpenClawEngineStatus | null,
  nextStatus: OpenClawEngineStatus,
): boolean {
  return previousStatus?.phase === 'starting' && nextStatus.phase === 'running';
}

export function createCompletionStatus(status: OpenClawEngineStatus): OpenClawEngineStatus {
  return {
    ...status,
    phase: 'starting',
    progressPercent: 100,
  };
}

interface EngineStartupOverlayViewProps {
  status: OpenClawEngineStatus;
  showSlowHint: boolean;
}

export const EngineStartupOverlayView: React.FC<EngineStartupOverlayViewProps> = ({
  status,
  showSlowHint,
}) => {
  const progressPercent = typeof status.progressPercent === 'number'
    ? Math.max(0, Math.min(100, Math.round(status.progressPercent)))
    : null;
  const hasProgressPercent = progressPercent !== null;
  const isComplete = progressPercent === 100;
  const progressWidth = hasProgressPercent ? `${Math.max(progressPercent, 4)}%` : undefined;

  return (
    <div className="engine-startup-overlay fixed inset-0 z-[100] flex items-center justify-center overflow-hidden animate-fade-in">
      <div
        className="engine-startup-backdrop absolute inset-0"
        aria-hidden="true"
      />
      <div
        className="engine-startup-frame absolute inset-5 rounded-2xl sm:inset-8 sm:rounded-[24px]"
        aria-hidden="true"
      />

      <div className="relative z-10 flex w-full max-w-[430px] flex-col items-center px-6 text-center" role="status" aria-live="polite">
        <div className="relative">
          <div className="engine-startup-logo-glow absolute -inset-5 rounded-[30px] blur-2xl" aria-hidden="true" />
          <div className="engine-startup-logo-panel relative flex h-[78px] w-[78px] items-center justify-center rounded-[22px]">
            <img
              src="logo.png"
              alt={i18nService.t('appName')}
              width={44}
              height={44}
              className="select-none rounded-xl"
              draggable={false}
            />
          </div>
        </div>

        <h1 className="engine-startup-title mt-7 text-[26px] font-semibold leading-8 tracking-normal">
          {i18nService.t('engineStartingTitle')}
        </h1>
        <p className="engine-startup-subtitle mt-2 text-sm leading-6">
          {i18nService.t('engineStartingSubtitle')}
        </p>

        <div className="mt-9 w-full max-w-[300px]">
          <div className="mb-2 flex min-h-[18px] items-center justify-between gap-4 text-xs">
            <span className="engine-startup-status-label truncate">{resolveEngineStatusLabel(status)}</span>
            {progressPercent !== null && (
              <span className="engine-startup-progress-percent shrink-0 tabular-nums">{progressPercent}%</span>
            )}
          </div>
          <div
            className={`engine-startup-progress-track h-2 ${
              isComplete
                ? 'engine-startup-progress-track--complete'
                : 'engine-startup-progress-track--active'
            }`}
          >
            <div className="relative h-full overflow-hidden">
              <span className="engine-startup-progress-activity" aria-hidden="true" />
              {hasProgressPercent ? (
                <div
                  className="engine-startup-progress-fill"
                  style={{ width: progressWidth }}
                >
                  <span className="engine-startup-progress-flow" aria-hidden="true" />
                </div>
              ) : (
                <div
                  className="engine-startup-progress-runner engine-startup-progress-runner--indeterminate"
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        </div>

        <div className="mt-7 min-h-[58px] w-full max-w-[330px]">
          <div
            className={`engine-startup-slow-hint rounded-xl px-4 py-3 text-left transition-opacity duration-500 ${
              showSlowHint ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <p className="engine-startup-slow-hint-title text-xs font-medium leading-5">
              {i18nService.t('engineStartingSlowHintTitle')}
            </p>
            <p className="engine-startup-slow-hint-body mt-0.5 text-xs leading-5">
              {i18nService.t('engineStartingSlowHint')}
            </p>
          </div>
        </div>
      </div>

      <div className="engine-startup-footer absolute bottom-6 left-0 right-0 text-center text-xs">
        {i18nService.t('appName')}
      </div>
    </div>
  );
};

/**
 * Global overlay shown when the OpenClaw gateway is starting up.
 * Renders on top of all views (cowork, skills, scheduled tasks, mcp).
 * Presents a restrained brand startup screen while the local work engine connects.
 */
const EngineStartupOverlay: React.FC = () => {
  const [status, setStatus] = useState<OpenClawEngineStatus | null>(null);
  const [displayStatus, setDisplayStatus] = useState<OpenClawEngineStatus | null>(null);
  const [showSlowHint, setShowSlowHint] = useState(false);

  useEffect(() => {
    coworkService.getOpenClawEngineStatus().then((s) => {
      if (s) setStatus(s);
    });

    const unsubscribe = coworkService.onOpenClawEngineStatus((s) => {
      setStatus(s);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!status) {
      setDisplayStatus(null);
      return;
    }

    if (status.phase === 'starting') {
      setDisplayStatus(status);
      return;
    }

    let completionTimer: ReturnType<typeof setTimeout> | null = null;
    setDisplayStatus((current) => {
      if (shouldHoldStartupOverlayForCompletion(current, status)) {
        completionTimer = setTimeout(() => {
          setDisplayStatus(null);
        }, STARTUP_COMPLETION_HOLD_MS);
        return createCompletionStatus(status);
      }
      return null;
    });

    return () => {
      if (completionTimer) {
        clearTimeout(completionTimer);
      }
    };
  }, [status]);

  const isStarting = displayStatus?.phase === 'starting';

  useEffect(() => {
    if (!isStarting) {
      setShowSlowHint(false);
      return;
    }

    const slowHintTimer = setTimeout(() => {
      setShowSlowHint(true);
    }, SLOW_HINT_AFTER_MS);

    return () => {
      clearTimeout(slowHintTimer);
    };
  }, [isStarting]);

  if (!displayStatus || !isStarting) {
    return null;
  }

  return <EngineStartupOverlayView status={displayStatus} showSlowHint={showSlowHint} />;
};

export default EngineStartupOverlay;
