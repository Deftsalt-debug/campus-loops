// Free-tier guard rails. Google bills per request beyond monthly free caps
// (India: 70k map loads and autocomplete requests, 35k Pro and 7k Enterprise
// Places requests). Hard caps belong in Cloud Console quotas; these limits
// also stop one runaway tab from spending them.
export const SESSION_LIMITS = { suggest: 120, details: 40, nearby: 12 } as const

export class LiveLimitError extends Error {
  constructor() { super('Live Google search is paused on this page to stay within the free tier. Reload to continue.') }
}
