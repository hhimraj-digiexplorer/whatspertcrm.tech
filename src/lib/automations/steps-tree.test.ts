import { describe, expect, it } from 'vitest'
import { flattenSteps } from './steps-tree'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

describe('flattenSteps (diff save)', () => {
  it('keeps ids that belong to the automation and re-parents moved steps', () => {
    const rows = flattenSteps(
      'auto-1',
      [
        {
          id: A,
          step_type: 'condition',
          step_config: {},
          branches: { yes: [{ id: B, step_type: 'wait', step_config: { amount: 1, unit: 'days' } }], no: [] },
        },
      ],
      new Set([A, B]),
    )
    expect(rows.map((r) => [r.id, r.parent_step_id, r.branch, r.position])).toEqual([
      [A, null, null, 0],
      [B, A, 'yes', 0],
    ])
  })

  it("never adopts an id that isn't usable, and uses an id only once", () => {
    const rows = flattenSteps(
      'auto-1',
      [
        { id: C, step_type: 'send_message', step_config: {} },
        { id: A, step_type: 'wait', step_config: {} },
        { id: A, step_type: 'wait', step_config: {} },
      ],
      new Set([A]),
    )
    expect(rows[0].id).not.toBe(C)
    expect(rows[1].id).toBe(A)
    expect(rows[2].id).not.toBe(A)
    expect(new Set(rows.map((r) => r.id)).size).toBe(3)
  })
})
