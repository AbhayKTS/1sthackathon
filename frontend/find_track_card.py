import sys

with open("t:/1sthackathon/frontend/css/style.css", "r", encoding="utf-8") as f:
    for i, line in enumerate(f):
        if "track-card" in line:
            print(f"Line {i+1}: {line.strip()}")
