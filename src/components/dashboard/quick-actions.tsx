"use client"

import Link from 'next/link'
import { Brain, ChevronRight, Inbox, Megaphone, PlugZap, Workflow } from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant flow; none of them auto-open a modal on the target page.
interface Action {
  key: string
  href: string
  icon: ComponentType<{ className?: string }>
  tone: string
}

const ACTIONS: Action[] = [
  { key: 'broadcast', href: '/broadcasts/new', icon: Megaphone, tone: 'bg-indigo-500/12 text-indigo-500' },
  { key: 'inbox', href: '/inbox', icon: Inbox, tone: 'bg-sky-500/12 text-sky-500' },
  { key: 'flow', href: '/flows', icon: Workflow, tone: 'bg-emerald-500/12 text-emerald-500' },
  { key: 'ai', href: '/agents', icon: Brain, tone: 'bg-violet-500/12 text-violet-500' },
  { key: 'channel', href: '/whatsapp', icon: PlugZap, tone: 'bg-amber-500/14 text-amber-500' },
]

export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions')

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.key}
            href={a.href}
            className="group flex items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-4 shadow-[0_1px_3px_rgb(16_24_40/0.05)] transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
          >
            <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', a.tone)}>
              <Icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-foreground">{t(`${a.key}Title`)}</p>
              <p className="line-clamp-2 text-xs text-muted-foreground">{t(`${a.key}Desc`)}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 xl:hidden 2xl:block" />
          </Link>
        )
      })}
    </div>
  )
}
