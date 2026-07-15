import {
  intersectElementBounds,
  intersectsViewport,
  isComputedStyleHidden,
} from "../../src/cdp/viewport.js";

const viewport = { width: 1280, height: 720 };
const visibleRect = {
  top: 100,
  bottom: 200,
  left: 50,
  right: 250,
  width: 200,
  height: 100,
};

describe("intersectsViewport", () => {
  it("accepts fully and partially visible bounds", () => {
    expect(intersectsViewport(visibleRect, viewport.width, viewport.height)).toBe(true);
    expect(
      intersectsViewport(
        { top: -50, bottom: 0, left: 0, right: 100, width: 100, height: 50 },
        viewport.width,
        viewport.height
      )
    ).toBe(true);
  });

  it("rejects zero-size and off-screen bounds", () => {
    expect(
      intersectsViewport(
        { top: 100, bottom: 100, left: 100, right: 100, width: 0, height: 0 },
        viewport.width,
        viewport.height
      )
    ).toBe(false);
    expect(
      intersectsViewport(
        { top: 721, bottom: 900, left: 0, right: 100, width: 100, height: 179 },
        viewport.width,
        viewport.height
      )
    ).toBe(false);
  });
});

describe("intersectElementBounds", () => {
  it("rejects descendants outside an ancestor clip", () => {
    expect(
      intersectElementBounds(
        { top: 300, bottom: 340, left: 0, right: 100, width: 100, height: 40 },
        { top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100 }
      )
    ).toBeNull();
  });

  it("clips only the requested overflow axis", () => {
    expect(
      intersectElementBounds(
        { top: 300, bottom: 340, left: 50, right: 150, width: 100, height: 40 },
        { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 },
        true,
        false
      )
    ).toEqual({
      top: 300,
      bottom: 340,
      left: 50,
      right: 100,
      width: 50,
      height: 40,
    });
  });
});

describe("isComputedStyleHidden", () => {
  it.each([
    { display: "none" },
    { visibility: "hidden" },
    { visibility: "collapse" },
    { contentVisibility: "hidden" },
    { opacity: "0" },
    { opacity: "0.001" },
    { clipPath: "inset(100%)" },
    { clipPath: "circle(0px)" },
    { clipPath: "polygon(0 0, 0 0, 0 0)" },
  ])("recognizes a computed hiding style", (style) => {
    expect(isComputedStyleHidden(style)).toBe(true);
  });

  it("keeps normal styles and the opacity threshold", () => {
    expect(
      isComputedStyleHidden({
        display: "block",
        visibility: "visible",
        opacity: "0.01",
        clipPath: "none",
      })
    ).toBe(false);
  });
});
