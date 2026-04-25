"""Extract a math problem statement from an image and get a response, both via Gemini 2.5 Flash."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

DEFAULT_MODEL = "gemini-2.5-flash"

MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

OCR_SYSTEM_PROMPT = (
    "You transcribe math problem statements from images. "
    "Output the problem statement exactly as shown, preserving the original "
    "wording and order. Use $...$ for inline math and $$...$$ for display "
    "equations, in standard LaTeX. Do not solve the problem. Do not add "
    "preamble, commentary, or any text that is not part of the problem "
    "statement itself."
)
OCR_USER_PROMPT = "Transcribe the math problem statement from this image."

RESPOND_SYSTEM_PROMPT = (
    "You are a helpful assistant. Respond to the math problem(s) below."
)


def extract_problem(
    client: genai.Client, model: str, image_bytes: bytes, media_type: str
) -> str:
    response = client.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=media_type),
            OCR_USER_PROMPT,
        ],
        config=types.GenerateContentConfig(
            system_instruction=OCR_SYSTEM_PROMPT,
            max_output_tokens=4096,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return (response.text or "").strip()


def respond_to_problem(client: genai.Client, model: str, problem_text: str) -> str:
    response = client.models.generate_content(
        model=model,
        contents=[problem_text],
        config=types.GenerateContentConfig(
            system_instruction=RESPOND_SYSTEM_PROMPT,
            max_output_tokens=4096,
        ),
    )
    return (response.text or "").strip()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract a math problem statement from an image and get a response."
    )
    parser.add_argument(
        "image",
        type=Path,
        help="Path to image (.png, .jpg, .jpeg, .webp, .gif)",
    )
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print(
            "Error: GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. "
            "Get a free key at https://aistudio.google.com/app/apikey",
            file=sys.stderr,
        )
        return 1

    image_path: Path = args.image
    if not image_path.is_file():
        print(f"Error: image not found: {image_path}", file=sys.stderr)
        return 1

    media_type = MEDIA_TYPES.get(image_path.suffix.lower())
    if media_type is None:
        supported = ", ".join(sorted(MEDIA_TYPES))
        print(
            f"Error: unsupported image extension '{image_path.suffix}'. "
            f"Supported: {supported}.",
            file=sys.stderr,
        )
        return 1

    model = os.environ.get("UNBLIND_MODEL", DEFAULT_MODEL)
    image_bytes = image_path.read_bytes()
    client = genai.Client(api_key=api_key)

    try:
        problem = extract_problem(client, model, image_bytes, media_type)
    except Exception as exc:
        print(f"Error: OCR call failed: {exc}", file=sys.stderr)
        return 1

    if not problem:
        print("Error: no text returned from OCR step.", file=sys.stderr)
        return 1

    print("=== Problem ===")
    print(problem)

    try:
        answer = respond_to_problem(client, model, problem)
    except Exception as exc:
        print(f"\nError: responder call failed: {exc}", file=sys.stderr)
        return 1

    if not answer:
        print("\nError: no text returned from responder step.", file=sys.stderr)
        return 1

    print("\n=== Response ===")
    print(answer)
    return 0


if __name__ == "__main__":
    sys.exit(main())
