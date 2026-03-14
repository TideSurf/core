import re

html_path = 'website/landing/index.html'
with open(html_path, 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Swap font
font_re = r'<link\s*href="https://fonts\.googleapis\.com.*?rel="stylesheet"\s*/>'
new_font = """<link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet" />"""
# wait the user's string has preconnects, let's just replace the href link explicitly
html = re.sub(r'<link\s*href="https://fonts\.googleapis\.com/css2\?family=Outfit[^>]+>', '<link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet" />', html)

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html)


css_path = 'website/landing/src/style.css'
with open(css_path, 'r', encoding='utf-8') as f:
    css = f.read()

css = css.replace('--font: "Outfit", "Noto Sans JP", system-ui, -apple-system, sans-serif;', '--font: "Inter", "Noto Sans JP", system-ui, -apple-system, sans-serif;')

# 2. Hero Background Visibility
css = css.replace('color: color-mix(in srgb, var(--text-primary) 5%, transparent);', 'color: color-mix(in srgb, var(--text-primary) 12%, transparent);')
css = css.replace('color: color-mix(in srgb, var(--text-primary) 3%, transparent);', 'color: color-mix(in srgb, var(--text-primary) 8%, transparent);')

# 3. Hero Layout (Bottom Left)
# .hero-content alignment
hero_content_re = r'\.hero-content \{.*?\}'
new_hero_content = """.hero-content {
  position: relative;
  z-index: 10;
  max-width: 1100px;
  width: 100%;
  margin: 0 auto;
  padding: 8rem max(env(safe-area-inset-left, 0px), 3.5rem) 6rem max(env(safe-area-inset-right, 0px), 3.5rem);
  will-change: transform, opacity;
  transform-origin: center left;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-start;
  text-align: left;
  min-height: 80vh;
}"""
css = re.sub(hero_content_re, new_hero_content, css, flags=re.DOTALL)

# .hero-title alignment
hero_title_re = r'\.hero-title \{.*?\}'
new_hero_title = """.hero-title {
  line-height: 1;
  margin-bottom: 2rem;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-start;
  text-align: left;
  gap: 0.3em;
}"""
css = re.sub(hero_title_re, new_hero_title, css, flags=re.DOTALL)

# .hero-shortline
css = css.replace('text-align: center;', 'text-align: left;', 1) # First occurrence of text-align center after hero-title is shortline

shortline_re = r'\.hero-shortline \{.*?\}'
new_sl = """.hero-shortline {
  font-size: clamp(0.82rem, 1.3vw, 0.95rem);
  font-weight: 400;
  font-style: italic;
  color: var(--text-hero-muted);
  letter-spacing: 0.02em;
  margin-bottom: 2rem;
  text-align: left;
}"""
css = re.sub(shortline_re, new_sl, css, flags=re.DOTALL)

tagline_re = r'\.hero-tagline \{.*?\}'
new_tl = """.hero-tagline {
  max-width: 480px;
  margin: 0 0 2.5rem 0;
  text-align: left;
}"""
css = re.sub(tagline_re, new_tl, css, flags=re.DOTALL)

cta_re = r'\.hero-cta \{.*?\}'
new_cta = """.hero-cta {
  display: flex;
  justify-content: flex-start;
}"""
# Only replace the first match (which is the hero-cta, as it might match others theoretically, but hero-cta is unique)
css = re.sub(cta_re, new_cta, css, count=1, flags=re.DOTALL)

# Ensure .hero word styling is BIGGER
css = css.replace('font-size: clamp(3.5rem, 9vw, 6.5rem);', 'font-size: clamp(4.5rem, 11vw, 8.5rem);')

with open(css_path, 'w', encoding='utf-8') as f:
    f.write(css)

print("success")
