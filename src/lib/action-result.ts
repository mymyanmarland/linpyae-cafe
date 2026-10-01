/**
 * Standard Server Action result envelope.
 * Every Server Action returns this shape — never throw to the client,
 * never return raw Prisma objects.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function okVoid(): ActionResult<void> {
  return { ok: true, data: undefined };
}

export function fail(error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/** Convert a Zod safeParse failure into an ActionResult. */
export function zodFail(err: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }): ActionResult<never> {
  const flat = err.flatten().fieldErrors;
  const fieldErrors: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(flat)) if (v) fieldErrors[k] = v;
  const first = Object.values(fieldErrors)[0]?.[0];
  return fail(first ?? "Validation failed", fieldErrors);
}
