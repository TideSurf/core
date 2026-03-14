import re

with open('website/landing/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace <div class="showcase reveal"> with non-animated stacked version
content = content.replace('<div class="showcase reveal">', '<div class="showcase">')

# Strip .showcase-container, .showcase-viewport, .showcase-track, .showcase-nav, .showcase-dots
# We'll extract each slide via regex accurately.

s1 = re.search(r'(<!-- Slide 1: Navigation -->\s*<div class="showcase-slide">.*?)<!-- Slide 2', content, re.DOTALL).group(1)
s2 = re.search(r'(<!-- Slide 2: Search form -->\s*<div class="showcase-slide">.*?)<!-- Slide 3', content, re.DOTALL).group(1)
s3 = re.search(r'(<!-- Slide 3: Product card -->\s*<div class="showcase-slide">.*?)<!-- Slide 4', content, re.DOTALL).group(1)
# Slide 4 until end of .showcase-track (</div></div><button nav next)
s4_match = re.search(r'(<!-- Slide 4: Data table -->\s*<div class="showcase-slide">.*?</div>\s*</div>\s*</div>\s*</div>)', content, re.DOTALL)
s4 = s4_match.group(1)
# Actually the structure is: <div class="showcase-slide"> <div slide-label> <div transform-pair> ... tag, pre, arrow, tag, pre ... </div> </div>
# So each slide closes with </div> </div>

def clean_slide(slide_text):
    # just in case it captured extra closing divs
    # wait, Slide structure:
    # <div class="showcase-slide">
    #   <div class="slide-label">...</div>
    #   <div class="transform-pair"> ... </div>
    # </div>
    # So we just need to match <div class="showcase-slide"> to its closing </div> which is just before the next slide comment.
    return slide_text.strip()

slides_html = f'<div class="showcase-stack" style="display: flex; flex-direction: column; gap: 4rem;">\n{clean_slide(s1)}\n{clean_slide(s2)}\n{clean_slide(s3)}\n{clean_slide(s4)}\n</div>\n</div>\n</section>'

# Replace from <div class="showcase-container"> up to </div></section>
start_idx = content.find('<div class="showcase-container">')
# find end of section
end_idx = content.find('</section>', start_idx)
new_content = content[:start_idx] + slides_html + content[end_idx+10:]

with open('website/landing/index.html', 'w', encoding='utf-8') as f:
    f.write(new_content)
print("done")
