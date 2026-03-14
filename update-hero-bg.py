with open("website/landing/index.html", "r", encoding="utf-8") as f:
    html = f.read()

# Fix the extra </div>
html = html.replace("""                    </div>
                </div>
                </div>
            </div>
            <div class="scroll-hint">""", """                    </div>
                </div>
            </div>
            <div class="scroll-hint">""")

bg_html = """
        <div class="hero-bg-pattern" aria-hidden="true">
            <div class="bg-line">&lt;html lang="en"&gt;&lt;head&gt;&lt;meta charset="<span class="bg-hl">UTF-8</span>"&gt;&lt;title&gt;TideSurf&lt;/title&gt;&lt;/head&gt;</div>
            <div class="bg-line">&lt;body class="<span class="bg-hl">dark-theme</span>"&gt;&lt;div id="<span class="bg-hl">app</span>"&gt;&lt;header class="navbar"&gt;</div>
            <div class="bg-line">&lt;nav&gt;&lt;ul&gt;&lt;li&gt;&lt;a href="#home" class="<span class="bg-hl">active</span>"&gt;Home&lt;/a&gt;&lt;/li&gt;&lt;li&gt;&lt;a href="#docs"&gt;Docs&lt;/a&gt;&lt;/li&gt;&lt;/ul&gt;&lt;/nav&gt;</div>
            <div class="bg-line">&lt;/header&gt;&lt;main id="<span class="bg-hl">content</span>"&gt;&lt;section class="hero"&gt;</div>
            <div class="bg-line">&lt;h1 class="<span class="bg-hl">title</span>"&gt;Surf the DOM elements&lt;/h1&gt;&lt;p class="subtitle"&gt;Fast and reliable&lt;/p&gt;</div>
            <div class="bg-line">&lt;button class="<span class="bg-hl">cta-button primary</span>" onclick="surf()"&gt;Get Started&lt;/button&gt;</div>
            <div class="bg-line">&lt;/section&gt;&lt;section class="features" id="<span class="bg-hl">features</span>"&gt;</div>
            <div class="bg-line">&lt;div class="grid"&gt;&lt;article class="<span class="bg-hl">card</span>"&gt;&lt;h3&gt;Speed&lt;/h3&gt;&lt;p&gt;Lightning fast processing&lt;/p&gt;&lt;/article&gt;</div>
            <div class="bg-line">&lt;article class="card"&gt;&lt;h3 class="<span class="bg-hl">highlight</span>"&gt;Precision&lt;/h3&gt;&lt;p&gt;Accurate selection&lt;/p&gt;&lt;/article&gt;&lt;/div&gt;</div>
            <div class="bg-line">&lt;/section&gt;&lt;/main&gt;&lt;footer&gt;&lt;p&gt;&amp;copy; 2026 <span class="bg-hl">TideSurf</span>&lt;/p&gt;&lt;/footer&gt;</div>
            <div class="bg-line">&lt;/div&gt;&lt;script src="<span class="bg-hl">main.js</span>"&gt;&lt;/script&gt;&lt;/body&gt;&lt;/html&gt;</div>
        </div>
"""

# Insert it inside <header class="hero" id="home">
if '<header class="hero" id="home">' in html:
    html = html.replace('<header class="hero" id="home">', '<header class="hero" id="home">' + bg_html)

with open("website/landing/index.html", "w", encoding="utf-8") as f:
    f.write(html)
