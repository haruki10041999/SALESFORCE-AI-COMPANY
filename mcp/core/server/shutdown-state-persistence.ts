import type { BanditState, saveBanditState as saveBanditStateFn } from "../learning/rl-feedback.js";
import type { GovernanceState } from "../governance/governance-state.js";

interface ShutdownStatePersistenceDeps {
  getBanditState: () => BanditState;
  banditStateFile: string;
  saveBanditState: typeof saveBanditStateFn;
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  logger: {
    info: (message: string) => void;
    warn: (message: string, error?: unknown) => void;
  };
}

export function createShutdownStatePersistence(deps: ShutdownStatePersistenceDeps) {
  let banditStatePersisted = false;
  let governanceStatePersisted = false;

  async function persistBanditStateOnce(reason: string): Promise<void> {
    if (banditStatePersisted) {
      return;
    }
    banditStatePersisted = true;
    try {
      const banditState = deps.getBanditState();
      await deps.saveBanditState(banditState, deps.banditStateFile);
      deps.logger.info(`Bandit state saved (${banditState.arms.size} arms, reason=${reason})`);
    } catch (error) {
      deps.logger.warn(`Failed to save bandit state on shutdown (reason=${reason})`, error);
    }
  }

  async function persistGovernanceStateOnce(reason: string): Promise<void> {
    if (governanceStatePersisted) {
      return;
    }
    governanceStatePersisted = true;
    try {
      const current = await deps.loadGovernanceState();
      await deps.saveGovernanceState(current);
      deps.logger.info(`Governance state saved (reason=${reason})`);
    } catch (error) {
      deps.logger.warn(`Failed to save governance state on shutdown (reason=${reason})`, error);
    }
  }

  async function persistShutdownState(reason: string): Promise<void> {
    await Promise.all([
      persistBanditStateOnce(reason),
      persistGovernanceStateOnce(reason)
    ]);
  }

  function registerShutdownHooks(): void {
    const onSignal = (signal: "SIGINT" | "SIGTERM" | "SIGHUP") => {
      process.once(signal, () => {
        void persistShutdownState(signal)
          .finally(() => process.exit(0));
      });
    };

    onSignal("SIGINT");
    onSignal("SIGTERM");
    onSignal("SIGHUP");
  }

  return {
    persistShutdownState,
    registerShutdownHooks
  };
}
