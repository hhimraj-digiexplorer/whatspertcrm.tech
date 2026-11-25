import { describe, expect, it } from 'vitest'
import { buildSetupChecks, parseNewNumber, parseVerificationCode } from './number-onboarding'
import type { WabaSetupStatus } from './meta-api'

describe('parseNewNumber', () => {
  it('keeps digits only and trims the display name', () => {
    expect(parseNewNumber({ cc: '+91', phone_number: '98765 43210', verified_name: '  The  Galleria ' })).toEqual({
      value: { cc: '91', phoneNumber: '9876543210', verifiedName: 'The Galleria' },
    })
  })

  it('drops a pasted country code and a trunk zero', () => {
    expect(parseNewNumber({ cc: '91', phone_number: '+91 98765 43210', verified_name: 'Shop' })).toMatchObject({
      value: { phoneNumber: '9876543210' },
    })
    expect(parseNewNumber({ cc: '91', phone_number: '09876543210', verified_name: 'Shop' })).toMatchObject({
      value: { phoneNumber: '9876543210' },
    })
  })

  it('names the field that is wrong', () => {
    expect(parseNewNumber({ cc: '', phone_number: '9876543210', verified_name: 'Shop' })).toEqual({ error: 'cc' })
    expect(parseNewNumber({ cc: '91', phone_number: '123', verified_name: 'Shop' })).toEqual({ error: 'phone_number' })
    expect(parseNewNumber({ cc: '91', phone_number: '9876543210', verified_name: 'ab' })).toEqual({ error: 'verified_name' })
    expect(parseNewNumber(null)).toEqual({ error: 'cc' })
  })
})

describe('parseVerificationCode', () => {
  it('accepts 6 digits with spaces or a dash', () => {
    expect(parseVerificationCode('123 456')).toBe('123456')
    expect(parseVerificationCode('123-456')).toBe('123456')
  })
  it('rejects anything else', () => {
    expect(parseVerificationCode('12345')).toBeNull()
    expect(parseVerificationCode('abcdef')).toBeNull()
    expect(parseVerificationCode(undefined)).toBeNull()
  })
})

const base: WabaSetupStatus = {
  name: 'Shop',
  accountReviewStatus: 'APPROVED',
  businessVerificationStatus: 'verified',
  hasPaymentMethod: true,
  canSendMessage: 'AVAILABLE',
  healthEntities: [],
}

describe('buildSetupChecks', () => {
  it('is all green for a healthy account, with no fix links', () => {
    const checks = buildSetupChecks(base, '222')
    expect(checks.map((c) => c.state)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(checks.every((c) => c.fixUrl === null)).toBe(true)
  })

  it('flags the usual blockers and links to where to fix them', () => {
    const checks = buildSetupChecks(
      {
        ...base,
        businessVerificationStatus: 'unverified',
        accountReviewStatus: 'PENDING',
        hasPaymentMethod: false,
        canSendMessage: 'BLOCKED',
        healthEntities: [
          { entity_type: 'WABA', errors: [{ error_description: 'No payment method', possible_solution: 'Add a card' }] },
        ],
      },
      '222',
    )
    const by = Object.fromEntries(checks.map((c) => [c.key, c]))
    expect(by.business_verification.state).toBe('fail')
    expect(by.account_review.state).toBe('warn')
    expect(by.payment_method.state).toBe('fail')
    expect(by.payment_method.fixUrl).toContain('asset_id=222')
    expect(by.can_send.state).toBe('fail')
    expect(by.can_send.details).toEqual(['No payment method — Add a card'])
  })

  it('says unknown when Meta returned nothing for a field', () => {
    const checks = buildSetupChecks(
      { ...base, businessVerificationStatus: null, hasPaymentMethod: null, canSendMessage: null },
      '222',
    )
    const by = Object.fromEntries(checks.map((c) => [c.key, c.state]))
    expect(by).toMatchObject({ business_verification: 'unknown', payment_method: 'unknown', can_send: 'unknown' })
  })
})
