import {
  ArrowRightIcon,
  DocumentTextIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import React from 'react';

import { i18nService } from '../../services/i18n';
import type { LocalizedPrompt, LocalizedQuickAction } from '../../types/quickAction';
import AcademicCapIcon from '../icons/AcademicCapIcon';
import ChartBarIcon from '../icons/ChartBarIcon';
import DevicePhoneMobileIcon from '../icons/DevicePhoneMobileIcon';
import GlobeAltIcon from '../icons/GlobeAltIcon';
import PresentationChartBarIcon from '../icons/PresentationChartBarIcon';
import {
  getFeaturedWorkflowPrompts,
  getWorkflowOutputLabel,
} from './workbenchDisplay';

interface WorkbenchWorkflowGridProps {
  actions: LocalizedQuickAction[];
  onPromptSelect: (actionId: string, prompt: LocalizedPrompt) => void;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  PresentationChartBarIcon,
  GlobeAltIcon,
  DevicePhoneMobileIcon,
  ChartBarIcon,
  AcademicCapIcon,
};

const accentStyles = [
  {
    name: 'blue',
    card: 'hover:border-blue-200 hover:bg-blue-50/35 dark:hover:border-blue-400/25 dark:hover:bg-blue-500/[0.06]',
    icon: 'border-blue-100 bg-blue-50 text-blue-600 dark:border-blue-400/15 dark:bg-blue-500/10 dark:text-blue-300',
    label: 'bg-blue-50 text-blue-600 ring-1 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-400/15',
    arrow: 'text-blue-500 dark:text-blue-300',
  },
  {
    name: 'amber',
    card: 'hover:border-amber-200 hover:bg-amber-50/35 dark:hover:border-amber-400/25 dark:hover:bg-amber-500/[0.06]',
    icon: 'border-amber-100 bg-amber-50 text-amber-600 dark:border-amber-400/15 dark:bg-amber-500/10 dark:text-amber-300',
    label: 'bg-amber-50 text-amber-600 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/15',
    arrow: 'text-amber-500 dark:text-amber-300',
  },
  {
    name: 'cyan',
    card: 'hover:border-cyan-200 hover:bg-cyan-50/35 dark:hover:border-cyan-400/25 dark:hover:bg-cyan-500/[0.06]',
    icon: 'border-cyan-100 bg-cyan-50 text-cyan-600 dark:border-cyan-400/15 dark:bg-cyan-500/10 dark:text-cyan-300',
    label: 'bg-cyan-50 text-cyan-600 ring-1 ring-cyan-100 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-400/15',
    arrow: 'text-cyan-500 dark:text-cyan-300',
  },
  {
    name: 'violet',
    card: 'hover:border-violet-200 hover:bg-violet-50/35 dark:hover:border-violet-400/25 dark:hover:bg-violet-500/[0.06]',
    icon: 'border-violet-100 bg-violet-50 text-violet-600 dark:border-violet-400/15 dark:bg-violet-500/10 dark:text-violet-300',
    label: 'bg-violet-50 text-violet-600 ring-1 ring-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/15',
    arrow: 'text-violet-500 dark:text-violet-300',
  },
];

const WorkbenchWorkflowGrid: React.FC<WorkbenchWorkflowGridProps> = ({
  actions,
  onPromptSelect,
}) => {
  const featuredPrompts = getFeaturedWorkflowPrompts(actions, 4);

  if (featuredPrompts.length === 0) {
    return null;
  }

  return (
    <section className="w-full" data-layout="aligned-template-list">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">
            {i18nService.t('workbenchCommonTasks')}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            {i18nService.t('workbenchCommonTasksHint')}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {featuredPrompts.map((item, index) => {
          const IconComponent = iconMap[item.actionIcon] ?? DocumentTextIcon;
          const accentStyle = accentStyles[index % accentStyles.length];

          return (
            <button
              key={`${item.actionId}:${item.prompt.id}`}
              type="button"
              data-accent={accentStyle.name}
              className={`group rounded-lg border border-border-subtle bg-white px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-subtle dark:bg-surface/80 ${accentStyle.card}`}
              onClick={() => onPromptSelect(item.actionId, item.prompt)}
            >
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${accentStyle.icon}`}>
                  <IconComponent className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {item.prompt.label}
                    </span>
                    <span className={`shrink-0 rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium ${accentStyle.label}`}>
                      {item.actionLabel}
                    </span>
                  </div>
                  {item.prompt.description && (
                    <p className="mt-1.5 line-clamp-1 text-xs leading-5 text-secondary">
                      {item.prompt.description}
                    </p>
                  )}
                  {item.prompt.workflow?.outputTypes && item.prompt.workflow.outputTypes.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.prompt.workflow.outputTypes.slice(0, 2).map((outputType) => (
                        <span
                          key={outputType}
                          className="inline-flex items-center gap-1 rounded-[4px] bg-background/55 px-1.5 py-0.5 text-[11px] font-medium text-secondary"
                        >
                          <SparklesIcon className="h-3 w-3" />
                          {getWorkflowOutputLabel(outputType)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <ArrowRightIcon className={`mt-1 h-4 w-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-70 ${accentStyle.arrow}`} />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default WorkbenchWorkflowGrid;
