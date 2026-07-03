import { readFileSync } from 'fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { i18nService } from '../../services/i18n';
import type { OpenClawEngineStatus } from '../../types/cowork';
import {
  createCompletionStatus,
  EngineStartupOverlayView,
  shouldHoldStartupOverlayForCompletion,
  STARTUP_COMPLETION_HOLD_MS,
} from './EngineStartupOverlay';

const startingStatus: OpenClawEngineStatus = {
  phase: 'starting',
  version: 'test-version',
  progressPercent: 66,
  message: 'OpenClaw gateway is starting',
  canRetry: false,
};

describe('EngineStartupOverlayView', () => {
  test('defines separate light and dark startup palettes in CSS', () => {
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

    expect(css).toContain('--engine-startup-light-bg');
    expect(css).toContain('--engine-startup-dark-bg');
    expect(css).toContain('.dark .engine-startup-overlay');
    expect(css).toContain('var(--engine-startup-light-bg)');
    expect(css).toContain('var(--engine-startup-dark-bg)');
  });

  test('renders calm startup copy without internal engine terms', () => {
    i18nService.setLanguage('zh', { persist: false });

    const html = renderToStaticMarkup(
      React.createElement(EngineStartupOverlayView, {
        status: startingStatus,
        showSlowHint: true,
      }),
    );

    expect(html).toContain('正在打开工作台');
    expect(html).toContain('准备模型、技能和本地工作空间');
    expect(html).toContain('连接工作引擎');
    expect(html).toContain('66%');
    expect(html).not.toContain('OpenClaw');
    expect(html).not.toContain('gateway');
    expect(html).not.toContain('网关');
  });

  test('uses themed startup animation classes instead of fixed accent utilities', () => {
    i18nService.setLanguage('zh', { persist: false });

    const html = renderToStaticMarkup(
      React.createElement(EngineStartupOverlayView, {
        status: startingStatus,
        showSlowHint: false,
      }),
    );

    expect(html).toContain('engine-startup-overlay');
    expect(html).toContain('engine-startup-backdrop');
    expect(html).toContain('engine-startup-logo-panel');
    expect(html).toContain('engine-startup-progress-percent');
    expect(html).not.toContain('bg-[#070D18]');
    expect(html).not.toContain('text-cyan-100');
    expect(html).not.toContain('bg-cyan-300');
    expect(html).not.toContain('border-cyan-200');
  });

  test('renders a moving indeterminate progress bar while progress is unknown', () => {
    i18nService.setLanguage('zh', { persist: false });

    const html = renderToStaticMarkup(
      React.createElement(EngineStartupOverlayView, {
        status: {
          ...startingStatus,
          progressPercent: undefined,
        },
        showSlowHint: false,
      }),
    );

    expect(html).toContain('engine-startup-progress-runner--indeterminate');
    expect(html).toContain('engine-startup-progress-activity');
    expect(html).toContain('engine-startup-logo-glow');
    expect(html).not.toContain('engine-startup-progress-fill');
    expect(html).not.toContain('%</span>');
  });

  test('keeps the progress track visibly animated while numeric progress changes slowly', () => {
    i18nService.setLanguage('zh', { persist: false });

    const html = renderToStaticMarkup(
      React.createElement(EngineStartupOverlayView, {
        status: {
          ...startingStatus,
          progressPercent: 10,
        },
        showSlowHint: false,
      }),
    );

    expect(html).toContain('10%');
    expect(html).toContain('engine-startup-progress-track--active');
    expect(html).toContain('engine-startup-progress-activity');
    expect(html).toContain('engine-startup-progress-flow');
    expect(html).toContain('engine-startup-progress-fill');
  });

  test('holds the overlay long enough to show ready progress when startup finishes quickly', () => {
    const runningStatus: OpenClawEngineStatus = {
      ...startingStatus,
      phase: 'running',
      progressPercent: 100,
    };

    expect(shouldHoldStartupOverlayForCompletion(startingStatus, runningStatus)).toBe(true);

    const completionStatus = createCompletionStatus(runningStatus);
    const html = renderToStaticMarkup(
      React.createElement(EngineStartupOverlayView, {
        status: completionStatus,
        showSlowHint: false,
      }),
    );

    expect(STARTUP_COMPLETION_HOLD_MS).toBeGreaterThanOrEqual(900);
    expect(html).toContain('工作台已就绪');
    expect(html).toContain('100%');
    expect(html).toContain('engine-startup-progress-track--complete');
    expect(html).toContain('engine-startup-progress-activity');
    expect(html).toContain('engine-startup-progress-fill');
  });
});
