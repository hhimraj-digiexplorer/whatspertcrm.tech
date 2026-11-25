import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Builder payload → flat rows for automation_steps.
// Root steps arrive in order. A Condition step carries its children
// under `branches: { yes: [...], no: [...] }`. We walk the tree and
// assign stable UUIDs so parent_step_id references resolve in a
// single INSERT.
// ------------------------------------------------------------

export interface BuilderStepInput {
  id?: string
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: BuilderStepInput[]; no?: BuilderStepInput[] }
  // Legacy flat form (from template seeds):
  branch?: 'yes' | 'no' | null
  parent_index?: number | null
}

interface InsertRow {
  id: string
  automation_id: string
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  step_type: string
  step_config: Record<string, unknown>
  position: number
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

/** Refused save: removing these steps would strand contacts waiting in them. */
export class WaitingRunsError extends Error {
  readonly code = 'waiting_runs'
  constructor(readonly waiting: number) {
    super(
      `${waiting} contact${waiting === 1 ? ' is' : 's are'} still waiting in a step you removed. ` +
        'Keep that Wait step (and the branch it sits in) until they move on, or turn the automation off and try again later.',
    )
    this.name = 'WaitingRunsError'
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Builder tree → rows. Ids not already on this automation get a fresh one. */
export function flattenSteps(
  automationId: string,
  input: BuilderStepInput[],
  keepIds: Set<string>,
): InsertRow[] {
  if (!input || input.length === 0) return []
  const looksFlat = input.some((s) => s.branch !== undefined || s.parent_index !== undefined)
  const tree = looksFlat ? seedsToTree(input) : input
  const rows: InsertRow[] = []
  const used = new Set<string>()
  function walk(steps: BuilderStepInput[], parentId: string | null, branch: 'yes' | 'no' | null) {
    steps.forEach((s, idx) => {
      // Only reuse an id that already belongs to this automation (and
      // only once) — never adopt another automation's step row.
      const id = s.id && keepIds.has(s.id) && !used.has(s.id) ? s.id : uid()
      used.add(id)
      rows.push({
        id,
        automation_id: automationId,
        parent_step_id: parentId,
        branch,
        step_type: s.step_type,
        step_config: s.step_config ?? {},
        position: idx,
      })
      if (s.step_type === 'condition' && s.branches) {
        if (s.branches.yes) walk(s.branches.yes, id, 'yes')
        if (s.branches.no) walk(s.branches.no, id, 'no')
      }
    })
  }
  walk(tree, null, null)
  return rows
}

/**
 * Save the builder's steps as a diff (channel-partner request, point 9):
 * unchanged steps keep their row, moved / edited steps are updated in
 * place, new ones inserted, and only steps that were really removed are
 * deleted. The old delete-everything-then-insert cut contacts waiting in
 * a branch loose (the pending row's parent link was nulled on delete).
 *
 * A save that would remove a step contacts are still waiting in — the
 * Wait step itself, or the condition whose branch holds it — is refused
 * with WaitingRunsError. Existing waiting runs are never moved here.
 */
export async function replaceSteps(
  automationId: string,
  input: BuilderStepInput[],
): Promise<string | null> {
  const admin = supabaseAdmin()
  const { data: existing, error: loadErr } = await admin
    .from('automation_steps')
    .select('id')
    .eq('automation_id', automationId)
  if (loadErr) return loadErr.message
  const existingIds = new Set(((existing ?? []) as { id: string }[]).map((r) => r.id))

  // New steps carry the builder's own UUID; use it when no other
  // automation has a step with that id, so it stays stable across saves.
  const usable = new Set(existingIds)
  const candidates = collectIds(input).filter((id) => UUID_RE.test(id) && !existingIds.has(id))
  if (candidates.length > 0) {
    const { data: taken, error: takenErr } = await admin.from('automation_steps').select('id').in('id', candidates)
    if (takenErr) return takenErr.message
    const takenIds = new Set(((taken ?? []) as { id: string }[]).map((r) => r.id))
    for (const id of candidates) if (!takenIds.has(id)) usable.add(id)
  }

  const rows = flattenSteps(automationId, input, usable)
  const kept = new Set(rows.map((r) => r.id))
  const removed = [...existingIds].filter((id) => !kept.has(id))

  if (removed.length > 0) {
    // Removing a step cascades to its children (parent_step_id ON DELETE
    // CASCADE), so count waits on any removed step or inside its subtree.
    const waiting = await countWaitingOn(automationId, removed)
    if (waiting > 0) throw new WaitingRunsError(waiting)
  }

  if (rows.length > 0) {
    const { error } = await admin.from('automation_steps').upsert(rows, { onConflict: 'id' })
    if (error) return error.message
  }
  if (removed.length > 0) {
    const { error } = await admin.from('automation_steps').delete().eq('automation_id', automationId).in('id', removed)
    if (error) return error.message
  }
  return null
}

function collectIds(steps: BuilderStepInput[] | undefined): string[] {
  const out: string[] = []
  for (const s of steps ?? []) {
    if (typeof s.id === 'string') out.push(s.id)
    out.push(...collectIds(s.branches?.yes), ...collectIds(s.branches?.no))
  }
  return out
}

/**
 * Pending runs that sit at (or under) any of these steps: rows that know
 * their Wait step (wait_step_id), and older rows whose branch parent is
 * one of them.
 */
async function countWaitingOn(automationId: string, stepIds: string[]): Promise<number> {
  const admin = supabaseAdmin()
  const ids = stepIds.filter((id) => UUID_RE.test(id))
  if (ids.length === 0) return 0
  const list = ids.join(',')
  const { count, error } = await admin
    .from('automation_pending_executions')
    .select('id', { count: 'exact', head: true })
    .eq('automation_id', automationId)
    .in('status', ['pending', 'running'])
    .or(`wait_step_id.in.(${list}),parent_step_id.in.(${list})`)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function insertSteps(
  automationId: string,
  input: BuilderStepInput[],
): Promise<string | null> {
  if (!input || input.length === 0) return null

  const looksFlat = input.some(
    (s) => s.branch !== undefined || s.parent_index !== undefined,
  )
  const tree = looksFlat ? seedsToTree(input) : input

  const rows: InsertRow[] = []
  function walk(
    steps: BuilderStepInput[],
    parentId: string | null,
    branch: 'yes' | 'no' | null,
  ) {
    steps.forEach((s, idx) => {
      const id = s.id ?? uid()
      rows.push({
        id,
        automation_id: automationId,
        parent_step_id: parentId,
        branch,
        step_type: s.step_type,
        step_config: s.step_config ?? {},
        position: idx,
      })
      if (s.step_type === 'condition' && s.branches) {
        if (s.branches.yes) walk(s.branches.yes, id, 'yes')
        if (s.branches.no) walk(s.branches.no, id, 'no')
      }
    })
  }
  walk(tree, null, null)

  if (rows.length === 0) return null
  const { error } = await supabaseAdmin().from('automation_steps').insert(rows)
  return error?.message ?? null
}

function seedsToTree(seeds: BuilderStepInput[]): BuilderStepInput[] {
  const nodes: BuilderStepInput[] = seeds.map((s) => ({
    ...s,
    branches: { yes: [], no: [] },
  }))
  const roots: BuilderStepInput[] = []
  nodes.forEach((n, i) => {
    const seed = seeds[i]
    if (seed.parent_index == null) {
      roots.push(n)
    } else {
      const parent = nodes[seed.parent_index]
      parent.branches = parent.branches ?? { yes: [], no: [] }
      const bucket = (seed.branch ?? 'yes') as 'yes' | 'no'
      ;(parent.branches[bucket] ??= []).push(n)
    }
  })
  return roots
}

/**
 * Load the steps for an automation and rebuild the nested tree shape
 * the builder UI expects. One query, O(n) assembly.
 */
export interface BuilderStepNode extends BuilderStepInput {
  id: string
  branches: { yes: BuilderStepNode[]; no: BuilderStepNode[] }
}

interface DbStep {
  id: string
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  step_type: string
  step_config: Record<string, unknown>
  position: number
}

export async function loadStepsTree(automationId: string): Promise<BuilderStepNode[]> {
  const { data, error } = await supabaseAdmin()
    .from('automation_steps')
    .select('*')
    .eq('automation_id', automationId)
    .order('position', { ascending: true })

  if (error) throw new Error(error.message)
  const rows = (data ?? []) as DbStep[]

  const byId = new Map<string, BuilderStepNode>()
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      step_type: row.step_type,
      step_config: row.step_config ?? {},
      branches: { yes: [], no: [] },
    })
  }

  const roots: BuilderStepNode[] = []
  for (const row of rows) {
    const node = byId.get(row.id)!
    if (row.parent_step_id) {
      const parent = byId.get(row.parent_step_id)
      if (parent) {
        const bucket = (row.branch ?? 'yes') as 'yes' | 'no'
        parent.branches[bucket].push(node)
      }
    } else {
      roots.push(node)
    }
  }
  return roots
}
