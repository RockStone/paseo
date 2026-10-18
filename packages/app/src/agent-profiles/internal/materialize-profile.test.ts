import {
  findActiveProfileMention,
  filterProfileReferences,
  appendProfileReference,
  profileReferenceToAgentAttachment,
} from "../profile-reference";
import { findActiveFileMention } from "@/utils/file-mention-autocomplete";
import { UserComposerAttachmentSchema } from "@/stores/draft-store/state";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import { describe, expect, it } from "vitest";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import {
  materializeAgentProfile,
  reconcileMaterializedProfileMode,
  toAgentConfigApply,
} from "./materialize-profile";

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "ui-work",
    name: "UI work",
    provider: "claude",
    ...overrides,
  };
}

describe("materializeAgentProfile", () => {
  it("resolves every field a full profile names", () => {
    expect(
      materializeAgentProfile(
        profile({
          model: "claude-opus-5",
          modeId: "plan",
          thinkingOptionId: "think-hard",
          featureValues: { web_search: true },
        }),
      ),
    ).toEqual({
      provider: "claude",
      modelId: "claude-opus-5",
      modeId: "plan",
      thinkingOptionId: "think-hard",
      featureValues: { web_search: true },
    });
  });

  it("treats omitted and blank fields the same", () => {
    expect(materializeAgentProfile(profile({ model: "   ", modeId: "" }))).toEqual({
      provider: "claude",
      modelId: "",
      modeId: "",
      thinkingOptionId: "",
      featureValues: {},
    });
  });

  it("trims stored ids", () => {
    expect(materializeAgentProfile(profile({ model: " claude-opus-5 " })).modelId).toBe(
      "claude-opus-5",
    );
  });
});

describe("toAgentConfigApply", () => {
  it("sends every value the profile names", () => {
    expect(
      toAgentConfigApply(
        materializeAgentProfile(
          profile({
            model: "claude-opus-5",
            modeId: "plan",
            thinkingOptionId: "think-hard",
            featureValues: { web_search: true },
          }),
        ),
      ),
    ).toEqual({
      modelId: "claude-opus-5",
      modeId: "plan",
      thinkingOptionId: "think-hard",
      featureValues: { web_search: true },
    });
  });

  it("omits what the profile leaves alone rather than clearing it", () => {
    expect(toAgentConfigApply(materializeAgentProfile(profile({ modeId: "plan" })))).toEqual({
      modeId: "plan",
    });
  });

  it("omits an empty feature map so the agent keeps its own feature values", () => {
    expect(
      toAgentConfigApply(materializeAgentProfile(profile({ featureValues: {} }))),
    ).not.toHaveProperty("featureValues");
  });

  it("never carries a provider, which a running agent cannot change", () => {
    expect(
      toAgentConfigApply(materializeAgentProfile(profile({ model: "claude-opus-5" }))),
    ).not.toHaveProperty("provider");
  });
});

describe("reconcileMaterializedProfileMode", () => {
  it("waits when the current provider mode catalog is unknown", () => {
    expect(
      reconcileMaterializedProfileMode(materializeAgentProfile(profile({ modeId: "plan" })), null),
    ).toBeNull();
  });

  it("drops a profile mode removed from the current provider catalog", () => {
    expect(
      reconcileMaterializedProfileMode(
        materializeAgentProfile(profile({ modeId: "removed-mode" })),
        ["plan", "default"],
      ),
    ).toMatchObject({ modeId: "" });
  });

  it("preserves a profile mode still offered by the provider", () => {
    expect(
      reconcileMaterializedProfileMode(materializeAgentProfile(profile({ modeId: "plan" })), [
        "plan",
        "default",
      ]),
    ).toMatchObject({ modeId: "plan" });
  });
});

describe("composer profile references", () => {
  it("distinguishes @@ profiles from @ files and uses the current cursor", () => {
    const text = "Delegate @@opus then review";
    const cursorIndex = text.indexOf(" then");
    expect(findActiveProfileMention({ text, cursorIndex })).toEqual({
      start: 9,
      end: 15,
      query: "opus",
    });
    expect(findActiveFileMention({ text, cursorIndex })).toBeNull();
    expect(findActiveProfileMention({ text: "@src", cursorIndex: 4 })).toBeNull();
    expect(findActiveProfileMention({ text: "email@@opus", cursorIndex: 11 })).toBeNull();
    expect(findActiveProfileMention({ text: "@@opus task", cursorIndex: 11 })).toBeNull();
    expect(findActiveFileMention({ text: "@src", cursorIndex: 4 })).toEqual({
      start: 0,
      end: 4,
      query: "src",
    });
  });

  it("filters all providers and replaces duplicate host/profile snapshots", () => {
    const opus = profile({ name: "Opus", model: "opus-5.5", notes: "Use a worktree" });
    const codex = profile({
      id: "codex",
      name: "Implementation",
      provider: "codex",
      model: "gpt-6.1-sol",
    });
    expect(filterProfileReferences([opus, codex], "GPT")).toEqual([codex]);
    expect(filterProfileReferences([opus, codex], "worktree")).toEqual([opus]);
    const selected = { kind: "agent_profile" as const, serverId: "local", profile: opus };
    const updated = { ...selected, profile: { ...opus, notes: "Updated notes" } };
    expect(appendProfileReference([selected], updated)).toEqual([updated]);
    expect(appendProfileReference([selected], { ...selected, serverId: "other" })).toEqual([
      selected,
      { ...selected, serverId: "other" },
    ]);
  });

  it("persists the selected snapshot and sends exact launch fields plus notes as context", () => {
    const selected = {
      kind: "agent_profile" as const,
      serverId: "local",
      profile: profile({
        model: "opus-5.5",
        modeId: "auto",
        thinkingOptionId: "medium",
        featureValues: { web_search: true },
        icon: "code",
        color: "red",
        notes: "Use a separate worktree from origin/dev.",
      }),
    };
    expect(UserComposerAttachmentSchema.parse(JSON.parse(JSON.stringify(selected)))).toEqual(
      selected,
    );
    const wire = splitComposerAttachmentsForSubmit([selected]);
    expect(wire.images).toEqual([]);
    expect(wire.attachments).toHaveLength(1);
    expect(wire.attachments[0]).toEqual({
      type: "text",
      title: "Agent profile · UI work",
      mimeType: "text/plain",
      text: expect.stringContaining('"model": "opus-5.5"'),
    });
    const reference = profileReferenceToAgentAttachment(selected);
    const settings = reference.text.split("Launch settings:\n")[1]!.split("\n\nProfile notes:")[0]!;
    expect(JSON.parse(settings)).toEqual({
      provider: "claude",
      model: "opus-5.5",
      modeId: "auto",
      thinkingOptionId: "medium",
      featureValues: { web_search: true },
    });
    expect(reference.text).toContain(selected.profile.notes);
    expect(reference.text).toContain("There is no profile parameter");
  });
});
