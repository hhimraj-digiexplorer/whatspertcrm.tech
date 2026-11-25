import { describe, expect, it } from 'vitest'
import type { Project } from './match'
import { inboundProjectMatch } from './inbound'

const p = (over: Partial<Project> & Pick<Project, 'id' | 'name' | 'tag'>): Project => ({
  code: null,
  category: 'residential',
  keywords: [],
  ad_ids: [],
  welcome_mode: 'default',
  welcome_template: null,
  welcome_language: null,
  ai_instructions: null,
  is_active: true,
  ...over,
})
const a = p({ id: 'a', name: 'Project A', tag: 'p-a', keywords: ['alpha'], ad_ids: ['111111'] })
const b = p({ id: 'b', name: 'Project B', tag: 'p-b', keywords: ['bravo'], ad_ids: ['222222'] })

describe('inboundProjectMatch', () => {
  it('acceptance test 3: a CTWA chat from B\'s ad is B, even for an A contact', () => {
    expect(inboundProjectMatch([a, b], { referral: { source_id: '222222' }, text: 'hi', contactHasProject: true }).project?.id).toBe('b')
  })
  it("matches the ad's headline when the id isn't listed", () => {
    expect(inboundProjectMatch([a, b], { referral: { source_id: '9', headline: 'Bravo towers' }, text: null, contactHasProject: false }).project?.id).toBe('b')
  })
  it('a pre-filled website message places a contact with no project', () => {
    expect(inboundProjectMatch([a, b], { referral: null, text: "Hi, I'm interested in Alpha", contactHasProject: false }).project?.id).toBe('a')
  })
  it('a message never moves a contact who already has a project', () => {
    expect(inboundProjectMatch([a, b], { referral: null, text: 'is bravo cheaper?', contactHasProject: true }).project).toBeNull()
  })
  it('a message naming both projects places nobody', () => {
    expect(inboundProjectMatch([a, b], { referral: null, text: 'alpha or bravo?', contactHasProject: false })).toMatchObject({ project: null, ambiguous: true })
  })
})
