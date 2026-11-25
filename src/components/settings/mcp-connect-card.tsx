'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Bot, Copy } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

function Snippet({ label, code }: { label: string; code: string }) {
  const t = useTranslations('Settings.apiKeys');
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => toast.success(t('mcpCopied')));
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
        >
          <Copy className="size-3.5" /> {t('mcpCopy')}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 text-xs leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * How to connect Claude (and other MCP clients) to this workspace with an
 * API key. The key's scopes decide which tools the assistant gets.
 */
export function McpConnectCard() {
  const t = useTranslations('Settings.apiKeys');
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => 'https://whatspertcrm.tech',
  );
  const url = `${origin}/api/mcp`;

  const claudeCode = `claude mcp add --transport http whatspert ${url} \\\n  --header "Authorization: Bearer YOUR_API_KEY"`;
  const desktop = JSON.stringify(
    {
      mcpServers: {
        whatspert: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', 'Authorization: Bearer ${WHATSPERT_KEY}'],
          env: { WHATSPERT_KEY: 'YOUR_API_KEY' },
        },
      },
    },
    null,
    2,
  );

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/12 text-violet-500">
            <Bot className="size-5" />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">{t('mcpTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('mcpDesc')}</p>
          </div>
        </div>
        <ul className="grid gap-1.5 text-sm text-foreground sm:grid-cols-2">
          {(['mcpExample1', 'mcpExample2', 'mcpExample3', 'mcpExample4'] as const).map((k) => (
            <li key={k} className="rounded-lg bg-muted/40 px-3 py-2 italic">“{t(k)}”</li>
          ))}
        </ul>
        <Snippet label={t('mcpUrl')} code={url} />
        <Snippet label={t('mcpClaudeCode')} code={claudeCode} />
        <Snippet label={t('mcpClaudeDesktop')} code={desktop} />
        <p className="text-xs text-muted-foreground">{t('mcpScopesNote')}</p>
      </CardContent>
    </Card>
  );
}
