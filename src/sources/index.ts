import { codexSource } from "./codex.js";
import { opencodeSource } from "./opencode.js";
import type { LocalSessionSource, SessionSourceId } from "./types.js";

export const implementedSources: Record<Exclude<SessionSourceId, "claude">, LocalSessionSource> = {
  codex: codexSource,
  opencode: opencodeSource,
};

export const knownSourceIds: SessionSourceId[] = ["codex", "opencode", "claude"];

export function isKnownSourceId(value: string): value is SessionSourceId {
  return knownSourceIds.includes(value as SessionSourceId);
}
