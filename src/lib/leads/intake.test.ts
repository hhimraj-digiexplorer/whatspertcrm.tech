import { describe, expect, it } from 'vitest'
import type { Project } from '@/lib/projects/match'
import { chooseLeadWelcome, leadProject } from './intake'
import { parseLeadBody } from './parse'

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
const villas = p({ id: 'v', name: 'Green Villas', tag: 'p-villas', keywords: ['green villas'], welcome_mode: 'template', welcome_template: 'villas_welcome', welcome_language: 'en' })
const mall = p({ id: 'm', name: 'City Mall', tag: 'p-mall', category: 'commercial', keywords: ['city mall'], welcome_mode: 'none' })
const flats = p({ id: 'f', name: 'Sun Apartments', tag: 'p-sun', keywords: ['sun apartments'] })
const projects = [villas, mall, flats]
const hook = { send_welcome: true, welcome_template: 'generic_welcome', welcome_language: 'en' }

describe('leadProject', () => {
  it('uses the lead first, then the source default', () => {
    expect(leadProject(projects, parseLeadBody({ phone: '1', campaign_name: 'City Mall leasing' }), 'v').project?.id).toBe('m')
    expect(leadProject(projects, parseLeadBody({ phone: '1' }), 'v')).toMatchObject({ project: { id: 'v' }, via: 'default' })
  })
  it('an ambiguous lead is not forced onto the default project', () => {
    const m = leadProject(projects, parseLeadBody({ phone: '1', campaign_name: 'Green Villas + City Mall combo' }), 'f')
    expect(m).toMatchObject({ project: null, ambiguous: true })
  })
})

describe('chooseLeadWelcome — never the wrong project', () => {
  const base = { hook, ambiguous: false, payloadTemplate: null, optedOut: false, alreadyEnquired: false }
  it("the project's own welcome", () => {
    expect(chooseLeadWelcome({ ...base, project: villas })).toMatchObject({ kind: 'template', template: 'villas_welcome', reason: 'project' })
  })
  it('a project set to no welcome sends none', () => {
    expect(chooseLeadWelcome({ ...base, project: mall })).toEqual({ kind: 'none', reason: 'project_none' })
  })
  it("the source's welcome for a project without its own", () => {
    expect(chooseLeadWelcome({ ...base, project: flats })).toMatchObject({ template: 'generic_welcome', reason: 'source_default' })
  })
  it('no generic welcome for an ambiguous lead', () => {
    expect(chooseLeadWelcome({ ...base, project: null, ambiguous: true })).toEqual({ kind: 'none', reason: 'ambiguous_project' })
  })
  it('never twice for the same project, never after STOP, never when switched off', () => {
    expect(chooseLeadWelcome({ ...base, project: villas, alreadyEnquired: true }).kind).toBe('none')
    expect(chooseLeadWelcome({ ...base, project: villas, optedOut: true })).toEqual({ kind: 'none', reason: 'opted_out' })
    expect(chooseLeadWelcome({ ...base, project: villas, hook: { ...hook, send_welcome: false } })).toEqual({ kind: 'none', reason: 'welcome_off' })
  })
  it('a template named by the sender wins (but not over STOP)', () => {
    const payloadTemplate = { name: 'custom', language: 'hi' }
    expect(chooseLeadWelcome({ ...base, project: mall, payloadTemplate })).toMatchObject({ template: 'custom', reason: 'payload' })
    expect(chooseLeadWelcome({ ...base, project: mall, payloadTemplate, optedOut: true }).kind).toBe('none')
  })
})
