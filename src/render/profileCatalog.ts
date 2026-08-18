import type { Profile2DDef } from "../content/schema";
import type { InfrastructureType, Segment } from "../engine/map/types";

// The bootstrap layer's job (architecture.md hard rule 2): mapping loaded
// content onto engine facts. `engine/map` generates the inherited network
// without knowing content exists, so its segments carry no profileId at
// all -- the brownfield spine is "some pre-built roads and a colonial rail
// line", not "roads built to profile trunk-road".
//
// Resolution is therefore by *fallback*, not by stamping ids onto the
// generated map: a segment with no profile, or one naming a profile that
// has since been removed from content, still renders and still decays. A
// missing profile must degrade, never blank the map.
export interface ProfileCatalog {
  byId: ReadonlyMap<string, Profile2DDef>;
  /** What inherited infrastructure of each type was built to. */
  inheritedDefaults: Readonly<Record<InfrastructureType, string>>;
  resolve: (segment: Segment) => Profile2DDef | undefined;
  /** Profiles a player may build with, for one infrastructure type. */
  buildable: (type: InfrastructureType) => Profile2DDef[];
  /** profileId -> decayRateMultiplier, the plain-number map engine/ takes. */
  decayMultipliers: ReadonlyMap<string, number>;
}

export function createProfileCatalog(
  profiles: Profile2DDef[],
  inheritedDefaults: Record<InfrastructureType, string>,
): ProfileCatalog {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const decayMultipliers = new Map(profiles.map((profile) => [profile.id, profile.decayRateMultiplier]));

  function resolve(segment: Segment): Profile2DDef | undefined {
    if (segment.profileId !== undefined) {
      const named = byId.get(segment.profileId);
      if (named) return named;
    }
    return byId.get(inheritedDefaults[segment.type]);
  }

  function buildable(type: InfrastructureType): Profile2DDef[] {
    return profiles.filter((profile) => profile.surfaceType === type);
  }

  return { byId, inheritedDefaults, resolve, buildable, decayMultipliers };
}
