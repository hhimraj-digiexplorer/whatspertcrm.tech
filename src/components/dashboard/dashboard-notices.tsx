"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Circle, Rocket, ShieldAlert, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

const DISMISS_KEY = 'whatspert:dismissed-notices'

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]')
  } catch {
    return []
  }
}

interface Setup {
  whatsapp: boolean
  contacts: boolean
  templates: boolean
  team: boolean
}

/**
 * Dismissible notice cards at the top of the dashboard: a red one when
 * WhatsApp isn't connected (nothing works without it) and a getting-
 * started checklist until the basics are done. Dismissals are kept per
 * browser.
 */
export function DashboardNotices() {
  const t = useTranslations('Dashboard.notices')
  const { accountId } = useAuth()
  const [setup, setSetup] = useState<Setup | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])

  useEffect(() => {
    // Read after mount so the server render and first client render match.
    const id = setTimeout(() => setDismissed(readDismissed()), 0)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!accountId) return
    let alive = true
    const db = createClient()
    const head = { count: 'exact' as const, head: true }
    Promise.all([
      db.from('whatsapp_config').select('id', head).eq('account_id', accountId),
      db.from('contacts').select('id', head).eq('account_id', accountId),
      db.from('message_templates').select('id', head).eq('account_id', accountId),
      db.from('profiles').select('id', head).eq('account_id', accountId),
    ]).then(([wa, contacts, templates, team]) => {
      if (!alive) return
      setSetup({
        whatsapp: (wa.count ?? 0) > 0,
        contacts: (contacts.count ?? 0) > 0,
        templates: (templates.count ?? 0) > 0,
        team: (team.count ?? 0) > 1,
      })
    })
    return () => {
      alive = false
    }
  }, [accountId])

  function dismiss(id: string) {
    const next = [...new Set([...dismissed, id])]
    setDismissed(next)
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next))
    } catch {
      // Private mode etc. — the card just comes back next visit.
    }
  }

  if (!setup) return null
  const steps = [
    { key: 'stepWhatsapp', done: setup.whatsapp, href: '/whatsapp' },
    { key: 'stepContacts', done: setup.contacts, href: '/contacts' },
    { key: 'stepTemplates', done: setup.templates, href: '/settings?tab=templates' },
    { key: 'stepTeam', done: setup.team, href: '/settings?tab=members' },
  ]
  const allDone = steps.every((s) => s.done)

  return (
    <div className="space-y-4">
      {!setup.whatsapp && !dismissed.includes('connect-whatsapp') && (
        <Notice
          tone="danger"
          icon={ShieldAlert}
          title={t('connectTitle')}
          onDismiss={() => dismiss('connect-whatsapp')}
          dismissLabel={t('dismiss')}
        >
          {t('connectBody')}{' '}
          <Link href="/whatsapp" className="font-semibold text-emerald-500 hover:underline">
            {t('connectCta')}
          </Link>
        </Notice>
      )}

      {!allDone && !dismissed.includes('getting-started') && (
        <Notice
          tone="info"
          icon={Rocket}
          title={t('startTitle')}
          onDismiss={() => dismiss('getting-started')}
          dismissLabel={t('dismiss')}
        >
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {steps.map((s) => (
              <li key={s.key}>
                <Link
                  href={s.href}
                  className={cn(
                    'flex items-center gap-2 text-sm',
                    s.done ? 'text-muted-foreground line-through' : 'font-medium text-foreground hover:text-primary',
                  )}
                >
                  {s.done ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-sky-500" />
                  )}
                  {t(s.key)}
                </Link>
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  )
}

function Notice({
  tone,
  icon: Icon,
  title,
  children,
  onDismiss,
  dismissLabel,
}: {
  tone: 'danger' | 'info'
  icon: typeof Rocket
  title: string
  children: React.ReactNode
  onDismiss: () => void
  dismissLabel: string
}) {
  return (
    <div
      className={cn(
        'relative flex gap-4 rounded-2xl border-2 border-dashed p-5 pr-12',
        tone === 'danger'
          ? 'border-rose-400/50 bg-rose-500/8'
          : 'border-sky-400/50 bg-sky-500/8',
      )}
    >
      <Icon className={cn('mt-0.5 size-7 shrink-0', tone === 'danger' ? 'text-rose-500' : 'text-sky-500')} />
      <div className="min-w-0">
        <p className={cn('text-base font-semibold', tone === 'danger' ? 'text-foreground' : 'text-sky-500')}>{title}</p>
        <div className="mt-1 text-sm text-foreground/80">{children}</div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground hover:bg-black/5 hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
