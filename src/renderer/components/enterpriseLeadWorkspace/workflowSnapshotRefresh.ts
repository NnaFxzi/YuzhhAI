export interface WorkflowSnapshotRefreshGate {
  nextGeneration: () => number;
  isCurrentGeneration: (generation: number) => boolean;
}

export const createWorkflowSnapshotRefreshGate = (): WorkflowSnapshotRefreshGate => {
  let latestGeneration = 0;
  return {
    nextGeneration: () => {
      latestGeneration += 1;
      return latestGeneration;
    },
    isCurrentGeneration: generation => generation === latestGeneration,
  };
};
