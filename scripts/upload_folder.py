"""Upload a local folder of chapter PDFs to the Manhwa Reader."""

import argparse
import io
import os
import re
import sys
import time
from pathlib import Path

import fitz
from dotenv import load_dotenv
from PIL import Image
from supabase import create_client


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = PROJECT_ROOT / ".env.uploader"
STORAGE_BUCKET = "manhwa"
WEBP_QUALITY = 85
RENDER_SCALE = 1.5


def chapter_number_from_name(filename):
    stem = Path(filename).stem
    match = re.search(r"(?:chapter|ch|episode|ep)[^\d]*(\d+(?:\.\d+)?)", stem, re.IGNORECASE)
    if not match:
        match = re.search(r"(?:^|[\s._-])(\d+(?:\.\d+)?)(?:$|[\s._-])", stem)
    if not match:
        return None
    number = float(match.group(1))
    return int(number) if number.is_integer() else number


def chapter_folder(series_id, chapter_number):
    return f"series_{series_id}/chapter_{chapter_number}"


def retry(action, label):
    for attempt in range(1, 4):
        try:
            return action()
        except Exception as error:
            if attempt == 3:
                raise RuntimeError(f"{label} failed after 3 attempts: {error}") from error
            print(f"  {label} failed. Retrying ({attempt}/3)...")
            time.sleep(2)


def list_existing_pages(storage, folder):
    items = retry(lambda: storage.list(folder, {"limit": 1000}), f"listing {folder}") or []
    return {item["name"] for item in items if item.get("name", "").endswith(".webp")}


def render_page(page):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE), alpha=False)
    image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
    output = io.BytesIO()
    image.save(output, format="WEBP", quality=WEBP_QUALITY, method=6)
    return output.getvalue()


def upload_chapter(client, series_id, pdf_file, chapter_number):
    folder = chapter_folder(series_id, chapter_number)
    storage = client.storage.from_(STORAGE_BUCKET)
    existing_pages = list_existing_pages(storage, folder)
    document = fitz.open(pdf_file)

    try:
        page_count = len(document)
        print(f"Chapter {chapter_number}: {page_count} pages")
        for page_index, page in enumerate(document, start=1):
            filename = f"{page_index}.webp"
            if filename in existing_pages:
                print(f"  Skipping page {page_index}/{page_count} (already uploaded)")
                continue

            print(f"  Uploading page {page_index}/{page_count}...")
            image_data = render_page(page)
            path = f"{folder}/{filename}"
            retry(
                lambda: storage.upload(
                    path,
                    image_data,
                    {"content-type": "image/webp", "cache-control": "31536000", "upsert": "true"},
                ),
                f"uploading page {page_index}",
            )

        retry(
            lambda: client.table("chapters").upsert(
                {
                    "series_id": series_id,
                    "chapter_number": chapter_number,
                    "page_count": page_count,
                },
                on_conflict="series_id,chapter_number",
            ).execute(),
            f"saving chapter {chapter_number}",
        )
    finally:
        document.close()


def main():
    parser = argparse.ArgumentParser(description="Upload chapter PDFs from a local series folder.")
    parser.add_argument("folder", help="Folder containing PDFs; its name must match the series title.")
    args = parser.parse_args()

    load_dotenv(ENV_FILE)
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY")
    if not supabase_url or not supabase_key:
        print(f"Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in {ENV_FILE}")
        return 1

    folder = Path(args.folder).expanduser().resolve()
    if not folder.is_dir():
        print(f"Folder not found: {folder}")
        return 1

    pdf_files = sorted(folder.glob("*.pdf"), key=lambda file: (chapter_number_from_name(file.name) is None, chapter_number_from_name(file.name) or 0, file.name.lower()))
    if not pdf_files:
        print(f"No PDF files found in {folder}")
        return 1

    numbered_files = [(file, chapter_number_from_name(file.name)) for file in pdf_files]
    missing_numbers = [file.name for file, number in numbered_files if number is None]
    if missing_numbers:
        print("These filenames do not contain a chapter number:")
        for filename in missing_numbers:
            print(f"  - {filename}")
        return 1

    if len({number for _, number in numbered_files}) != len(numbered_files):
        print("Two PDF files have the same chapter number. Rename one file and try again.")
        return 1

    client = create_client(supabase_url, supabase_key)
    series_title = folder.name
    result = client.table("series").select("id,title").eq("title", series_title).execute()
    series_rows = result.data or []
    if not series_rows:
        print(f'No series named "{series_title}" was found in Supabase.')
        print("Create the series in Admin first, then make the folder name match exactly.")
        return 1

    series_id = series_rows[0]["id"]
    print(f"Series: {series_title}")
    print(f"PDF files: {len(numbered_files)}")

    for pdf_file, chapter_number in numbered_files:
        print(f"\nProcessing {pdf_file.name}")
        upload_chapter(client, series_id, pdf_file, chapter_number)
        print(f"Chapter {chapter_number} complete")

    print("\nUpload finished successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
