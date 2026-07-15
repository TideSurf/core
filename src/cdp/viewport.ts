import { randomUUID } from "node:crypto";
import type { TideSurfOptions } from "../types.js";
import type { CDPConnection } from "./connection.js";
import { evaluate, MAX_DOM_NODES } from "./connection.js";
import { withTimeout } from "./timeout.js";

export interface ElementBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface VisibilityStyle {
  display?: string;
  visibility?: string;
  opacity?: string;
  clipPath?: string;
  contentVisibility?: string;
}

export interface PageInspection {
  url: string;
  title: string;
  scrollY: number;
  scrollHeight: number;
  viewportHeight: number;
  elementCount: number;
  markerAttributes: InspectionMarkerAttributes;
}

export interface InspectionMarkerAttributes {
  visible: string;
  hidden: string;
  state: string;
  text: string;
}

export function isComputedStyleHidden(style: VisibilityStyle): boolean {
  const opacity = Number.parseFloat(style.opacity ?? "1");
  const clipPath = (style.clipPath ?? "").replace(/\s+/g, "").toLowerCase();
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    style.contentVisibility === "hidden" ||
    (Number.isFinite(opacity) && opacity < 0.01) ||
    clipPath === "inset(100%)" ||
    clipPath === "circle(0)" ||
    clipPath === "circle(0px)" ||
    clipPath === "polygon(00,00,00)"
  );
}

export function intersectsViewport(
  rect: ElementBounds,
  viewportWidth: number,
  viewportHeight: number
): boolean {
  return (
    !(rect.width === 0 && rect.height === 0) &&
    rect.bottom >= 0 &&
    rect.top <= viewportHeight &&
    rect.right >= 0 &&
    rect.left <= viewportWidth
  );
}

export function intersectElementBounds(
  rect: ElementBounds,
  clip: ElementBounds,
  clipX: boolean = true,
  clipY: boolean = true
): ElementBounds | null {
  const left = clipX ? Math.max(rect.left, clip.left) : rect.left;
  const right = clipX ? Math.min(rect.right, clip.right) : rect.right;
  const top = clipY ? Math.max(rect.top, clip.top) : rect.top;
  const bottom = clipY ? Math.min(rect.bottom, clip.bottom) : rect.bottom;
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  return { top, bottom, left, right, width, height };
}

export async function applyViewport(
  conn: CDPConnection,
  viewport: NonNullable<TideSurfOptions["defaultViewport"]>,
  timeout?: number
): Promise<void> {
  await withTimeout(
    conn.Emulation.setDeviceMetricsOverride({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    }),
    timeout ?? 5_000,
    "applyViewport"
  );
}

export async function clearInspectionMarkers(
  conn: CDPConnection,
  markers: InspectionMarkerAttributes,
  timeout?: number
): Promise<void> {
  await evaluate(conn, `(() => {
  const names = ${JSON.stringify(Object.values(markers))};
  const stack = [document];
  while (stack.length > 0) {
    const root = stack.pop();
    const elements = root.nodeType === Node.DOCUMENT_NODE
      ? (root.documentElement ? [root.documentElement] : [])
      : Array.from(root.children);
    for (const first of elements) {
      const pending = [first];
      while (pending.length > 0) {
        const el = pending.pop();
        for (const name of names) {
          if (el.hasAttribute(name)) el.removeAttribute(name);
        }
        if (el.shadowRoot) stack.push(el.shadowRoot);
        if (el.tagName === 'IFRAME') {
          try { if (el.contentDocument) stack.push(el.contentDocument); } catch {}
        }
        for (const child of el.children) pending.push(child);
      }
    }
  }
})()`, timeout);
}

/**
 * Clear old parser markers, inspect visibility, and read page metadata in one
 * browser round trip. Visibility decisions are calculated before new marker
 * attributes are written so page CSS cannot react halfway through the pass.
 */
export async function inspectPage(
  conn: CDPConnection,
  options: { markViewport: boolean; markHidden: boolean },
  timeout?: number
): Promise<PageInspection> {
  const suffix = randomUUID().replaceAll("-", "");
  const markerAttributes: InspectionMarkerAttributes = {
    visible: `data-tidesurf-${suffix}-visible`,
    hidden: `data-tidesurf-${suffix}-hidden`,
    state: `data-tidesurf-${suffix}-state`,
    text: `data-tidesurf-${suffix}-text`,
  };
  const result = await evaluate(
    conn,
    `(() => {
  const page = {
    url: location.href,
    title: document.title,
    scrollY: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight
  };
  const markViewport = ${options.markViewport};
  const markHidden = ${options.markHidden};
  const markerVisible = ${JSON.stringify(markerAttributes.visible)};
  const markerHidden = ${JSON.stringify(markerAttributes.hidden)};
  const markerState = ${JSON.stringify(markerAttributes.state)};
  const markerText = ${JSON.stringify(markerAttributes.text)};
  const staleMarker = /^data-tidesurf-[0-9a-f]{32}-(?:visible|hidden|state|text)$/;
  const elementLimit = ${MAX_DOM_NODES};
  const hiddenByStyle = ${isComputedStyleHidden.toString()};
  const inViewport = ${intersectsViewport.toString()};
  const intersectBounds = ${intersectElementBounds.toString()};
  const elements = [];
  const stack = [];
  let overflow = false;

  const enqueue = el => {
    if (!el || el.nodeType !== Node.ELEMENT_NODE || overflow) return false;
    stack.push(el);
    if (elements.length + stack.length > elementLimit) {
      overflow = true;
      return false;
    }
    return true;
  };

  const pushRoot = root => {
    if (!root || overflow) return;
    if (root.nodeType === Node.DOCUMENT_NODE) {
      enqueue(root.documentElement);
    } else if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const child of root.children) {
        if (!enqueue(child)) break;
      }
    } else if (root.nodeType === Node.ELEMENT_NODE) {
      enqueue(root);
    }
  };

  pushRoot(document);
  while (stack.length > 0 && !overflow) {
    const el = stack.pop();
    if (!el || el.nodeType !== Node.ELEMENT_NODE) continue;
    for (let index = el.attributes.length - 1; index >= 0; index--) {
      const name = el.attributes[index].name;
      if (name.startsWith('data-tidesurf-') && staleMarker.test(name)) {
        el.removeAttribute(name);
      }
    }
    elements.push(el);

    if (el.shadowRoot) pushRoot(el.shadowRoot);
    if (el.tagName === 'IFRAME') {
      try {
        pushRoot(el.contentDocument);
      } catch {
        // Cross-origin frames have no inspectable document.
      }
    }
    for (const child of el.children) {
      if (!enqueue(child)) break;
    }
  }
  page.elementCount = overflow ? elementLimit + 1 : elements.length;

  const composedParent = el => {
    if (el.assignedSlot) return el.assignedSlot;
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    return root && root.host ? root.host : null;
  };

  const styleCache = new WeakMap();
  const computedStyle = el => {
    let style = styleCache.get(el);
    if (!style) {
      const view = el.ownerDocument.defaultView || window;
      style = view.getComputedStyle(el);
      styleCache.set(el, style);
    }
    return style;
  };

  // Cache each element's complete descendant clip region. Caching the region
  // inherited by an element would recalculate the same parent bounds once per
  // sibling, which is costly for large lists inside an overflow container.
  const descendantClipRegionCache = new WeakMap();
  const unboundedRegion = {
    top: -Infinity, bottom: Infinity,
    left: -Infinity, right: Infinity,
    width: Infinity, height: Infinity
  };
  const clipLength = (value, size) => {
    const token = value.trim().toLowerCase();
    const number = Number.parseFloat(token);
    if (!Number.isFinite(number)) return null;
    if (token.endsWith('%')) return size * number / 100;
    if (token.endsWith('px') || token === '0' || token === '-0') return number;
    return null;
  };
  const insetClipBounds = (value, bounds) => {
    const source = (value || '').trim();
    if (!source.toLowerCase().startsWith('inset(') || !source.endsWith(')')) {
      return null;
    }
    let body = source.slice(source.indexOf('(') + 1, -1).trim();
    const roundIndex = body.toLowerCase().indexOf(' round ');
    if (roundIndex >= 0) body = body.slice(0, roundIndex).trim();
    const tokens = body.split(/\\s+/).filter(Boolean);
    if (tokens.length < 1 || tokens.length > 4) return null;
    const expanded = tokens.length === 1
      ? [tokens[0], tokens[0], tokens[0], tokens[0]]
      : tokens.length === 2
        ? [tokens[0], tokens[1], tokens[0], tokens[1]]
        : tokens.length === 3
          ? [tokens[0], tokens[1], tokens[2], tokens[1]]
          : tokens;
    const topInset = clipLength(expanded[0], bounds.height);
    const rightInset = clipLength(expanded[1], bounds.width);
    const bottomInset = clipLength(expanded[2], bounds.height);
    const leftInset = clipLength(expanded[3], bounds.width);
    if ([topInset, rightInset, bottomInset, leftInset].some(item => item === null)) {
      return null;
    }
    const top = bounds.top + topInset;
    const right = bounds.right - rightInset;
    const bottom = bounds.bottom - bottomInset;
    const left = bounds.left + leftInset;
    return {
      top, right, bottom, left,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
  };
  const extendClipRegion = (inherited, ancestor) => {
    let region = inherited;
    if (!region) {
      return null;
    }

    const style = computedStyle(ancestor);
    const clipPath = (style.clipPath || '').replace(/\\s+/g, '').toLowerCase();
    const opacity = Number.parseFloat(style.opacity || '1');
    if (
      style.display === 'none' ||
      style.contentVisibility === 'hidden' ||
      (Number.isFinite(opacity) && opacity < 0.01) ||
      clipPath === 'inset(100%)' || clipPath === 'circle(0)' ||
      clipPath === 'circle(0px)' || clipPath === 'polygon(00,00,00)'
    ) {
      return null;
    }

    const overflowX = (style.overflowX || 'visible').toLowerCase();
    const overflowY = (style.overflowY || 'visible').toLowerCase();
    const clipX = overflowX !== 'visible';
    const clipY = overflowY !== 'visible';
    const clipsToBounds =
      (clipPath && clipPath !== 'none') ||
      (style.clip && style.clip !== 'auto' && style.clip !== 'none') ||
      /(?:^|\\s)paint(?:\\s|$)/.test(style.contain || '');

    if (clipX || clipY || clipsToBounds) {
      const bounds = ancestor.getBoundingClientRect();
      if (clipX || clipY) {
        const clientLeft = bounds.left + ancestor.clientLeft;
        const clientTop = bounds.top + ancestor.clientTop;
        const clientWidth = ancestor.clientWidth;
        const clientHeight = ancestor.clientHeight;
        region = intersectBounds(region, {
          left: clientLeft,
          right: clientLeft + clientWidth,
          top: clientTop,
          bottom: clientTop + clientHeight,
          width: clientWidth,
          height: clientHeight
        }, clipX, clipY);
      }
      if (region && clipsToBounds) {
        const shapeBounds = insetClipBounds(style.clipPath, bounds) || {
          top: bounds.top, bottom: bounds.bottom,
          left: bounds.left, right: bounds.right,
          width: bounds.width, height: bounds.height
        };
        region = intersectBounds(region, shapeBounds);
      }
    }

    return region;
  };

  const clipRegionThrough = element => {
    if (descendantClipRegionCache.has(element)) {
      return descendantClipRegionCache.get(element);
    }
    const unresolved = [];
    const visited = new Set();
    let current = element;
    while (current && !descendantClipRegionCache.has(current)) {
      if (visited.has(current)) {
        for (const item of unresolved) descendantClipRegionCache.set(item, null);
        return null;
      }
      visited.add(current);
      unresolved.push(current);
      current = composedParent(current);
    }

    let region = current
      ? descendantClipRegionCache.get(current)
      : unboundedRegion;
    for (let index = unresolved.length - 1; index >= 0; index--) {
      const item = unresolved[index];
      region = extendClipRegion(region, item);
      descendantClipRegionCache.set(item, region);
    }
    return descendantClipRegionCache.get(element);
  };

  const inheritedClipRegion = element => {
    const parent = composedParent(element);
    return parent ? clipRegionThrough(parent) : unboundedRegion;
  };

  const clipThroughAncestors = (initialRect, element) => {
    const region = inheritedClipRegion(element);
    return region ? intersectBounds(initialRect, region) : null;
  };

  const paintClipCache = new WeakMap();
  const hasPaintClip = element => {
    if (paintClipCache.has(element)) return paintClipCache.get(element);
    const unresolved = [];
    const visited = new Set();
    let current = element;
    while (current && !paintClipCache.has(current)) {
      if (visited.has(current)) {
        for (const item of unresolved) paintClipCache.set(item, false);
        return false;
      }
      visited.add(current);
      unresolved.push(current);
      current = composedParent(current);
    }
    let clipped = current ? paintClipCache.get(current) : false;
    for (let index = unresolved.length - 1; index >= 0; index--) {
      const item = unresolved[index];
      if (item.nodeType === Node.ELEMENT_NODE) {
        const clipPath = (computedStyle(item).clipPath || '').trim().toLowerCase();
        clipped ||= Boolean(clipPath && clipPath !== 'none');
      }
      paintClipCache.set(item, clipped);
    }
    return clipped;
  };

  const sampleFractions = [0.02, 0.25, 0.5, 0.75, 0.98];
  const paintedAtSample = (element, rect, view) => {
    const target = element.nodeType === Node.ELEMENT_NODE
      ? element
      : element.parentElement || element.getRootNode().host;
    if (!target || computedStyle(target).pointerEvents === 'none') return true;
    const root = target.getRootNode();
    const source = root && typeof root.elementsFromPoint === 'function'
      ? root
      : target.ownerDocument;
    if (!source || typeof source.elementsFromPoint !== 'function') return true;

    const left = Math.max(0, rect.left);
    const right = Math.min(view.innerWidth, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(view.innerHeight, rect.bottom);
    if (right <= left || bottom <= top) return false;
    for (const yFraction of sampleFractions) {
      const y = top + (bottom - top) * yFraction;
      for (const xFraction of sampleFractions) {
        const x = left + (right - left) * xFraction;
        const hits = source.elementsFromPoint(x, y);
        if (hits.some(hit => hit === target || target.contains(hit))) return true;
      }
    }
    return false;
  };

  const visibleThroughFrames = (initialRect, view, element) => {
    let rect = clipThroughAncestors(initialRect, element);
    if (!rect) return false;
    let current = view;
    if (!inViewport(rect, current.innerWidth, current.innerHeight)) return false;
    if (hasPaintClip(element) && !paintedAtSample(element, rect, current)) {
      return false;
    }
    while (current && current !== window) {
      const frame = current.frameElement;
      if (!frame) return false;
      const parentView = frame.ownerDocument.defaultView || window;
      const frameStyle = computedStyle(frame);
      if (hiddenByStyle(frameStyle)) return false;
      const frameRect = frame.getBoundingClientRect();
      const translated = {
        top: frameRect.top + frame.clientTop + rect.top,
        bottom: frameRect.top + frame.clientTop + rect.bottom,
        left: frameRect.left + frame.clientLeft + rect.left,
        right: frameRect.left + frame.clientLeft + rect.right
      };
      const contentLeft = frameRect.left + frame.clientLeft;
      const contentTop = frameRect.top + frame.clientTop;
      rect = intersectBounds(translated, {
        top: contentTop,
        bottom: contentTop + frame.clientHeight,
        left: contentLeft,
        right: contentLeft + frame.clientWidth,
        width: frame.clientWidth,
        height: frame.clientHeight
      });
      if (!rect) return false;
      rect = clipThroughAncestors(rect, frame);
      if (!rect) return false;
      if (!inViewport(rect, parentView.innerWidth, parentView.innerHeight)) return false;
      if (hasPaintClip(frame) && !paintedAtSample(frame, rect, parentView)) {
        return false;
      }
      current = parentView;
    }
    return true;
  };

  const decisions = [];
  const visibleDirectText = (parent, view) => {
    let indices;
    let range;
    for (let index = 0; index < parent.childNodes.length; index++) {
      const child = parent.childNodes[index];
      if (child.nodeType !== Node.TEXT_NODE || !child.nodeValue.trim()) continue;
      try {
        range ||= parent.ownerDocument.createRange();
        range.selectNodeContents(child);
        const rects = range.getClientRects();
        for (let rectIndex = 0; rectIndex < rects.length; rectIndex++) {
          if (visibleThroughFrames(rects[rectIndex], view, child)) {
            (indices ||= []).push(index);
            break;
          }
        }
      } catch {
        // Ignore text nodes without range geometry.
      }
    }
    return indices ? indices.join(',') : '';
  };
  const hiddenSubtrees = new WeakSet();
  if (!overflow && (markViewport || markHidden)) for (const el of elements) {
    const parent = composedParent(el);
    const frame = !parent && el === el.ownerDocument.documentElement
      ? el.ownerDocument.defaultView && el.ownerDocument.defaultView.frameElement
      : null;
    if ((parent && hiddenSubtrees.has(parent)) || (frame && hiddenSubtrees.has(frame))) {
      hiddenSubtrees.add(el);
      continue;
    }
    const view = el.ownerDocument.defaultView || window;
    const style = computedStyle(el);
    const hidden = hiddenByStyle(style);
    const clipPath = (style.clipPath || '').replace(/\\s+/g, '').toLowerCase();
    const subtreeHidden = hidden && (
      el.tagName === 'IFRAME' ||
      style.display === 'none' ||
      style.contentVisibility === 'hidden' ||
      Number.parseFloat(style.opacity || '1') < 0.01 ||
      clipPath === 'inset(100%)' || clipPath === 'circle(0)' ||
      clipPath === 'circle(0px)' || clipPath === 'polygon(00,00,00)'
    );
    if (subtreeHidden) hiddenSubtrees.add(el);
    let visible = false;
    let state = '';
    let visibleText = '';
    let visibleShadowText = '';

    if (markViewport && !hidden) {
      let rect = el.getBoundingClientRect();
      visible = visibleThroughFrames(rect, view, el);
      if (!visible && style.display === 'contents') {
        try {
          const range = el.ownerDocument.createRange();
          range.selectNodeContents(el);
          const contentRect = range.getBoundingClientRect();
          if (visibleThroughFrames(contentRect, view, el)) {
            rect = contentRect;
            visible = true;
          }
        } catch {
          // Some document implementations do not expose range geometry.
        }
      }

      visibleText = visibleDirectText(el, view);
      if (el.shadowRoot) {
        visibleShadowText = visibleDirectText(el.shadowRoot, view);
      }

      if (visible && el.matches('a, button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="listbox"]')) {
        const states = [];
        if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') {
          states.push('disabled');
        }
        if (style.pointerEvents === 'none' || el.closest('[inert]')) {
          states.push('inert');
        }

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        if (centerX >= 0 && centerX <= view.innerWidth && centerY >= 0 && centerY <= view.innerHeight) {
          const top = el.ownerDocument.elementFromPoint(centerX, centerY);
          if (top && top !== el && !el.contains(top) && !top.contains(el)) {
            states.push('obscured');
          }
        }
        state = states.join(',');
      }
    }

    const hiddenMarker = markHidden && hidden
      ? (subtreeHidden ? 'subtree' : 'self')
      : '';
    if (hiddenMarker || visible || state || visibleText || visibleShadowText) {
      decisions.push({
        el,
        hidden: hiddenMarker,
        visible,
        state,
        visibleText,
        visibleShadowText
      });
    }
  }

  for (const decision of decisions) {
    if (decision.hidden) {
      decision.el.setAttribute(markerHidden, decision.hidden);
    }
    if (decision.visible) {
      decision.el.setAttribute(markerVisible, '1');
    }
    if (decision.state) {
      decision.el.setAttribute(markerState, decision.state);
    }
    if (decision.visibleText || decision.visibleShadowText) {
      decision.el.setAttribute(
        markerText,
        decision.visibleText + '|' + decision.visibleShadowText
      );
    }
  }
  return page;
})()`,
    timeout
  );
  return { ...(result as Omit<PageInspection, "markerAttributes">), markerAttributes };
}
