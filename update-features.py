import re

with open('website/landing/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Remove all <div class="feature-visual"> ... </div>
# We need to account for nested tags. Regex is risky for deep HTML, but let's see.
# The <div class="feature-visual"> only contains an <svg>...</svg>
# So it's basically <div class="feature-visual">\s*<svg.*?</svg>\s*</div>
pattern = r'<div class="feature-visual">.*?</div>'
# Need to use re.DOTALL and carefully avoid matching too much.
# Since we know it's an svg, let's match `<div class="feature-visual">.*?</svg>\s*</div>`
html = re.sub(r'<div class="feature-visual">\s*<svg.*?</svg>\s*</div>', '', html, flags=re.DOTALL)

with open('website/landing/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("Stripped feature-visual divs")
