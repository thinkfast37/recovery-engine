// FIXED CONTRACT — do not modify this file.
// Your job is to make every test below pass by implementing
// `saga-orchestrator.ts`. Do not change test expectations, do not change
// saga-types.ts, do not change in-memory-saga-store.ts.
//
// Scenario: a simplified 4-step payment saga.
//   1. BalanceCheck  — read-only, no compensation
//   2. FraudCheck    — read-only, no compensation
//   3. DebitAccount  — side-effecting, compensatable (reversal), and the
//                      step where the dual-write / in-doubt scenario is tested
//   4. SubmitToNetwork — side-effecting, compensatable (cancel)

import { SagaOrchestrator } from './saga-orchestrator';
import { InMemorySagaStore } from './in-memory-saga-store';
import { StepDefinition, SagaContext, StepResult } from './saga-types';

function makeStep(
  stepId: string,
  opts: {
    execute: jest.Mock<Promise<StepResult>, [SagaContext]>;
    compensate?: jest.Mock<Promise<void>, [SagaContext]>;
  }
): StepDefinition {
  return {
    stepId,
    execute: opts.execute,
    compensate: opts.compensate,
  };
}

describe('SagaOrchestrator', () => {
  const SAGA_ID = 'saga-payment-001';

  it('happy path: runs all steps in order and marks the saga COMPLETED', async () => {
    const store = new InMemorySagaStore();

    const balanceCheck = makeStep('BalanceCheck', {
      execute: jest.fn().mockResolvedValue({ output: { balanceOk: true } }),
    });
    const fraudCheck = makeStep('FraudCheck', {
      execute: jest.fn().mockResolvedValue({ output: { fraudOk: true } }),
    });
    const debitAccount = makeStep('DebitAccount', {
      execute: jest.fn().mockResolvedValue({ output: { debitId: 'd-1' } }),
      compensate: jest.fn().mockResolvedValue(undefined),
    });
    const submitToNetwork = makeStep('SubmitToNetwork', {
      execute: jest.fn().mockResolvedValue({ output: { netRef: 'n-1' } }),
      compensate: jest.fn().mockResolvedValue(undefined),
    });

    const steps = [balanceCheck, fraudCheck, debitAccount, submitToNetwork];
    const orchestrator = new SagaOrchestrator(steps, store);

    const result = await orchestrator.run(SAGA_ID, { amount: 100 });

    expect(result.sagaStatus).toBe('COMPLETED');
    expect(result.outputs['DebitAccount']).toEqual({ debitId: 'd-1' });
    expect(balanceCheck.execute).toHaveBeenCalledTimes(1);
    expect(fraudCheck.execute).toHaveBeenCalledTimes(1);
    expect(debitAccount.execute).toHaveBeenCalledTimes(1);
    expect(submitToNetwork.execute).toHaveBeenCalledTimes(1);

    const finalState = await store.load(SAGA_ID);
    expect(finalState?.sagaStatus).toBe('COMPLETED');
    expect(finalState?.checkpoints.map((c) => c.status)).toEqual([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
    ]);
  });

  it('a step failure triggers compensation of completed steps in reverse order, and steps with no compensate() are skipped', async () => {
    const store = new InMemorySagaStore();
    const callOrder: string[] = [];

    const balanceCheck = makeStep('BalanceCheck', {
      execute: jest.fn().mockImplementation(async () => {
        callOrder.push('BalanceCheck.execute');
        return { output: {} };
      }),
      // no compensate — read-only step
    });
    const fraudCheck = makeStep('FraudCheck', {
      execute: jest.fn().mockImplementation(async () => {
        callOrder.push('FraudCheck.execute');
        return { output: {} };
      }),
      // no compensate — read-only step
    });
    const debitAccount = makeStep('DebitAccount', {
      execute: jest.fn().mockImplementation(async () => {
        callOrder.push('DebitAccount.execute');
        return { output: { debitId: 'd-1' } };
      }),
      compensate: jest.fn().mockImplementation(async () => {
        callOrder.push('DebitAccount.compensate');
      }),
    });
    const submitToNetwork = makeStep('SubmitToNetwork', {
      execute: jest.fn().mockImplementation(async () => {
        callOrder.push('SubmitToNetwork.execute');
        throw new Error('network rejected submission');
      }),
      compensate: jest.fn().mockResolvedValue(undefined),
    });

    const steps = [balanceCheck, fraudCheck, debitAccount, submitToNetwork];
    const orchestrator = new SagaOrchestrator(steps, store);

    const result = await orchestrator.run(SAGA_ID, { amount: 100 });

    expect(result.sagaStatus).toBe('COMPENSATED');
    expect(result.failedStepId).toBe('SubmitToNetwork');

    // Only DebitAccount had a compensate() and had actually completed.
    expect(debitAccount.compensate).toHaveBeenCalledTimes(1);
    expect(submitToNetwork.compensate).not.toHaveBeenCalled();

    // DebitAccount must be compensated before the saga is marked COMPENSATED.
    expect(callOrder.indexOf('DebitAccount.compensate')).toBeGreaterThan(
      callOrder.indexOf('SubmitToNetwork.execute')
    );

    const finalState = await store.load(SAGA_ID);
    expect(finalState?.sagaStatus).toBe('COMPENSATED');
  });

  it('resumes an in-progress saga without re-executing already-completed steps', async () => {
    const store = new InMemorySagaStore();

    // Pre-seed: BalanceCheck and FraudCheck already COMPLETED from a prior
    // (crashed) run. DebitAccount and SubmitToNetwork have not started.
    store.seed({
      sagaId: SAGA_ID,
      sagaStatus: 'IN_PROGRESS',
      checkpoints: [
        { stepId: 'BalanceCheck', status: 'COMPLETED', output: { balanceOk: true } },
        { stepId: 'FraudCheck', status: 'COMPLETED', output: { fraudOk: true } },
      ],
    });

    const balanceCheck = makeStep('BalanceCheck', {
      execute: jest.fn().mockResolvedValue({ output: { balanceOk: true } }),
    });
    const fraudCheck = makeStep('FraudCheck', {
      execute: jest.fn().mockResolvedValue({ output: { fraudOk: true } }),
    });
    const debitAccount = makeStep('DebitAccount', {
      execute: jest.fn().mockResolvedValue({ output: { debitId: 'd-1' } }),
      compensate: jest.fn().mockResolvedValue(undefined),
    });
    const submitToNetwork = makeStep('SubmitToNetwork', {
      execute: jest.fn().mockResolvedValue({ output: { netRef: 'n-1' } }),
      compensate: jest.fn().mockResolvedValue(undefined),
    });

    const steps = [balanceCheck, fraudCheck, debitAccount, submitToNetwork];
    const orchestrator = new SagaOrchestrator(steps, store);

    const result = await orchestrator.run(SAGA_ID, { amount: 100 });

    expect(result.sagaStatus).toBe('COMPLETED');
    expect(balanceCheck.execute).not.toHaveBeenCalled();
    expect(fraudCheck.execute).not.toHaveBeenCalled();
    expect(debitAccount.execute).toHaveBeenCalledTimes(1);
    expect(submitToNetwork.execute).toHaveBeenCalledTimes(1);
  });

  it('dual-write scenario: a dangling PENDING checkpoint causes an idempotent re-invocation, not a silent skip and not a duplicate side effect', async () => {
    const store = new InMemorySagaStore();

    // Pre-seed: DebitAccount was called last run and the downstream ledger
    // WAS actually debited, but the process crashed before the COMPLETED
    // checkpoint could be written — so the store still shows PENDING.
    // This models the exact gap: "I call the account ledger API but then
    // fail when calling the saga store to add the DEBITED step."
    store.seed({
      sagaId: SAGA_ID,
      sagaStatus: 'IN_PROGRESS',
      checkpoints: [
        { stepId: 'BalanceCheck', status: 'COMPLETED', output: { balanceOk: true } },
        { stepId: 'FraudCheck', status: 'COMPLETED', output: { fraudOk: true } },
        { stepId: 'DebitAccount', status: 'PENDING' },
      ],
    });

    // Simulates a real idempotent downstream ledger: keyed by sagaId+stepId,
    // a second call with the same key returns the same result instead of
    // moving money again.
    const ledger = new Map<string, { debitId: string; calls: number }>();
    const debitExecute = jest.fn().mockImplementation(async (context: SagaContext) => {
      const key = `${context.sagaId}:DebitAccount`;
      const existing = ledger.get(key);
      if (existing) {
        existing.calls += 1;
        return { output: { debitId: existing.debitId } };
      }
      ledger.set(key, { debitId: 'd-1', calls: 1 });
      return { output: { debitId: 'd-1' } };
    });

    const balanceCheck = makeStep('BalanceCheck', {
      execute: jest.fn().mockResolvedValue({ output: { balanceOk: true } }),
    });
    const fraudCheck = makeStep('FraudCheck', {
      execute: jest.fn().mockResolvedValue({ output: { fraudOk: true } }),
    });
    const debitAccount = makeStep('DebitAccount', {
      execute: debitExecute,
      compensate: jest.fn().mockResolvedValue(undefined),
    });
    const submitToNetwork = makeStep('SubmitToNetwork', {
      execute: jest.fn().mockResolvedValue({ output: { netRef: 'n-1' } }),
      compensate: jest.fn().mockResolvedValue(undefined),
    });

    const steps = [balanceCheck, fraudCheck, debitAccount, submitToNetwork];
    const orchestrator = new SagaOrchestrator(steps, store);

    const result = await orchestrator.run(SAGA_ID, { amount: 100 });

    // The orchestrator must NOT trust the dangling PENDING as "done" and
    // skip it outright — it must re-invoke execute() so the downstream
    // idempotency key can resolve the in-doubt state.
    expect(debitExecute).toHaveBeenCalledTimes(1);

    // The re-invocation must resolve to exactly one ledger entry — i.e. the
    // downstream side effect was not duplicated — verified via the ledger
    // fake's own call count for that key.
    const ledgerEntry = ledger.get(`${SAGA_ID}:DebitAccount`);
    expect(ledgerEntry?.calls).toBe(1);

    expect(result.sagaStatus).toBe('COMPLETED');
    expect(result.outputs['DebitAccount']).toEqual({ debitId: 'd-1' });

    const finalState = await store.load(SAGA_ID);
    const debitCheckpoint = finalState?.checkpoints.find((c) => c.stepId === 'DebitAccount');
    expect(debitCheckpoint?.status).toBe('COMPLETED');
    expect(debitCheckpoint?.output).toEqual({ debitId: 'd-1' });
  });

  it('writes a PENDING checkpoint before calling execute(), not only after', async () => {
    const store = new InMemorySagaStore();
    const writeCheckpointSpy = jest.spyOn(store, 'writeCheckpoint');

    const balanceCheck = makeStep('BalanceCheck', {
      execute: jest.fn().mockImplementation(async () => {
        // At the moment execute() is invoked, a PENDING checkpoint for this
        // step must already have been persisted (write-ahead intent).
        const state = await store.load(SAGA_ID);
        const cp = state?.checkpoints.find((c) => c.stepId === 'BalanceCheck');
        expect(cp?.status).toBe('PENDING');
        return { output: { balanceOk: true } };
      }),
    });

    const steps = [balanceCheck];
    const orchestrator = new SagaOrchestrator(steps, store);

    await orchestrator.run(SAGA_ID, { amount: 100 });

    expect(writeCheckpointSpy).toHaveBeenCalledWith(
      SAGA_ID,
      expect.objectContaining({ stepId: 'BalanceCheck', status: 'PENDING' })
    );
    expect(writeCheckpointSpy).toHaveBeenCalledWith(
      SAGA_ID,
      expect.objectContaining({ stepId: 'BalanceCheck', status: 'COMPLETED' })
    );
  });
});