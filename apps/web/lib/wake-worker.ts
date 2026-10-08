import { resumeHook } from 'workflow/api';
import { HookNotFoundError } from 'workflow/errors';
import { RECONCILIATION_HOOK } from '../workflows/reconciliation';

export async function wakeExistingWorker() {
  try {
    await resumeHook(RECONCILIATION_HOOK, true);
    return true;
  } catch (error) {
    if (HookNotFoundError.is(error)) return false;
    throw error;
  }
}
