"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { Brain, ListChecks, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

interface AiStatus {
  active: boolean
  autoReply: boolean
  sources: number
  lastTrained: string | null
}

/** AI assistant at a glance: on/off, knowledge sources, last update. */
export function AiStatusCard() {
  const t = useTranslations('Dashboard.aiStatus')
  const format = useFormatter()
  const { accountId } = useAuth()
  const [status, setStatus] = useState<AiStatus | null>(null)

  useEffect(() => {
    if (!accountId) return
    let alive = true
    const db = createClient()
    Promise.all([
      db.from('ai_configs').select('is_active, auto_reply_enabled').eq('account_id', accountId).maybeSingle(),
      db
        .from('ai_knowledge_documents')
        .select('updated_at', { count: 'exact' })
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false })
        .limit(1),
    ]).then(([cfg, docs]) => {
      if (!alive) return
      setStatus({
        active: Boolean(cfg.data?.is_active),
        autoReply: Boolean(cfg.data?.auto_reply_enabled),
        sources: docs.count ?? 0,
        lastTrained: docs.data?.[0]?.updated_at ?? null,
      })
    })
    return () => {
      alive = false
    }
  }, [accountId])

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgb(16_24_40/0.05)]">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-3 text-lg font-semibold text-foreground">
          <span className="flex size-10 items-center justify-center rounded-full bg-violet-500/12 text-violet-500">
            <Brain className="size-5" />
          </span>
          {t('title')}
        </h2>
        <Link href="/agents" className="text-sm font-medium text-primary hover:underline">
          {t('view')}
        </Link>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-3">
        <Stat
          icon={<Sparkles className="size-5" />}
          tone="bg-amber-400/15 text-violet-500"
          label={t('assistant')}
          value={
            status ? (
              <span className={cn('flex items-center gap-1.5 text-base', status.active ? 'text-emerald-500' : 'text-emerald-500/70')}>
                <span className={cn('size-2 rounded-full', status.active ? 'bg-emerald-500' : 'bg-slate-400')} />
                {status.active ? (status.autoReply ? t('activeAuto') : t('active')) : t('inactive')}
              </span>
            ) : '—'
          }
        />
        <Stat
          icon={<ListChecks className="size-5" />}
          tone="bg-emerald-500/12 text-emerald-500"
          label={t('sources')}
          value={status ? <span className="text-2xl">{format.number(status.sources)}</span> : '—'}
        />
        <Stat
          icon={<Brain className="size-5" />}
          tone="bg-sky-500/12 text-sky-500"
          label={t('lastTraining')}
          value={
            <span className="text-xl">
              {status?.lastTrained ? format.relativeTime(new Date(status.lastTrained)) : t('never')}
            </span>
          }
        />
      </div>
    </section>
  )
}

function Stat({ icon, tone, label, value }: { icon: React.ReactNode; tone: string; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card-2 p-4">
      <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-xl', tone)}>{icon}</span>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="mt-0.5 font-semibold text-foreground">{value}</div>
      </div>
    </div>
  )
}
