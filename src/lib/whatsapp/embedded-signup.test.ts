import { describe, expect, it } from 'vitest'
import { generateTwoStepPin, parseEmbeddedSignupMessage } from './embedded-signup'

const FB = 'https://www.facebook.com'

describe('parseEmbeddedSignupMessage', () => {
  it('reads a finished signup (object or JSON string)', () => {
    const msg = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: '111', waba_id: '222' } }
    expect(parseEmbeddedSignupMessage(FB, msg)).toEqual({
      type: 'finish',
      phoneNumberId: '111',
      wabaId: '222',
      coexistence: false,
    })
    expect(parseEmbeddedSignupMessage(FB, JSON.stringify(msg))).toMatchObject({ type: 'finish' })
  })

  it('flags WhatsApp Business app (coexistence) onboarding', () => {
    const msg = {
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      data: { phone_number_id: '1', waba_id: '2' },
    }
    expect(parseEmbeddedSignupMessage(FB, msg)).toMatchObject({ coexistence: true })
  })

  it('reports cancel and error', () => {
    expect(
      parseEmbeddedSignupMessage(FB, { type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'PHONE_NUMBER_SETUP' } }),
    ).toEqual({ type: 'cancel', step: 'PHONE_NUMBER_SETUP' })
    expect(
      parseEmbeddedSignupMessage(FB, { type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: { error_message: 'x' } }),
    ).toEqual({ type: 'error', message: 'x' })
  })

  it('ignores other origins and unrelated messages', () => {
    const msg = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: '1', waba_id: '2' } }
    expect(parseEmbeddedSignupMessage('https://evil.example', msg)).toBeNull()
    expect(parseEmbeddedSignupMessage('https://facebook.com.evil.example', msg)).toBeNull()
    expect(parseEmbeddedSignupMessage(FB, { type: 'OTHER' })).toBeNull()
    expect(parseEmbeddedSignupMessage(FB, 'not json')).toBeNull()
    expect(parseEmbeddedSignupMessage(FB, { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: {} })).toBeNull()
  })
})

describe('generateTwoStepPin', () => {
  it('always returns 6 digits', () => {
    for (let i = 0; i < 50; i++) expect(generateTwoStepPin()).toMatch(/^\d{6}$/)
  })
})
