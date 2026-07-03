import {
  ArchiveBoxIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  InboxArrowDownIcon,
} from '@heroicons/react/24/outline';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { openArtifactPreviewTab, selectSessionArtifacts } from '../../store/slices/artifactSlice';
import type { LocalizedQuickAction } from '../../types/quickAction';
import {
  getArtifactDisplayMeta,
  getDraftMaterialName,
  getWorkflowOutputLabel,
} from './workbenchDisplay';

export interface WorkbenchSidePanelProps {
  sessionId: string | null;
  draftKey: string;
  workflows: LocalizedQuickAction[];
  onWorkflowSelect: (actionId: string) => void;
}

const sectionClassName = 'px-4 py-4';
const sectionTitleClassName = 'mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground';
const subtlePanelClassName = 'rounded-lg border border-border-subtle bg-background/50';

const WorkbenchSidePanel: React.FC<WorkbenchSidePanelProps> = ({
  sessionId,
  draftKey,
  workflows,
  onWorkflowSelect,
}) => {
  const dispatch = useDispatch();
  const artifacts = useSelector((state: RootState) => (
    sessionId ? selectSessionArtifacts(state, sessionId) : []
  ));
  const draftAttachments = useSelector((state: RootState) => (
    state.cowork.draftAttachments[draftKey] ?? []
  ));
  const scheduledTasks = useSelector((state: RootState) => state.scheduledTask.tasks);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <section className={sectionClassName}>
        <h2 className={sectionTitleClassName}>
          <InboxArrowDownIcon className="h-4 w-4 text-primary" />
          {i18nService.t('workbenchMaterialBasket')}
        </h2>
        {draftAttachments.length === 0 ? (
          <div className={`${subtlePanelClassName} border-dashed px-3 py-4 text-center`}>
            <InboxArrowDownIcon className="mx-auto h-5 w-5 text-secondary" />
            <p className="mt-2 text-xs font-medium text-foreground">
              {i18nService.t('workbenchMaterialDropTitle')}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-secondary">
              {i18nService.t('workbenchMaterialDropDescription')}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {draftAttachments.slice(0, 5).map((attachment) => (
              <div
                key={`${attachment.path}:${attachment.name}`}
                className={`${subtlePanelClassName} truncate px-2.5 py-2 text-xs text-foreground`}
              >
                {getDraftMaterialName(attachment.path || attachment.name)}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={sectionClassName}>
        <h2 className={sectionTitleClassName}>
          <ArchiveBoxIcon className="h-4 w-4 text-amber-300" />
          {i18nService.t('workbenchArtifactLibrary')}
        </h2>
        {artifacts.length === 0 ? (
          <p className="text-xs leading-5 text-secondary">{i18nService.t('workbenchArtifactsEmpty')}</p>
        ) : (
          <div className="space-y-1.5">
            {artifacts.slice(0, 6).map((artifact) => {
              const meta = getArtifactDisplayMeta(artifact);
              return (
                <button
                  key={artifact.id}
                  type="button"
                  className={`${subtlePanelClassName} w-full px-2.5 py-2 text-left transition-colors hover:bg-surface-raised`}
                  title={meta.pathLabel ?? meta.title}
                  onClick={() => {
                    if (sessionId) {
                      dispatch(openArtifactPreviewTab({ sessionId, artifactId: artifact.id }));
                    }
                  }}
                >
                  <div className="truncate text-xs font-medium text-foreground">{meta.title}</div>
                  <div className="text-[11px] text-secondary">{meta.typeLabel}</div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className={`${sectionClassName} border-t border-border-subtle`}>
        <h2 className={sectionTitleClassName}>
          <DocumentDuplicateIcon className="h-4 w-4 text-sky-300" />
          {i18nService.t('workbenchWorkflows')}
        </h2>
        <div className="space-y-1.5">
          {workflows.slice(0, 3).map((workflow) => {
            const firstOutputType = workflow.prompts[0]?.workflow?.outputTypes?.[0];
            return (
              <button
                key={workflow.id}
                type="button"
                className={`${subtlePanelClassName} w-full px-2.5 py-2 text-left text-xs text-foreground transition-colors hover:bg-surface-raised`}
                onClick={() => onWorkflowSelect(workflow.id)}
              >
                {workflow.label}
                {firstOutputType && (
                  <span className="ml-1 text-[11px] text-secondary">
                    {getWorkflowOutputLabel(firstOutputType)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className={`${sectionClassName} border-t border-border-subtle`}>
        <h2 className={sectionTitleClassName}>
          <ClockIcon className="h-4 w-4 text-fuchsia-300" />
          {i18nService.t('workbenchRecentTasks')}
        </h2>
        {scheduledTasks.length === 0 ? (
          <p className="text-xs leading-5 text-secondary">{i18nService.t('workbenchTasksEmpty')}</p>
        ) : (
          <div className="space-y-1.5">
            {scheduledTasks.slice(0, 4).map((task) => (
              <div key={task.id} className={`${subtlePanelClassName} truncate px-2.5 py-2 text-xs text-foreground`}>
                {task.name}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default WorkbenchSidePanel;
