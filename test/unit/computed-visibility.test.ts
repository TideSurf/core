
// ---------------------------------------------------------------------------
// Since markVisibleElements runs as injected JS inside the browser, we cannot
// unit-test the actual CDP function without Chrome. Instead, we test the
// LOGIC that determines visibility by extracting the decision criteria into
// a pure function that mirrors the browser-side code.
//
// This test file:
// 1. Defines the visibility logic as a pure function (matching the injected code)
// 2. Tests each visibility condition independently
// 3. Serves as a spec for the computed visibility feature on the parallel branch
// ---------------------------------------------------------------------------

/**
 * Simulated bounding rect for testing.
 */
interface MockRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

/**
 * Simulated computed style for testing.
 */
interface MockComputedStyle {
  opacity?: string;
  visibility?: string;
  display?: string;
  clipPath?: string;
  pointerEvents?: string;
}

/**
 * Pure function that mirrors the visibility determination logic.
 * The parallel branch will add computed style checks to markVisibleElements.
 * This function captures the expected logic.
 */
function isElementVisible(
  rect: MockRect,
  viewportWidth: number,
  viewportHeight: number,
  computedStyle?: MockComputedStyle
): boolean {
  // Zero-size element is not visible
  if (rect.width === 0 && rect.height === 0) {
    return false;
  }

  // Outside viewport bounds
  if (
    rect.bottom < 0 ||
    rect.top > viewportHeight ||
    rect.right < 0 ||
    rect.left > viewportWidth
  ) {
    return false;
  }

  // Computed style checks (new feature from parallel branch)
  if (computedStyle) {
    // opacity: 0 or very close to 0 means invisible
    if (computedStyle.opacity !== undefined) {
      const opacity = parseFloat(computedStyle.opacity);
      if (!isNaN(opacity) && opacity < 0.01) {
        return false;
      }
    }

    // visibility: hidden or collapse means invisible
    if (computedStyle.visibility === "hidden" || computedStyle.visibility === "collapse") {
      return false;
    }

    // display: none means invisible
    if (computedStyle.display === "none") {
      return false;
    }

    // clip-path: inset(100%) means fully clipped away
    if (computedStyle.clipPath === "inset(100%)") {
      return false;
    }
  }

  return true;
}

/**
 * Determines the computed state flags for an element.
 * The parallel branch sets data-os-state with flags like "disabled", "obscured", "inert".
 */
function computeStateFlags(
  computedStyle?: MockComputedStyle,
  isDisabled?: boolean,
  isInert?: boolean
): string[] {
  const flags: string[] = [];

  if (isDisabled) {
    flags.push("disabled");
  }

  // pointer-events: none → inert (can't interact)
  if (computedStyle?.pointerEvents === "none") {
    flags.push("inert");
  }

  // HTML inert attribute → also inert (deduplicate with pointer-events check)
  if (isInert && !flags.includes("inert")) {
    flags.push("inert");
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Viewport and bounding rect tests
// ---------------------------------------------------------------------------

describe("computed visibility — viewport bounds", () => {
  const VW = 1280;
  const VH = 720;

  it("element fully in viewport is visible", () => {
    const rect: MockRect = { top: 100, bottom: 200, left: 50, right: 250, width: 200, height: 100 };
    expect(isElementVisible(rect, VW, VH)).toBe(true);
  });

  it("element partially in viewport (top clipped) is visible", () => {
    const rect: MockRect = { top: -50, bottom: 50, left: 0, right: 100, width: 100, height: 100 };
    expect(isElementVisible(rect, VW, VH)).toBe(true);
  });

  it("element partially in viewport (bottom clipped) is visible", () => {
    const rect: MockRect = { top: 680, bottom: 780, left: 0, right: 100, width: 100, height: 100 };
    expect(isElementVisible(rect, VW, VH)).toBe(true);
  });

  it("element fully above viewport is not visible", () => {
    const rect: MockRect = { top: -200, bottom: -10, left: 0, right: 100, width: 100, height: 190 };
    expect(isElementVisible(rect, VW, VH)).toBe(false);
  });

  it("element fully below viewport is not visible", () => {
    const rect: MockRect = { top: 721, bottom: 900, left: 0, right: 100, width: 100, height: 179 };
    expect(isElementVisible(rect, VW, VH)).toBe(false);
  });

  it("element fully to the left of viewport is not visible", () => {
    const rect: MockRect = { top: 100, bottom: 200, left: -300, right: -10, width: 290, height: 100 };
    expect(isElementVisible(rect, VW, VH)).toBe(false);
  });

  it("element fully to the right of viewport is not visible", () => {
    const rect: MockRect = { top: 100, bottom: 200, left: 1281, right: 1500, width: 219, height: 100 };
    expect(isElementVisible(rect, VW, VH)).toBe(false);
  });

  it("zero-size element is not visible", () => {
    const rect: MockRect = { top: 100, bottom: 100, left: 100, right: 100, width: 0, height: 0 };
    expect(isElementVisible(rect, VW, VH)).toBe(false);
  });

  it("element touching viewport edge (bottom=0) is visible", () => {
    // bottom >= 0, so an element touching the top edge is still in viewport
    const rect: MockRect = { top: -50, bottom: 0, left: 0, right: 100, width: 100, height: 50 };
    expect(isElementVisible(rect, VW, VH)).toBe(true);
  });

  it("element touching viewport edge (top=vh) is visible", () => {
    const rect: MockRect = { top: 720, bottom: 800, left: 0, right: 100, width: 100, height: 80 };
    expect(isElementVisible(rect, VW, VH)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Computed style checks (new feature)
// ---------------------------------------------------------------------------

describe("computed visibility — opacity", () => {
  const VW = 1280;
  const VH = 720;
  const inViewport: MockRect = { top: 100, bottom: 200, left: 50, right: 250, width: 200, height: 100 };

  it("element with opacity:0 is NOT visible", () => {
    expect(isElementVisible(inViewport, VW, VH, { opacity: "0" })).toBe(false);
  });

  it("element with opacity:0.001 is NOT visible (below 0.01 threshold)", () => {
    expect(isElementVisible(inViewport, VW, VH, { opacity: "0.001" })).toBe(false);
  });

  it("element with opacity:0.5 is visible (above threshold)", () => {
    expect(isElementVisible(inViewport, VW, VH, { opacity: "0.5" })).toBe(true);
  });

  it("element with opacity:1 is visible", () => {
    expect(isElementVisible(inViewport, VW, VH, { opacity: "1" })).toBe(true);
  });

  it("element with opacity:0.01 is visible (at threshold)", () => {
    expect(isElementVisible(inViewport, VW, VH, { opacity: "0.01" })).toBe(true);
  });
});

describe("computed visibility — visibility property", () => {
  const VW = 1280;
  const VH = 720;
  const inViewport: MockRect = { top: 100, bottom: 200, left: 50, right: 250, width: 200, height: 100 };

  it("element with visibility:hidden is NOT visible", () => {
    expect(isElementVisible(inViewport, VW, VH, { visibility: "hidden" })).toBe(false);
  });

  it("element with visibility:collapse is NOT visible", () => {
    expect(isElementVisible(inViewport, VW, VH, { visibility: "collapse" })).toBe(false);
  });

  it("element with visibility:visible is visible", () => {
    expect(isElementVisible(inViewport, VW, VH, { visibility: "visible" })).toBe(true);
  });

  it("element with no explicit visibility is visible", () => {
    expect(isElementVisible(inViewport, VW, VH, {})).toBe(true);
  });
});

describe("computed visibility — display property", () => {
  const VW = 1280;
  const VH = 720;
  const inViewport: MockRect = { top: 100, bottom: 200, left: 50, right: 250, width: 200, height: 100 };

  it("element with display:none is NOT visible", () => {
    expect(isElementVisible(inViewport, VW, VH, { display: "none" })).toBe(false);
  });

  it("element with display:block is visible", () => {
    expect(isElementVisible(inViewport, VW, VH, { display: "block" })).toBe(true);
  });

  it("element with display:flex is visible", () => {
    expect(isElementVisible(inViewport, VW, VH, { display: "flex" })).toBe(true);
  });
});

describe("computed visibility — clip-path", () => {
  const VW = 1280;
  const VH = 720;
  const inViewport: MockRect = { top: 100, bottom: 200, left: 50, right: 250, width: 200, height: 100 };

  it("element with clip-path:inset(100%) is NOT visible", () => {
    expect(isElementVisible(inViewport, VW, VH, { clipPath: "inset(100%)" })).toBe(false);
  });

  it("element with no clip-path is visible", () => {
    expect(isElementVisible(inViewport, VW, VH, {})).toBe(true);
  });
});

describe("computed visibility — combined conditions", () => {
  const VW = 1280;
  const VH = 720;
  const inViewport: MockRect = { top: 100, bottom: 200, left: 50, right: 250, width: 200, height: 100 };
  const outsideViewport: MockRect = { top: 800, bottom: 900, left: 0, right: 100, width: 100, height: 100 };

  it("element outside viewport with normal styles is still not visible", () => {
    expect(isElementVisible(outsideViewport, VW, VH, { opacity: "1", visibility: "visible" })).toBe(false);
  });

  it("element in viewport with all normal styles is visible", () => {
    expect(
      isElementVisible(inViewport, VW, VH, {
        opacity: "1",
        visibility: "visible",
        display: "block",
      })
    ).toBe(true);
  });

  it("element in viewport but opacity:0 is not visible", () => {
    expect(
      isElementVisible(inViewport, VW, VH, {
        opacity: "0",
        visibility: "visible",
        display: "block",
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// State flags (data-os-state)
// ---------------------------------------------------------------------------

describe("computed state flags", () => {
  it("disabled element gets 'disabled' flag", () => {
    expect(computeStateFlags({}, true)).toEqual(["disabled"]);
  });

  it("pointer-events:none gets 'inert' flag", () => {
    expect(computeStateFlags({ pointerEvents: "none" })).toEqual(["inert"]);
  });

  it("inert element gets 'inert' flag", () => {
    expect(computeStateFlags({}, false, true)).toEqual(["inert"]);
  });

  it("disabled + pointer-events:none gets both flags", () => {
    expect(computeStateFlags({ pointerEvents: "none" }, true)).toEqual([
      "disabled",
      "inert",
    ]);
  });

  it("all flags combined", () => {
    expect(computeStateFlags({ pointerEvents: "none" }, true, true)).toEqual([
      "disabled",
      "inert",
    ]);
  });

  it("no flags for normal element", () => {
    expect(computeStateFlags({}, false, false)).toEqual([]);
  });

  it("no flags when computedStyle is undefined", () => {
    expect(computeStateFlags(undefined, false, false)).toEqual([]);
  });

  it("element inside [inert] ancestor gets 'inert' flag", () => {
    // The isInert parameter simulates an element inside an [inert] ancestor.
    // In the real browser, this would be detected via el.closest('[inert]').
    // Full closest('[inert]') simulation requires integration testing with a real DOM;
    // here we test the flag logic in isolation.
    expect(computeStateFlags({}, false, true)).toEqual(["inert"]);
  });
});
