import { describe, expect, it } from "bun:test";
import {
  type ReleaseMetadata,
  releaseMetadataFailures,
} from "../../scripts/check-release.js";

const version = "0.6.0";
const tag = `v${version}`;
const validChangelog = `# Changelog

## Unreleased

## ${version} (2026-07-16)

- Ready.
`;

function metadata(source = validChangelog): ReleaseMetadata {
  return {
    packageVersion: version,
    sourceVersion: version,
    changelogs: [
      { path: "CHANGELOG.md", source },
      { path: "website/docs/content/changelog.md", source },
    ],
  };
}

describe("release metadata", () => {
  it("accepts finalized synthetic metadata", () => {
    expect(releaseMetadataFailures(tag, metadata())).toEqual([]);
  });

  it("validates the live package without requiring a release tag", () => {
    expect(releaseMetadataFailures()).toEqual([]);
  });

  it("rejects a tag that differs from the package version", () => {
    expect(releaseMetadataFailures("v9.9.9", metadata())).toContain(
      `release tag v9.9.9 must be ${tag}`
    );
  });

  it("rejects source and package version drift", () => {
    const fixture = metadata();
    fixture.sourceVersion = "0.5.4";
    expect(releaseMetadataFailures(undefined, fixture)).toContain(
      `src/version.ts has 0.5.4; package.json has ${version}`
    );
  });

  it("rejects duplicate or missing release headings", () => {
    const duplicate = `${validChangelog}\n## ${version} (2026-07-16)\n`;
    expect(releaseMetadataFailures(tag, metadata(duplicate))).toContain(
      `CHANGELOG.md must contain one dated ${version} release heading`
    );
    expect(
      releaseMetadataFailures(tag, metadata("# Changelog\n\n## Unreleased\n"))
    ).toContain(`CHANGELOG.md must contain one dated ${version} release heading`);
  });

  it("rejects invalid release dates", () => {
    const invalidDate = validChangelog.replace("2026-07-16", "2026-02-31");
    expect(releaseMetadataFailures(tag, metadata(invalidDate))).toContain(
      `CHANGELOG.md has an invalid ${version} release date`
    );
  });

  it("rejects missing or duplicate Unreleased headings", () => {
    const missing = validChangelog.replace("## Unreleased\n\n", "");
    const duplicate = validChangelog.replace(
      "## Unreleased\n\n",
      "## Unreleased\n\n## Unreleased\n\n"
    );
    expect(releaseMetadataFailures(tag, metadata(missing))).toContain(
      "CHANGELOG.md must contain one Unreleased heading"
    );
    expect(releaseMetadataFailures(tag, metadata(duplicate))).toContain(
      "CHANGELOG.md must contain one Unreleased heading"
    );
  });

  it("rejects a tag while changes remain under Unreleased", () => {
    const unreleased = validChangelog.replace(
      "## Unreleased\n",
      "## Unreleased\n\n- Pending.\n"
    );
    const failures = releaseMetadataFailures(tag, metadata(unreleased));
    expect(failures).toContain(
      `CHANGELOG.md must have an empty Unreleased section for ${tag}`
    );
    expect(failures).toContain(
      `website/docs/content/changelog.md must have an empty Unreleased section for ${tag}`
    );
  });
});
