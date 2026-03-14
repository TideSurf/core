import re

html_path = 'website/landing/index.html'
with open(html_path, 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Update hero-bg-pattern
bg_pattern_regex = r'<div class="hero-bg-pattern".*?</div>\s*</div>'
new_bg = """<div class="hero-bg-pattern" aria-hidden="true">
            <div class="bg-line">&lt;<span class="bg-hl">button</span> name="goog"&gt;<span class="bg-hl">Log in with Google</span>&lt;/<span class="bg-hl">button</span>&gt;</div>
            <div class="bg-line">&lt;<span class="bg-hl">nav</span> class="sidebar" role="navigation"&gt;&lt;<span class="bg-hl">ul</span>&gt;&lt;<span class="bg-hl">li</span>&gt;&lt;<span class="bg-hl">a</span> href="/settings"&gt;<span class="bg-hl">Settings</span>&lt;/<span class="bg-hl">a</span>&gt;&lt;/<span class="bg-hl">li</span>&gt;&lt;/<span class="bg-hl">ul</span>&gt;&lt;/<span class="bg-hl">nav</span>&gt;</div>
            <div class="bg-line">&lt;<span class="bg-hl">form</span> action="/api/checkout" method="POST"&gt;&lt;<span class="bg-hl">input</span> type="email" name="email" required&gt;&lt;/<span class="bg-hl">form</span>&gt;</div>
            <div class="bg-line">&lt;<span class="bg-hl">article</span> class="product-card" data-sku="TS-9021"&gt;&lt;<span class="bg-hl">h2</span>&gt;<span class="bg-hl">Mechanical Keyboard</span>&lt;/<span class="bg-hl">h2</span>&gt;&lt;/<span class="bg-hl">article</span>&gt;</div>
            <div class="bg-line">&lt;<span class="bg-hl">table</span> class="data-grid" aria-label="User metrics"&gt;&lt;<span class="bg-hl">thead</span>&gt;&lt;<span class="bg-hl">tr</span>&gt;&lt;<span class="bg-hl">th</span>&gt;<span class="bg-hl">Name</span>&lt;/<span class="bg-hl">th</span>&gt;&lt;<span class="bg-hl">th</span>&gt;<span class="bg-hl">Role</span>&lt;/<span class="bg-hl">th</span>&gt;&lt;/<span class="bg-hl">tr</span>&gt;&lt;/<span class="bg-hl">thead</span>&gt;&lt;/<span class="bg-hl">table</span>&gt;</div>
            <div class="bg-line">&lt;<span class="bg-hl">dialog</span> id="confirm-modal" open&gt;&lt;<span class="bg-hl">p</span>&gt;<span class="bg-hl">Are you sure you want to delete this token?</span>&lt;/<span class="bg-hl">p</span>&gt;&lt;/<span class="bg-hl">dialog</span>&gt;</div>
            <div class="bg-line">&lt;<span class="bg-hl">img</span> src="/assets/hero.webp" loading="lazy" alt="<span class="bg-hl">Dashboard preview</span>" fetchpriority="high"&gt;</div>
            <div class="bg-line">&lt;<span class="bg-hl">section</span> id="pricing"&gt;&lt;<span class="bg-hl">div</span> class="pricing-tier"&gt;&lt;<span class="bg-hl">h3</span>&gt;<span class="bg-hl">Pro Plan</span>&lt;/<span class="bg-hl">h3</span>&gt;&lt;<span class="bg-hl">span</span> class="price"&gt;<span class="bg-hl">$29/mo</span>&lt;/<span class="bg-hl">span</span>&gt;&lt;/<span class="bg-hl">div</span>&gt;&lt;/<span class="bg-hl">section</span>&gt;</div>
            <div class="bg-line">&lt;<span class="bg-hl">select</span> name="country"&gt;&lt;<span class="bg-hl">option</span> value="us"&gt;<span class="bg-hl">United States</span>&lt;/<span class="bg-hl">option</span>&gt;&lt;<span class="bg-hl">option</span> value="jp"&gt;<span class="bg-hl">Japan</span>&lt;/<span class="bg-hl">option</span>&gt;&lt;/<span class="bg-hl">select</span>&gt;</div>
            <div class="bg-line">&lt;<span class="bg-hl">textarea</span> id="feedback" rows="4" placeholder="<span class="bg-hl">Tell us what you think...</span>"&gt;&lt;/<span class="bg-hl">textarea</span>&gt;</div>
        </div>"""
html = re.sub(bg_pattern_regex, new_bg, html, flags=re.DOTALL)

# 2. Add slot machine to hero-cta
cta_regex = r'<div class="install-box">.*?<button\s+class="copy-btn"(.*?)aria-label="Copy to clipboard">'
new_cta = """<div class="install-box">
                        <span class="prompt" style="color: var(--accent); user-select: none;">$</span>
                        <div class="slot-machine">
                            <div class="slot-track" id="install-slot-track">
                                <code>bun add @tidesurf/core</code>
                                <code>npm i @tidesurf/core</code>
                                <code>yarn add @tidesurf/core</code>
                                <code>pnpm add @tidesurf/core</code>
                                <code>bun add @tidesurf/core</code>
                            </div>
                        </div>
                        <button
                            class="copy-btn"
                            id="install-copy-btn"\\1aria-label="Copy to clipboard">"""
html = re.sub(cta_regex, new_cta, html, flags=re.DOTALL)

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html)

# 3. Add initSlotMachine to main.ts
ts_path = 'website/landing/src/main.ts'
with open(ts_path, 'r', encoding='utf-8') as f:
    ts = f.read()

if 'initSlotMachine' not in ts:
    slot_code = """
function initSlotMachine() {
  const track = document.getElementById("install-slot-track");
  const copyBtn = document.getElementById("install-copy-btn");
  if (!track || !copyBtn) return;

  const commands = [
    "bun add @tidesurf/core",
    "npm i @tidesurf/core",
    "yarn add @tidesurf/core",
    "pnpm add @tidesurf/core",
  ];
  
  let currentIndex = 0;
  const itemHeight = track.firstElementChild?.clientHeight || track.getBoundingClientRect().height / 5 || 24;

  setInterval(() => {
    currentIndex++;
    track.style.transition = "transform 0.45s cubic-bezier(0.23, 1, 0.32, 1)";
    track.style.transform = `translateY(-${currentIndex * itemHeight}px)`;

    const cmdIndex = currentIndex % commands.length;
    copyBtn.setAttribute("data-copy", commands[cmdIndex]);
    
    // Check if the current visible text has changed in translations if applicable, otherwise keep it English
    // Or we leave text as is since we just shift the div. The copy button holds the actual data to strip.

    if (currentIndex === commands.length) {
      setTimeout(() => {
        track.style.transition = "none";
        track.style.transform = "translateY(0)";
        currentIndex = 0;
      }, 500);
    }
  }, 3000);
}
"""
    ts = ts.replace('document.addEventListener("DOMContentLoaded", () => {', 'document.addEventListener("DOMContentLoaded", () => {\n  initSlotMachine();')
    ts += slot_code
    with open(ts_path, 'w', encoding='utf-8') as f:
        f.write(ts)

print("Updated OK")
