/**
 * Pure helpers for the WhatsApp setup page: validating a number a
 * client wants to add by SMS code, and turning Meta's account status
 * into a checklist the page can show ("why can't I send?").
 */

import type { WabaSetupStatus } from './meta-api'

export interface NewNumberInput {
  cc: string
  phoneNumber: string
  verifiedName: string
}

export type NewNumberError = 'cc' | 'phone_number' | 'verified_name'

/**
 * Normalises what the form sent: digits only for the country code and
 * number (spaces, dashes, a leading + or 0 are dropped), trimmed name.
 */
export function parseNewNumber(body: unknown): { value: NewNumberInput } | { error: NewNumberError } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const cc = String(b.cc ?? '').replace(/\D/g, '')
  let phoneNumber = String(b.phone_number ?? '').replace(/\D/g, '')
  const verifiedName = String(b.verified_name ?? '').trim().replace(/\s+/g, ' ')
  if (!/^\d{1,4}$/.test(cc)) return { error: 'cc' }
  // People often paste the full number with the country code, or a
  // national number with a trunk 0 (e.g. 098…). Strip both.
  if (phoneNumber.startsWith(cc) && phoneNumber.length > 10) phoneNumber = phoneNumber.slice(cc.length)
  phoneNumber = phoneNumber.replace(/^0+/, '')
  if (!/^\d{6,14}$/.test(phoneNumber)) return { error: 'phone_number' }
  if (verifiedName.length < 3 || verifiedName.length > 75) return { error: 'verified_name' }
  return { value: { cc, phoneNumber, verifiedName } }
}

/** A 6-digit code as typed (spaces / dashes allowed). */
export function parseVerificationCode(value: unknown): string | null {
  const code = String(value ?? '').replace(/[\s-]/g, '')
  return /^\d{6}$/.test(code) ? code : null
}

export type CheckState = 'ok' | 'warn' | 'fail' | 'unknown'

export interface SetupCheck {
  key: 'business_verification' | 'account_review' | 'payment_method' | 'can_send'
  state: CheckState
  /** Meta's raw value, shown next to the label. */
  value: string | null
  /** Meta's own explanations, for the can_send check. */
  details: string[]
  /** Where the client fixes it. */
  fixUrl: string | null
}

const lc = (v: string | null) => (v ?? '').toLowerCase()

export function buildSetupChecks(status: WabaSetupStatus, wabaId: string): SetupCheck[] {
  const bv = lc(status.businessVerificationStatus)
  const review = lc(status.accountReviewStatus)
  const send = lc(status.canSendMessage)

  const details = status.healthEntities.flatMap((e) =>
    (e.errors ?? [])
      .map((x) => [x.error_description, x.possible_solution].filter(Boolean).join(' — '))
      .filter(Boolean),
  )

  return [
    {
      key: 'business_verification',
      state: !bv ? 'unknown' : bv === 'verified' ? 'ok' : bv === 'pending' ? 'warn' : 'fail',
      value: status.businessVerificationStatus,
      details: [],
      fixUrl: bv === 'verified' ? null : 'https://business.facebook.com/settings/security',
    },
    {
      key: 'account_review',
      state: !review ? 'unknown' : review === 'approved' ? 'ok' : review === 'pending' ? 'warn' : 'fail',
      value: status.accountReviewStatus,
      details: [],
      fixUrl: review === 'approved' ? null : `https://business.facebook.com/wa/manage/home/?waba_id=${wabaId}`,
    },
    {
      key: 'payment_method',
      state: status.hasPaymentMethod === null ? 'unknown' : status.hasPaymentMethod ? 'ok' : 'fail',
      value: status.hasPaymentMethod === null ? null : status.hasPaymentMethod ? 'added' : 'missing',
      details: [],
      fixUrl: status.hasPaymentMethod ? null : `https://business.facebook.com/billing_hub/accounts/details/?asset_id=${wabaId}`,
    },
    {
      key: 'can_send',
      state: !send ? 'unknown' : send === 'available' ? 'ok' : send === 'limited' ? 'warn' : 'fail',
      value: status.canSendMessage,
      details: details.slice(0, 5),
      fixUrl: send === 'available' ? null : `https://business.facebook.com/wa/manage/home/?waba_id=${wabaId}`,
    },
  ]
}
