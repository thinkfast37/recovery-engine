import {
  StepDefinition,
  SagaContext,
  StepResult,
  SagaStore,
  SagaStatus,
  SagaRunResult,
  StepCheckpoint,
} from './saga-types';

export class SagaOrchestrator {
  private steps: StepDefinition[];
  private store: SagaStore;

  constructor(steps: StepDefinition[], store: SagaStore) {
    this.steps = steps;
    this.store = store;
  }

  async run(sagaId: string, input: Record<string, unknown>): Promise<SagaRunResult> {
    const state = await this.store.init(sagaId);
    const context: SagaContext = {
      sagaId,
      input,
      outputs: {},
    };

    // Populate initial outputs from already completed steps
    for (const checkpoint of state.checkpoints) {
      if (checkpoint.status === 'COMPLETED') {
        context.outputs[checkpoint.stepId] = checkpoint.output;
      }
    }

    for (const step of this.steps) {
      const checkpoint = state.checkpoints.find((c) => c.stepId === step.stepId);

      if (checkpoint && checkpoint.status === 'COMPLETED') {
        continue;
      }

      try {
        await this.store.writeCheckpoint(sagaId, {
          stepId: step.stepId,
          status: 'PENDING',
        });

        const result = await step.execute(context);

        if (result.output) {
          context.outputs[step.stepId] = result.output;
        }

        await this.store.writeCheckpoint(sagaId, {
          stepId: step.stepId,
          status: 'COMPLETED',
          output: result.output,
        });

        // Update the local state to reflect completion for subsequent steps and compensation
        state.checkpoints = state.checkpoints.map((c) =>
          c.stepId === step.stepId ? { ...c, status: 'COMPLETED', output: result.output } : c
        );
      } catch (error) {
        await this.store.writeCheckpoint(sagaId, {
          stepId: step.stepId,
          status: 'FAILED',
        });

        // Fetch the absolute latest state from store to ensure we have all completed steps
        const currentState = await this.store.load(sagaId);
        if (currentState) {
          const compensationResult = await this.compensate(sagaId, currentState.checkpoints, context);

          if (compensationResult.success) {
            await this.store.updateSagaStatus(sagaId, 'COMPENSATED');
            return {
              sagaStatus: 'COMPENSATED' as SagaStatus,
              outputs: context.outputs,
              failedStepId: step.stepId,
              error,
              compensationErrors: compensationResult.errors,
            };
          } else {
            await this.store.updateSagaStatus(sagaId, 'FAILED');
            return {
              sagaStatus: 'FAILED' as SagaStatus,
              outputs: context.outputs,
              failedStepId: step.stepId,
              error,
              compensationErrors: compensationResult.errors,
            };
          }
        } else {
          await this.store.updateSagaStatus(sagaId, 'COMPENSATED');
          return {
            sagaStatus: 'COMPENSATED' as SagaStatus,
            outputs: context.outputs,
            failedStepId: step.stepId,
            error,
          };
        }
      }
    }

    await this.store.updateSagaStatus(sagaId, 'COMPLETED');
    return {
      sagaStatus: 'COMPLETED' as SagaStatus,
      outputs: context.outputs,
    };
  }

  private async compensate(
    sagaId: string,
    checkpoints: StepCheckpoint[],
    context: SagaContext
  ): Promise<{ success: boolean; errors: { stepId: string; error: Error }[] }> {
    const errors: { stepId: string; error: Error }[] = [];
    const completed = checkpoints
      .filter((c) => c.status === 'COMPLETED')
      .reverse();

    for (const checkpoint of completed) {
      const stepDefinition = this.steps.find((s) => s.stepId === checkpoint.stepId);
      if (stepDefinition && typeof stepDefinition.compensate === 'function') {
        try {
          await stepDefinition.compensate(context);
        } catch (e) {
          errors.push({ stepId: checkpoint.stepId, error: e as Error });
        }
      }
    }

    return {
      success: errors.length === 0,
      errors
    };
  }
}
