import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, HANDOFF_SENTINEL, projectScopeInstruction } from './defaults'

describe('per-project AI instructions', () => {
  it('acceptance test 7: a single-project contact gets only that project, and a salesperson for others', () => {
    const p = projectScopeInstruction(['AIS Galleria'], 'auto_reply')
    expect(p).toContain('"AIS Galleria" only')
    expect(p).toContain('do not share any details')
    expect(p).toContain(HANDOFF_SENTINEL)
  })
  it('no project yet: no project details, ask which one', () => {
    const p = projectScopeInstruction([], 'auto_reply')
    expect(p).toContain('has not chosen one')
    expect(p).toContain('Ask which project')
  })
  it('lists several projects', () => {
    expect(projectScopeInstruction(['A', 'B', 'C'], 'draft')).toContain('"A", "B" and "C" only')
  })
  it('is added to the system prompt only when scoped', () => {
    expect(buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })).not.toContain('Projects:')
    expect(buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', projectScope: { projects: ['A'] } })).toContain(
      'Projects:',
    )
  })
})
