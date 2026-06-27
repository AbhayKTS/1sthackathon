import re

with open('t:/1sthackathon/frontend/landing.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Find the Join section
join_match = re.search(r'(<section\s+class="contact-section"\s+id="join".*?</section>)', html, re.DOTALL | re.IGNORECASE)
about_match = re.search(r'(<section\s+class="squad-section"\s+id="about".*?</section>)', html, re.DOTALL | re.IGNORECASE)

if join_match and about_match:
    join_html = join_match.group(1)
    about_html = about_match.group(1)
    
    # Remove both from the original HTML
    # We will replace them with placeholders first to preserve order of whatever was around them
    html = html.replace(join_html, '<!-- JOIN_PLACEHOLDER -->')
    html = html.replace(about_html, '<!-- ABOUT_PLACEHOLDER -->')
    
    # Wait, they are in the order: ... JOIN_PLACEHOLDER ... ABOUT_PLACEHOLDER ...
    # We want About to be above Join, so: ... ABOUT_PLACEHOLDER ... JOIN_PLACEHOLDER ...
    # Instead, let's just replace JOIN_PLACEHOLDER with ABOUT_PLACEHOLDER's content + JOIN_PLACEHOLDER's content
    # And replace ABOUT_PLACEHOLDER with empty string
    
    html = html.replace('<!-- JOIN_PLACEHOLDER -->', about_html + '\n\n' + join_html)
    html = html.replace('<!-- ABOUT_PLACEHOLDER -->', '')
    
    with open('t:/1sthackathon/frontend/landing.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print("Successfully swapped sections!")
else:
    print("Could not find both sections.")
