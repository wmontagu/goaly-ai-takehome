import { SAFE_UNDERSTANDING, type Understanding } from "@/lib/sop/understanding";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

/** Builds an Understanding from SAFE defaults plus overrides. */
export function u(over: DeepPartial<Understanding> = {}): Understanding {
  return {
    ...SAFE_UNDERSTANDING,
    ...over,
    identity: { ...SAFE_UNDERSTANDING.identity, ...over.identity },
    case_hints: { ...SAFE_UNDERSTANDING.case_hints, ...over.case_hints },
  } as Understanding;
}
