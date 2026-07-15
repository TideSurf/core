import { describe, expect, it } from "bun:test";
import { releaseMetadataFailures } from "../../scripts/check-release.js";
import { VERSION } from "../../src/version.js";

describe("release metadata", () => {
  it("rejects a tag while changes remain under Unreleased", () => {
    const tag = `v${VERSION}`;
    const failures = releaseMetadataFailures(tag);
    expect(failures).toContain(
      `CHANGELOG.md must have an empty Unreleased section for ${tag}`
    );
    expect(failures).toContain(
      `website/docs/content/changelog.md must have an empty Unreleased section for ${tag}`
    );
  });
});
