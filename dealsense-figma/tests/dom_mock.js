// @ts-check
/**
 * Lightweight in-memory DOM Node implementation for testing content script extraction.
 */
export class MockNode {
  /**
   * @param {string} tagName
   * @param {Record<string, string>} [attributes]
   * @param {string} [textContent]
   */
  constructor(tagName, attributes = {}, textContent = "") {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this._textContent = textContent;
    /** @type {MockNode[]} */
    this.children = [];
    /** @type {MockNode | null} */
    this.parentElement = null;
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((c) => c.textContent).join(" ");
    }
    return this._textContent;
  }

  set textContent(val) {
    this._textContent = val;
    this.children = [];
  }

  /**
   * @param {string} name
   */
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  /**
   * @param {string} name
   * @param {string} value
   */
  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  /**
   * @param {MockNode} child
   */
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  /**
   * @param {string} selector
   * @returns {boolean}
   */
  matches(selector) {
    const parts = selector.trim().split(",").map((s) => s.trim());
    return parts.some((p) => this._matchesSingle(p));
  }

  /**
   * @param {string} selector
   * @returns {boolean}
   */
  _matchesSingle(selector) {
    const s = selector.trim();
    if (!s) return false;

    // Attribute exact: [attr="val"] or [attr='val']
    const attrExact = s.match(/^\[([a-zA-Z0-9_-]+)=["']?([^"'\]]*)["']?\]$/);
    if (attrExact) {
      return this.getAttribute(attrExact[1]) === attrExact[2];
    }

    // Attribute contains: [attr*="val"]
    const attrContains = s.match(/^\[([a-zA-Z0-9_-]+)\*=["']?([^"'\]]*)["']?\]$/);
    if (attrContains) {
      const val = this.getAttribute(attrContains[1]);
      return val !== null && val.includes(attrContains[2]);
    }

    // Attribute exists: [attr]
    const attrExists = s.match(/^\[([a-zA-Z0-9_-]+)\]$/);
    if (attrExists) {
      return this.getAttribute(attrExists[1]) !== null;
    }

    // Tag with attribute: e.g. span.a-text-price[data-a-strike="true"]
    if (s.includes("[") && s.endsWith("]") && s.indexOf("[") > 0) {
      const openIdx = s.indexOf("[");
      const baseSel = s.substring(0, openIdx);
      const attrSel = s.substring(openIdx);
      return this._matchesSingle(baseSel) && this._matchesSingle(attrSel);
    }

    // ID selector: #id
    if (s.startsWith("#")) {
      const id = s.slice(1);
      return this.getAttribute("id") === id;
    }

    // Class selector: .class1.class2
    if (s.startsWith(".")) {
      const classes = s.slice(1).split(".");
      const classAttr = this.getAttribute("class") || "";
      const classList = classAttr.split(/\s+/);
      return classes.every((c) => classList.includes(c));
    }

    // Tag + class: span.a-offscreen
    const tagClassMatch = s.match(/^([a-zA-Z0-9]+)\.(.+)$/);
    if (tagClassMatch) {
      const tag = tagClassMatch[1].toUpperCase();
      const classes = tagClassMatch[2].split(".");
      if (this.tagName !== tag) return false;
      const classAttr = this.getAttribute("class") || "";
      const classList = classAttr.split(/\s+/);
      return classes.every((c) => classList.includes(c));
    }

    // Tag selector: span, div
    if (/^[a-zA-Z0-9]+$/.test(s)) {
      return this.tagName === s.toUpperCase();
    }

    return false;
  }

  /**
   * @param {string} selector
   * @returns {MockNode | null}
   */
  querySelector(selector) {
    const list = this.querySelectorAll(selector);
    return list.length > 0 ? list[0] : null;
  }

  /**
   * @param {string} selector
   * @returns {MockNode[]}
   */
  querySelectorAll(selector) {
    if (selector.includes(",")) {
      const subSels = selector.split(",").map((s) => s.trim());
      /** @type {MockNode[]} */
      const results = [];
      for (const sub of subSels) {
        for (const node of this.querySelectorAll(sub)) {
          if (!results.includes(node)) results.push(node);
        }
      }
      return results;
    }

    const parts = selector.trim().split(/\s+/);
    if (parts.length > 1) {
      let currentSet = [this];
      for (const part of parts) {
        /** @type {MockNode[]} */
        const nextSet = [];
        for (const parent of currentSet) {
          const matched = parent._findAllDescendantsMatching(part);
          for (const m of matched) {
            if (!nextSet.includes(m)) nextSet.push(m);
          }
        }
        currentSet = nextSet;
      }
      return currentSet;
    }

    return this._findAllDescendantsMatching(selector);
  }

  /**
   * @param {string} selector
   * @returns {MockNode[]}
   */
  _findAllDescendantsMatching(selector) {
    /** @type {MockNode[]} */
    const results = [];
    const traverse = (/** @type {MockNode} */ node) => {
      for (const child of node.children) {
        if (child.matches(selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  /**
   * @param {string} selector
   * @returns {MockNode | null}
   */
  closest(selector) {
    /** @type {MockNode | null} */
    let cur = this;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
}

/**
 * Creates a root document node.
 */
export function createMockDocument() {
  const doc = new MockNode("#document");
  return doc;
}

/**
 * Parses raw HTML string into a MockNode DOM tree.
 * @param {string} html
 * @returns {MockNode}
 */
export function parseHtmlToMockDocument(html) {
  const root = new MockNode("#document");
  const tagRegex = /<\/?([a-zA-Z0-9_-]+)((?:\s+[^=>\/\s]+(?:=(?:\"[^\"]*\"|'[^']*'|[^>\s]+))?)*)\s*(\/?)>/g;

  let stack = [root];
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    const textBetween = html.substring(lastIndex, match.index).trim();
    if (textBetween && stack.length > 0) {
      const parent = stack[stack.length - 1];
      if (parent._textContent) parent._textContent += " " + textBetween;
      else parent._textContent = textBetween;
    }
    lastIndex = tagRegex.lastIndex;

    const [fullTag, tagName, attrString, isSelfClosing] = match;
    const isClosing = fullTag.startsWith("</");

    if (isClosing) {
      if (stack.length > 1 && stack[stack.length - 1].tagName === tagName.toUpperCase()) {
        stack.pop();
      }
    } else {
      const attrs = {};
      const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:\"([^\"]*)\"|'([^']*)'|([^>\s]+)))?/g;
      let aMatch;
      while ((aMatch = attrRegex.exec(attrString)) !== null) {
        attrs[aMatch[1]] = aMatch[2] !== undefined ? aMatch[2] : (aMatch[3] !== undefined ? aMatch[3] : (aMatch[4] || ""));
      }
      const node = new MockNode(tagName, attrs);
      stack[stack.length - 1].appendChild(node);
      const isVoid = isSelfClosing || ["INPUT", "IMG", "META", "BR", "HR"].includes(tagName.toUpperCase());
      if (!isVoid) {
        stack.push(node);
      }
    }
  }
  return root;
}
