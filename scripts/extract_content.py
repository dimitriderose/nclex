#!/usr/bin/env python3
"""
NCLEX Trainer v5 -- Content Extraction Script
Extracts text from OpenRN EPUBs into public/bundled-content.json

Usage:
  pip install ebooklib beautifulsoup4 lxml
  python scripts/extract_content.py
"""

import json, re, hashlib
from pathlib import Path

BOOKS_DIR = Path(__file__).resolve().parent.parent / "docs" / "books" / "epubs"

BOOKS = {
    "pharmacology": {
        "file": BOOKS_DIR / "Nursing-Pharmacology-1714529271.epub",
        "title": "Nursing Pharmacology 2e",
        "source": "OpenRN (CC-BY 4.0)",
        "source_url": "https://wtcs.pressbooks.pub/pharmacology/",
        "ncbi_url": "https://www.ncbi.nlm.nih.gov/books/NBK595000/",
    },
    "fundamentals": {
        "file": BOOKS_DIR / "Nursing-Fundamentals-2e-1771870888.epub",
        "title": "Nursing Fundamentals 2e",
        "source": "OpenRN (CC-BY 4.0)",
        "source_url": "https://wtcs.pressbooks.pub/nursingfundamentals/",
        "ncbi_url": "https://www.ncbi.nlm.nih.gov/books/NBK610836/",
    },
    "skills": {
        "file": BOOKS_DIR / "Nursing-Skills-2e-1720739235.epub",
        "title": "Nursing Skills 2e",
        "source": "OpenRN (CC-BY 4.0)",
        "source_url": "https://wtcs.pressbooks.pub/nursingskills/",
        "ncbi_url": "https://www.ncbi.nlm.nih.gov/books/NBK596735/",
    },
    "mentalhealth": {
        "file": BOOKS_DIR / "Nursing-Mental-Health-and-Community-Concepts-2e-1773254138.epub",
        "title": "Nursing: Mental Health & Community Concepts 2e",
        "source": "OpenRN (CC-BY 4.0)",
        "source_url": "https://wtcs.pressbooks.pub/nursingmhcc/",
        "ncbi_url": "https://www.ncbi.nlm.nih.gov/books/NBK617002/",
    },
    "management": {
        "file": BOOKS_DIR / "Nursing-Management-and-Professional-Concepts-2e-1771870794.epub",
        "title": "Nursing Management & Professional Concepts 2e",
        "source": "OpenRN (CC-BY 4.0)",
        "source_url": "https://wtcs.pressbooks.pub/nursingmpc/",
        "ncbi_url": "https://www.ncbi.nlm.nih.gov/books/NBK598384/",
    },
    "advancedskills": {
        "file": BOOKS_DIR / "Nursing-Advanced-Skills-1720731356.epub",
        "title": "Nursing Advanced Skills",
        "source": "OpenRN (CC-BY 4.0)",
        "source_url": "https://wtcs.pressbooks.pub/nursingadvancedskills/",
        "ncbi_url": "https://www.ncbi.nlm.nih.gov/books/n/openrnas/",
    },
}

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "frontend" / "public" / "bundled-content.json"
MIN_CHAPTER_CHARS = 300


def clean_text(text: str) -> str:
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r'[^\x20-\x7E\n]', ' ', text)
    return text.strip()


def extract_epub(path: Path) -> list[dict]:
    import ebooklib
    from ebooklib import epub
    from bs4 import BeautifulSoup

    if not path.exists():
        print(f"  File not found: {path} -- skipping")
        return []

    book = epub.read_epub(str(path))
    chapters = []

    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        try:
            html = item.get_content().decode('utf-8', errors='ignore')
            soup = BeautifulSoup(html, 'lxml')

            heading = soup.find(['h1', 'h2', 'h3'])
            title = heading.get_text(strip=True) if heading else item.get_name()

            for tag in soup.find_all(['nav', 'aside', 'footer', 'script', 'style']):
                tag.decompose()

            text = clean_text(soup.get_text(separator=' '))

            if len(text) >= MIN_CHAPTER_CHARS:
                chapters.append({"title": title, "text": text})
        except Exception as e:
            print(f"  Error parsing {item.get_name()}: {e}")

    print(f"  EPUB: {len(chapters)} chapters extracted")
    return chapters


def extract_book(key: str, config: dict) -> dict | None:
    file_path = config["file"]
    print(f"  Extracting: {config['title']}")

    chapters = extract_epub(file_path)
    if not chapters:
        return None

    return {
        "title": config["title"],
        "source": config["source"],
        "source_url": config["source_url"],
        "ncbi_url": config.get("ncbi_url", ""),
        "chapters": chapters,
        "chapter_count": len(chapters),
        "total_chars": sum(len(c["text"]) for c in chapters),
    }


def main():
    print("\nNCLEX Trainer v5 -- Content Extraction\n")
    bundled = {"openrn": {}, "openstax": {"ngn": {}}}
    total_chapters = 0
    total_chars = 0

    print("OpenRN Books:")
    for key, config in BOOKS.items():
        result = extract_book(key, config)
        if result:
            bundled["openrn"][key] = result
            total_chapters += result["chapter_count"]
            total_chars += result["total_chars"]
            print(f"     {key}: {result['chapter_count']} chapters, "
                  f"{result['total_chars']:,} chars")
        else:
            print(f"     {key}: skipped (file missing or empty)")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    json_bytes = json.dumps(bundled, ensure_ascii=False, separators=(',', ':')).encode('utf-8')

    with open(OUTPUT_PATH, 'wb') as f:
        f.write(json_bytes)

    sha256 = hashlib.sha256(json_bytes).hexdigest()
    size_mb = len(json_bytes) / (1024 * 1024)

    print(f"\nDone!")
    print(f"   Output:    {OUTPUT_PATH}")
    print(f"   Size:      {size_mb:.1f} MB")
    print(f"   Chapters:  {total_chapters}")
    print(f"   Chars:     {total_chars:,}")
    print(f"\n   SHA-256: {sha256}")
    print(f"\n   Add to frontend/.env.local:")
    print(f"   VITE_BUNDLED_CONTENT_SHA256={sha256}")


if __name__ == "__main__":
    main()
