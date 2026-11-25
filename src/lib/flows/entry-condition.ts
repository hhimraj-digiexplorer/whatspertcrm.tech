/**
 * Flow entry conditions — `trigger_config.entry_condition`.
 *
 * A first-message (or keyword) flow can be limited to contacts who
 * have a tag, lack a tag, or have none / any / one / more than one tag
 * in a group. findEntryFlow checks flows WITH a condition first, so a
 * project's own menu wins over the catch-all project picker.
 */

import type { FlowEntryCondition, FlowTagGroupTest } from './types'
import { MAX_GROUP_NAME, passesGroupTest, sameGroup } from '@/lib/tags/groups'

const TESTS: readonly FlowTagGroupTest[] = ['none', 'any', 'one', 'more_than_one']

/** Read a stored entry condition; anything malformed counts as "no condition". */
export function parseEntryCondition(raw: unknown): FlowEntryCondition | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.kind === 'tag' && typeof r.tag_id === 'string' && r.tag_id.trim()) {
    return { kind: 'tag', tag_id: r.tag_id.trim(), ...(r.negate === true ? { negate: true } : {}) }
  }
  if (r.kind === 'tag_group' && typeof r.group === 'string' && r.group.trim()) {
    const test = TESTS.includes(r.test as FlowTagGroupTest) ? (r.test as FlowTagGroupTest) : 'any'
    return { kind: 'tag_group', group: r.group.trim().slice(0, MAX_GROUP_NAME), test }
  }
  return null
}

export interface ContactTagFacts {
  id: string
  group_name: string | null
}

export function passesEntryCondition(cond: FlowEntryCondition | null, tags: ContactTagFacts[]): boolean {
  if (!cond) return true
  if (cond.kind === 'tag') {
    const has = tags.some((t) => t.id === cond.tag_id)
    return cond.negate ? !has : has
  }
  const count = tags.filter((t) => sameGroup(t.group_name, cond.group)).length
  return passesGroupTest(count, cond.test)
}

/** Message text a condition node or entry check reads: typed text, or the tapped option's title. */
export function inboundText(message: { kind: 'text'; text: string } | { kind: 'interactive_reply'; reply_title: string }): string {
  return message.kind === 'text' ? message.text : message.reply_title
}
