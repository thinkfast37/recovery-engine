// FIXED TEST FIXTURE — do not modify.
// A real (non-mocked) in-memory implementation of SagaStore, so tests can
// assert actual persisted state across multiple orchestrator.run() calls
// rather than just counting mock invocations.

import { SagaState, SagaStatus, StepCheckpoint, SagaStore } from './saga-types';

export class InMemorySagaStore implements SagaStore {
  private sagas = new Map<string, SagaState>();

  async load(sagaId: string): Promise<SagaState | null> {
    const state = this.sagas.get(sagaId);
    return state ? this.clone(state) : null;
  }

  async init(sagaId: string): Promise<SagaState> {
    const existing = this.sagas.get(sagaId);
    if (existing) return this.clone(existing);

    const fresh: SagaState = {
      sagaId,
      checkpoints: [],
      sagaStatus: 'IN_PROGRESS',
    };
    this.sagas.set(sagaId, fresh);
    return this.clone(fresh);
  }

  async writeCheckpoint(sagaId: string, checkpoint: StepCheckpoint): Promise<void> {
    const state = this.sagas.get(sagaId);
    if (!state) {
      throw new Error(`writeCheckpoint called before init for saga ${sagaId}`);
    }
    const idx = state.checkpoints.findIndex((c) => c.stepId === checkpoint.stepId);
    if (idx >= 0) {
      state.checkpoints[idx] = { ...checkpoint };
    } else {
      state.checkpoints.push({ ...checkpoint });
    }
  }

  async updateSagaStatus(sagaId: string, status: SagaStatus): Promise<void> {
    const state = this.sagas.get(sagaId);
    if (!state) {
      throw new Error(`updateSagaStatus called before init for saga ${sagaId}`);
    }
    state.sagaStatus = status;
  }

  // Test-only helper: lets a test pre-seed a saga's state directly,
  // e.g. to simulate a crash recovery scenario.
  seed(state: SagaState): void {
    this.sagas.set(state.sagaId, this.clone(state));
  }

  private clone(state: SagaState): SagaState {
    return {
      sagaId: state.sagaId,
      sagaStatus: state.sagaStatus,
      checkpoints: state.checkpoints.map((c) => ({ ...c })),
    };
  }
}
