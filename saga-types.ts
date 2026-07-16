// FIXED CONTRACT — do not modify.
// The orchestrator implementation must satisfy these interfaces exactly.

export type StepStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export type SagaStatus =
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'COMPENSATING'
  | 'COMPENSATED'
  | 'FAILED';

export interface StepResult {
  output?: Record<string, unknown>;
}

export interface SagaContext {
  sagaId: string;
  input: Record<string, unknown>;
  // Outputs accumulated from previously completed steps, keyed by stepId.
  // A step's execute()/compensate() can read prior steps' outputs from here.
  outputs: Record<string, Record<string, unknown> | undefined>;
}

export interface StepDefinition {
  stepId: string;

  // Must be idempotent: the orchestrator may call execute() more than once
  // for the same sagaId+stepId (e.g. after a crash between the downstream
  // call succeeding and the checkpoint write landing). Implementations are
  // responsible for deriving a deterministic idempotency key from
  // `${context.sagaId}:${this.stepId}` and using it against the downstream
  // system so a re-call does not duplicate the side effect.
  execute(context: SagaContext): Promise<StepResult>;

  // Optional. Only called for steps that previously reached COMPLETED,
  // in reverse step order, when a later step fails.
  compensate?(context: SagaContext): Promise<void>;
}

export interface StepCheckpoint {
  stepId: string;
  status: StepStatus;
  output?: Record<string, unknown>;
}

export interface SagaState {
  sagaId: string;
  checkpoints: StepCheckpoint[];
  sagaStatus: SagaStatus;
}

export interface SagaStore {
  // Returns null if no saga has been started yet for this id.
  load(sagaId: string): Promise<SagaState | null>;

  // Creates a fresh IN_PROGRESS saga with no checkpoints.
  // Must be safe to call even if a saga already exists (return existing state).
  init(sagaId: string): Promise<SagaState>;

  // Upserts a single step's checkpoint (by stepId) into the saga's state.
  writeCheckpoint(sagaId: string, checkpoint: StepCheckpoint): Promise<void>;

  updateSagaStatus(sagaId: string, status: SagaStatus): Promise<void>;
}

export interface SagaRunResult {
  sagaStatus: SagaStatus;
  outputs: Record<string, Record<string, unknown> | undefined>;
  // Populated when sagaStatus is FAILED or COMPENSATED.
  failedStepId?: string;
  error?: unknown;
}
