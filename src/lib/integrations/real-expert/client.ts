// ============================================================
// HTTP calls to a Real Expert CRM workspace.
//
// The base URL is admin-supplied, so every call goes through the same
// SSRF guard as outbound webhooks and refuses redirects.
// ============================================================

import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import type { AuthStyle } from './config'

export const REQUEST_TIMEOUT_MS = 8000

export interface RealExpertTarget {
  baseUrl: string
  apiKey: string
  authStyle: AuthStyle
}

/** A failed call. `retryable` is false for errors a retry cannot fix. */
export class RealExpertError extends Error {
  readonly status: number | null
  readonly retryable: boolean
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message)
    this.name = 'RealExpertError'
    this.status = status
    this.retryable = retryable
  }
}

/** 408, 425, 429 and 5xx are worth retrying; other 4xx are not. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

export async function realExpertRequest(
  target: RealExpertTarget,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const url = `${target.baseUrl}${path}`
  if (process.env.NODE_ENV === 'production' || !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    if (!(await isDeliverableUrl(url))) {
      throw new RealExpertError('The CRM address points to a private network.', null, false)
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'WhatspertCRM/1.0',
    ...extraHeaders,
  }
  if (target.authStyle === 'x-api-key') headers['X-API-Key'] = target.apiKey
  else headers.Authorization = `Bearer ${target.apiKey}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new RealExpertError(timedOut ? 'Real Expert did not answer in time.' : 'Could not reach Real Expert.', null, true)
  }

  const text = await res.text().catch(() => '')
  if (res.status >= 300 && res.status < 400) {
    throw new RealExpertError(`Real Expert redirected the request (HTTP ${res.status}). Check the CRM address.`, res.status, false)
  }
  if (!res.ok) {
    const detail = errorDetail(text)
    const hint =
      res.status === 401 || res.status === 403
        ? 'The API key was rejected.'
        : res.status === 404
          ? `Endpoint not found: ${method} ${path}.`
          : `Real Expert returned HTTP ${res.status}.`
    throw new RealExpertError(detail ? `${hint} ${detail}` : hint, res.status, isRetryableStatus(res.status))
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function errorDetail(text: string): string {
  if (!text) return ''
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const m = j.message ?? j.error ?? (j.error as Record<string, unknown> | undefined)?.message
    if (typeof m === 'string') return m.slice(0, 200)
  } catch {
    // not JSON
  }
  return ''
}
