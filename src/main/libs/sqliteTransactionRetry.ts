const TRANSIENT_WRITE_TRANSACTION_MAX_RETRIES = 3;
const TRANSIENT_BUSY_RETRY_BASE_DELAY_MS = 25;
const TRANSIENT_BUSY_RETRY_MAX_DELAY_MS = 250;

export type TransientSqliteBusyRetryDelay = (delayMs: number) => Promise<void>;

const defaultTransientSqliteBusyRetryDelay: TransientSqliteBusyRetryDelay = delayMs =>
  new Promise(resolve => setTimeout(resolve, delayMs));

export const isTransientSqliteBusyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_BUSY_SNAPSHOT');

export const runTransientSqliteWriteTransaction = <T>(run: () => T): T => {
  let retryCount = 0;
  while (true) {
    try {
      return run();
    } catch (error) {
      if (
        !isTransientSqliteBusyError(error) ||
        retryCount >= TRANSIENT_WRITE_TRANSACTION_MAX_RETRIES
      ) {
        throw error;
      }
      retryCount += 1;
    }
  }
};

export const runTransientSqliteWriteTransactionUntilSuccess = async <T>(
  run: () => T,
  busyRetryDelay: TransientSqliteBusyRetryDelay = defaultTransientSqliteBusyRetryDelay,
): Promise<T> => {
  let busyRetryRound = 0;
  while (true) {
    try {
      return runTransientSqliteWriteTransaction(run);
    } catch (error) {
      if (!isTransientSqliteBusyError(error)) {
        throw error;
      }
      const delayMs = Math.min(
        TRANSIENT_BUSY_RETRY_MAX_DELAY_MS,
        TRANSIENT_BUSY_RETRY_BASE_DELAY_MS * (2 ** busyRetryRound),
      );
      busyRetryRound += 1;
      await busyRetryDelay(delayMs);
    }
  }
};
