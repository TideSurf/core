import re

path = 'website/landing/src/style.css'
with open(path, 'r', encoding='utf-8') as f:
    css = f.read()

# 1. Update Font
css = css.replace('--font: "Gothic A1", "Noto Sans JP", system-ui, -apple-system, sans-serif;', '--font: "Outfit", "Noto Sans JP", system-ui, -apple-system, sans-serif;')

# 2. Update Hero title
# Replace hero title block up to .hero-shortline
hero_title_re = r'/\* ── Hero Title ── \*/.*?/\* ── Hero Shortline ── \*/'
new_hero_title = """/* ── Hero Title ── */

.hero-title {
  line-height: 1;
  margin-bottom: 2rem;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 0.3em;
}

.hero-word {
  display: inline-block;
  color: var(--text-hero);
  font-size: clamp(3.5rem, 9vw, 6.5rem);
  font-weight: 800;
  letter-spacing: -0.03em;
}

.hero-word:empty { display: none; }

/* ── Hero Shortline ── */"""
css = re.sub(hero_title_re, new_hero_title, css, flags=re.DOTALL)

# 3. Background Pattern
bg_pattern_re = r'\.hero-bg-pattern \.bg-line:nth-child\(even\).*?\.hero-bg-pattern \.bg-hl'
new_bg_pattern = """.hero-bg-pattern .bg-line:nth-child(even) {
  animation: bg-drift-left 35s ease-in-out infinite alternate;
}

.hero-bg-pattern .bg-line:nth-child(odd) {
  animation: bg-drift-right 40s ease-in-out infinite alternate;
}

@keyframes bg-drift-left {
  0% { transform: translateX(-5%); }
  100% { transform: translateX(5%); }
}

@keyframes bg-drift-right {
  0% { transform: translateX(5%); }
  100% { transform: translateX(-5%); }
}

.hero-bg-pattern .bg-hl"""
css = re.sub(bg_pattern_re, new_bg_pattern, css, flags=re.DOTALL)

# 4. Copy Button Subtlety
copy_btn_re = r'\.copy-btn \{.*?\.copy-btn\.copied \{'
new_copy_btn = """.copy-btn {
  background: transparent;
  border: none;
  color: var(--text-hero-muted);
  cursor: pointer;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  transition: all var(--duration) var(--ease);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.5;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-hero);
  opacity: 1;
}

[data-theme="light"] .copy-btn {
  background: transparent;
  border: none;
}

[data-theme="light"] .copy-btn:hover {
  background: rgba(0, 0, 0, 0.08);
  opacity: 1;
}

.copy-btn.copied {"""
css = re.sub(copy_btn_re, new_copy_btn, css, flags=re.DOTALL)

# Also fix the copy-btn.copied rule
css = css.replace('.copy-btn.copied { \n  background: var(--accent);\n  color: #fff;\n  border-color: var(--accent);\n}', '.copy-btn.copied { \n  background: var(--accent);\n  color: #fff;\n  border: none;\n  opacity: 1;\n}')


# Clean up media query for hero-word
media_re = r'\.hero-word-1 \{.*?\}[ \n]*\.hero-word-2 \{.*?\}[ \n]*\.hero-word-3 \{.*?\}'
css = re.sub(media_re, '', css, flags=re.DOTALL)

with open(path, 'w', encoding='utf-8') as f:
    f.write(css)

print("done css")
