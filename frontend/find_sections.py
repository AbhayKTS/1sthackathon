with open('t:/1sthackathon/frontend/landing.html', 'r', encoding='utf-8') as f:
    html = f.read()

import re

# We want to swap the "Join the Gang" section and "About The Team" section.
# Let's find their blocks.

join_match = re.search(r'<section class="contact-section" id="join">.*?</section>', html, re.DOTALL)
about_match = re.search(r'<section class="squad-section".*?</section>\s*</section>', html, re.DOTALL)
# wait, the about section ends with a </section>, but earlier we might have had nested sections or 
# maybe it was just </section>. Let's find the exact matches by searching for `<section` and the next `<section` or `<footer>`

# Let's split by <section
sections = re.split(r'(<section )', html)
for i, s in enumerate(sections):
    if 'id="join"' in s or 'Join the Gang' in s:
        print(f"Join section at index {i}")
    if 'squad-section' in s or 'About The Team' in s:
        print(f"About section at index {i}")

