import { describe, expect, it } from 'vitest'
import { fieldKey, leadSourceTexts, parseLeadBody, readLeadRequest } from './parse'

describe('parseLeadBody', () => {
  it('reads a flat website form', () => {
    const lead = parseLeadBody({
      'Full Name': 'Asha Verma',
      'Phone Number': '98765 43210',
      Email: 'asha@example.com',
      project: 'GAL',
      utm_campaign: 'galleria-nov',
      budget: '1.5 Cr',
    })
    expect(lead).toMatchObject({
      name: 'Asha Verma',
      phone: '98765 43210',
      email: 'asha@example.com',
      projectValues: ['GAL'],
      utm: { utm_campaign: 'galleria-nov' },
      extra: { budget: '1.5 Cr' },
    })
  })

  it('reads Meta lead ads field_data (Zapier / Make / Pabbly)', () => {
    const lead = parseLeadBody({
      ad_id: '120000000001',
      ad_name: 'Galleria – Villas',
      campaign_name: 'Lucknow Nov',
      form_name: 'Galleria form',
      field_data: [
        { name: 'full_name', values: ['Ravi Kumar'] },
        { name: 'phone_number', values: ['+919876543210'] },
        { name: 'which_configuration?', values: ['4 BHK'] },
      ],
    })
    expect(lead).toMatchObject({
      name: 'Ravi Kumar',
      phone: '+919876543210',
      adId: '120000000001',
      adName: 'Galleria – Villas',
      campaign: 'Lucknow Nov',
      formName: 'Galleria form',
      extra: { which_configuration: '4 BHK' },
    })
    expect(leadSourceTexts(lead)).toEqual(['Lucknow Nov', 'Galleria – Villas', 'Galleria form'])
  })

  it('reads nested CRM payloads and first/last names', () => {
    const lead = parseLeadBody({ event: 'lead.created', data: { first_name: 'Neha', last_name: 'Singh', mobile: '9876543210', project_code: 'SKY' } })
    expect(lead).toMatchObject({ name: 'Neha Singh', phone: '9876543210', projectValues: ['SKY'] })
    expect(lead.extra).not.toHaveProperty('event')
  })

  it('drops an invalid email and keeps tags and a template override', () => {
    const lead = parseLeadBody({
      phone: '1',
      email: 'not-an-email',
      tags: ['Hot', 'Hot', 'Site visit'],
      template: { name: 'galleria_welcome', language: 'en', variables: ['Asha'] },
    })
    expect(lead.email).toBeNull()
    expect(lead.tags).toEqual(['Hot', 'Site visit'])
    expect(lead.template).toEqual({ name: 'galleria_welcome', language: 'en', variables: ['Asha'] })
  })
})

describe('readLeadRequest', () => {
  it('parses JSON and form posts', () => {
    expect(readLeadRequest('{"phone":"1"}', 'application/json')).toEqual({ phone: '1' })
    expect(readLeadRequest('name=Asha&phone=98765', 'application/x-www-form-urlencoded')).toEqual({ name: 'Asha', phone: '98765' })
    expect(readLeadRequest('name=Asha&phone=98765', null)).toEqual({ name: 'Asha', phone: '98765' })
    expect(readLeadRequest('not json', 'application/json')).toBeNull()
  })
  it('normalises field names', () => {
    expect(fieldKey('Phone Number')).toBe('phone_number')
    expect(fieldKey('phoneNumber')).toBe('phone_number')
  })
})
