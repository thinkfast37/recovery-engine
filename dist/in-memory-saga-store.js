"use strict";
// FIXED TEST FIXTURE — do not modify.
// A real (non-mocked) in-memory implementation of SagaStore, so tests can
// assert actual persisted state across multiple orchestrator.run() calls
// rather than just counting mock invocations.
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemorySagaStore = void 0;
class InMemorySagaStore {
    sagas = new Map();
    async load(sagaId) {
        const state = this.sagas.get(sagaId);
        return state ? this.clone(state) : null;
    }
    async init(sagaId) {
        const existing = this.sagas.get(sagaId);
        if (existing)
            return this.clone(existing);
        const fresh = {
            sagaId,
            checkpoints: [],
            sagaStatus: 'IN_PROGRESS',
        };
        this.sagas.set(sagaId, fresh);
        return this.clone(fresh);
    }
    async writeCheckpoint(sagaId, checkpoint) {
        const state = this.sagas.get(sagaId);
        if (!state) {
            throw new Error(`writeCheckpoint called before init for saga ${sagaId}`);
        }
        const idx = state.checkpoints.findIndex((c) => c.stepId === checkpoint.stepId);
        if (idx >= 0) {
            state.checkpoints[idx] = { ...checkpoint };
        }
        else {
            state.checkpoints.push({ ...checkpoint });
        }
    }
    async updateSagaStatus(sagaId, status) {
        const state = this.sagas.get(sagaId);
        if (!state) {
            throw new Error(`updateSagaStatus called before init for saga ${sagaId}`);
        }
        state.sagaStatus = status;
    }
    // Test-only helper: lets a test pre-seed a saga's state directly,
    // e.g. to simulate a crash recovery scenario.
    seed(state) {
        this.sagas.set(state.sagaId, this.clone(state));
    }
    clone(state) {
        return {
            sagaId: state.sagaId,
            sagaStatus: state.sagaStatus,
            checkpoints: state.checkpoints.map((c) => ({ ...c })),
        };
    }
}
exports.InMemorySagaStore = InMemorySagaStore;
