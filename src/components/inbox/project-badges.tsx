"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PROJECT_TAG_GROUP, sameGroup } from "@/lib/tags/groups";

interface ProjectTag {
  id: string;
  name: string;
  color: string;
}

/**
 * The contact's project tags (tags in the "Project" group), shown in
 * the thread header so an agent sees at a glance which project(s) the
 * buyer asked about. Renders nothing for contacts with no project tag.
 */
export function ProjectBadges({ contactId }: { contactId: string }) {
  const t = useTranslations("Inbox.messageThread");
  const [state, setState] = useState<{ contactId: string; tags: ProjectTag[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("contact_tags")
        .select("tags(id, name, color, group_name)")
        .eq("contact_id", contactId);
      if (cancelled) return;
      const tags: ProjectTag[] = [];
      for (const row of data ?? []) {
        const raw = (row as { tags?: unknown }).tags;
        const tag = (Array.isArray(raw) ? raw[0] : raw) as
          | (ProjectTag & { group_name?: string | null })
          | undefined;
        if (tag && sameGroup(tag.group_name, PROJECT_TAG_GROUP)) {
          tags.push({ id: tag.id, name: tag.name, color: tag.color });
        }
      }
      setState({ contactId, tags });
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const tags = state?.contactId === contactId ? state.tags : [];
  if (tags.length === 0) return null;
  const shown = tags.slice(0, 2);
  const extra = tags.length - shown.length;

  return (
    <div
      className="ml-1 hidden min-w-0 items-center gap-1 md:flex"
      title={t("projectsTitle", { projects: tags.map((p) => p.name).join(", ") })}
    >
      <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {shown.map((p) => (
        <span
          key={p.id}
          className="max-w-[9rem] truncate rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{
            backgroundColor: `${p.color}20`,
            color: p.color,
            border: `1px solid ${p.color}40`,
          }}
        >
          {p.name}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] text-muted-foreground">
          {t("projectsMore", { count: extra })}
        </span>
      )}
    </div>
  );
}
