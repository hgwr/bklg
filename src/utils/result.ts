export type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = <T>(error: Error): Result<T> => ({ ok: false, error });

export const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
};
