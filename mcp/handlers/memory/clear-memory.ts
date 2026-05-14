import type { RegisterMemoryToolsDeps } from "../register-memory-tools.js";
import { defineSaga } from "../../core/ports/saga.js";
import { runSaga } from "../../infrastructure/workflow/saga-runner.js";

export function defineClearMemoryTool(deps: RegisterMemoryToolsDeps): void {
  const { govTool, clearMemory, listMemory, addMemory } = deps;

  govTool(
    "clear_memory",
    {
      title: "メモリクリア",
      description: "メモリ内容をすべてクリアします。",
      inputSchema: {}
    },
    async () => {
      const snapshot = await listMemory();
      let restoredItems = 0;

      const saga = defineSaga({
        name: "clear_memory",
        steps: [
          {
            name: "clear-memory-store",
            do: async () => {
              await clearMemory();
            },
            undo: async () => {
              for (const item of snapshot) {
                await addMemory(item);
                restoredItems += 1;
              }
            }
          }
        ]
      });

      const sagaResult = await runSaga({
        saga,
        context: {}
      });

      const sagaEnvelope: Record<string, unknown> = {
        saga: {
          status: sagaResult.status,
          completedSteps: sagaResult.completedSteps,
          compensatedSteps: sagaResult.compensatedSteps,
          compensationFailures: sagaResult.compensationFailures.map((failure) => ({
            step: failure.step,
            error: String(failure.error)
          }))
        },
        snapshotItems: snapshot.length,
        restoredItems
      };

      if (sagaResult.failure) {
        sagaEnvelope.error = {
          step: sagaResult.failure.step,
          message: String(sagaResult.failure.error)
        };
      }

      return {
        content: [
          { type: "text", text: "Memory cleared." },
          { type: "text", text: JSON.stringify(sagaEnvelope, null, 2) }
        ]
      };
    }
  );
}
