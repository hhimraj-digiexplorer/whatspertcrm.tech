import { beforeEach, describe, expect, it, vi } from "vitest";

// Drives the real dispatchInboundToFlows against a tiny fake DB to check
// how several first-message flows route by project (channel partners,
// acceptance tests 3 and 4).

const h = vi.hoisted(() => ({
  state: {
    flows: [] as Record<string, unknown>[],
    nodes: [] as Record<string, unknown>[],
    contactTags: [] as Record<string, unknown>[],
    startedFlowIds: [] as string[],
    sentTexts: [] as string[],
  },
}));

vi.mock("./admin-client", () => {
  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    let inserted: Record<string, unknown> | null = null;
    const rows = (): unknown[] => {
      if (table === "flows") return h.state.flows;
      if (table === "flow_nodes") return h.state.nodes.filter((n) => n.flow_id === filters.flow_id);
      if (table === "contact_tags") return h.state.contactTags;
      return []; // flow_runs: no active run
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (col: string, v: unknown) => {
        filters[col] = v;
        return b;
      },
      is: () => b,
      in: () => b,
      not: () => b,
      filter: () => b,
      order: () => b,
      limit: () => b,
      update: () => b,
      insert: (row: Record<string, unknown>) => {
        if (table === "flow_runs") {
          h.state.startedFlowIds.push(row.flow_id as string);
          inserted = { id: "run-1", vars: {}, reprompt_count: 0, ...row };
        }
        return b;
      },
      maybeSingle: async () => ({ data: inserted ?? rows()[0] ?? null, error: null }),
      single: async () => ({ data: inserted ?? rows()[0] ?? null, error: null }),
      then: (resolve: (r: { data: unknown[]; error: null; count: number }) => unknown) =>
        resolve({ data: rows(), error: null, count: 0 }),
    };
    return b;
  }
  return {
    supabaseAdmin: () => ({
      from: (t: string) => builder(t),
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async (args: { text: string }) => {
    h.state.sentTexts.push(args.text);
    return { whatsapp_message_id: "wamid.1" };
  }),
  engineSendMedia: vi.fn(),
  engineSendInteractiveButtons: vi.fn(),
  engineSendInteractiveList: vi.fn(),
}));

import { dispatchInboundToFlows } from "./engine";

function flow(id: string, created: string, trigger_config: Record<string, unknown>) {
  return {
    id,
    account_id: "acct-1",
    user_id: "u-1",
    name: id,
    status: "active",
    trigger_type: "first_inbound_message",
    trigger_config,
    entry_node_id: "hello",
    fallback_policy: {},
    created_at: created,
  };
}

function nodesFor(flowId: string, text: string) {
  return [
    { id: `${flowId}-1`, flow_id: flowId, node_key: "hello", node_type: "send_message", config: { text, next_node_key: "done" } },
    { id: `${flowId}-2`, flow_id: flowId, node_key: "done", node_type: "end", config: {} },
  ];
}

function projectTag(id: string) {
  return { tag_id: id, tags: { id, name: id, group_name: "Project", account_id: "acct-1" } };
}

const first = (text: string) =>
  dispatchInboundToFlows({
    accountId: "acct-1",
    userId: "u-1",
    contactId: "ct-1",
    conversationId: "cv-1",
    message: { kind: "text", text, meta_message_id: `m-${text}` },
    isFirstInboundMessage: true,
  });

describe("several first-message flows, routed by project", () => {
  beforeEach(() => {
    // The picker was created FIRST — before this change it always won.
    h.state.flows = [
      flow("picker", "2026-11-01", { entry_condition: { kind: "tag_group", group: "Project", test: "none" } }),
      flow("general", "2026-11-02", {}),
      flow("galleria-menu", "2026-11-03", { entry_condition: { kind: "tag", tag_id: "p-galleria" } }),
    ];
    h.state.nodes = [
      ...nodesFor("picker", "Which project?"),
      ...nodesFor("general", "Hi"),
      ...nodesFor("galleria-menu", "Galleria menu"),
    ];
    h.state.contactTags = [];
    h.state.startedFlowIds = [];
    h.state.sentTexts = [];
  });

  it("acceptance test 4: a contact with no project gets the picker first", async () => {
    await first("hi");
    expect(h.state.startedFlowIds).toEqual(["picker"]);
    expect(h.state.sentTexts).toEqual(["Which project?"]);
  });

  it("acceptance test 3: a contact tagged from the ad opens that project's menu", async () => {
    h.state.contactTags = [projectTag("p-galleria")];
    await first("hi");
    expect(h.state.startedFlowIds).toEqual(["galleria-menu"]);
  });

  it("falls back to the unconditional flow when no rule matches", async () => {
    h.state.contactTags = [projectTag("p-sky")];
    await first("hi");
    expect(h.state.startedFlowIds).toEqual(["general"]);
  });

  it("a message condition node reads the incoming text (case-insensitive)", async () => {
    h.state.flows = [flow("router", "2026-11-01", {})];
    h.state.nodes = [
      {
        id: "r1",
        flow_id: "router",
        node_key: "hello",
        node_type: "condition",
        config: { subject: "message", subject_key: "text", operator: "contains", value: "GAL", true_next: "gal", false_next: "other" },
      },
      { id: "r2", flow_id: "router", node_key: "gal", node_type: "send_message", config: { text: "Galleria!", next_node_key: "done" } },
      { id: "r3", flow_id: "router", node_key: "other", node_type: "send_message", config: { text: "Other", next_node_key: "done" } },
      { id: "r4", flow_id: "router", node_key: "done", node_type: "end", config: {} },
    ];
    await first("price for gal please");
    expect(h.state.sentTexts).toEqual(["Galleria!"]);
  });

  it("a tag-group condition node detects two projects", async () => {
    h.state.flows = [flow("router", "2026-11-01", {})];
    h.state.contactTags = [projectTag("p-a"), projectTag("p-b")];
    h.state.nodes = [
      {
        id: "r1",
        flow_id: "router",
        node_key: "hello",
        node_type: "condition",
        config: { subject: "tag_group", subject_key: "Project", group_test: "more_than_one", operator: "present", true_next: "many", false_next: "one" },
      },
      { id: "r2", flow_id: "router", node_key: "many", node_type: "send_message", config: { text: "Two projects", next_node_key: "done" } },
      { id: "r3", flow_id: "router", node_key: "one", node_type: "send_message", config: { text: "One project", next_node_key: "done" } },
      { id: "r4", flow_id: "router", node_key: "done", node_type: "end", config: {} },
    ];
    await first("hi");
    expect(h.state.sentTexts).toEqual(["Two projects"]);
  });

  it("a keyword menu flow with 'also on first message' serves a tagged contact's first chat and its button tap", async () => {
    h.state.flows = [
      flow("picker", "2026-11-01", { entry_condition: { kind: "tag_group", group: "Project", test: "none" } }),
      {
        ...flow("galleria-menu", "2026-11-03", {
          keywords: ["galleria menu"],
          also_first_message: true,
          entry_condition: { kind: "tag", tag_id: "p-galleria" },
        }),
        trigger_type: "keyword",
      },
    ];
    h.state.nodes = [...nodesFor("picker", "Which project?"), ...nodesFor("galleria-menu", "Galleria menu")];
    h.state.contactTags = [projectTag("p-galleria")];
    await first("hello");
    expect(h.state.startedFlowIds).toEqual(["galleria-menu"]);
    h.state.startedFlowIds = [];
    await dispatchInboundToFlows({
      accountId: "acct-1",
      userId: "u-1",
      contactId: "ct-1",
      conversationId: "cv-1",
      message: { kind: "interactive_reply", reply_id: "b1", reply_title: "Galleria menu", meta_message_id: "m-tap" },
      isFirstInboundMessage: false,
    });
    expect(h.state.startedFlowIds).toEqual(["galleria-menu"]);
  });
});
