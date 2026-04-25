"""Stream the webcam, OCR math equations with pix2tex, and log them to the terminal.

Aim the equation inside the green box, press SPACE to capture, Q to quit.
"""

from __future__ import annotations

import sys
import threading
from datetime import datetime

import cv2
from PIL import Image

CAMERA_INDEX = 0
WINDOW_TITLE = "unblind - SPACE to capture, Q to quit"

CROP_WIDTH_RATIO = 0.7
CROP_HEIGHT_RATIO = 0.25

UPSCALE_FACTOR = 2
ADAPTIVE_BLOCK_SIZE = 31
ADAPTIVE_C = 10


class FrameBuffer:
    """Single-slot buffer holding the most recent frame. Old frames are dropped."""

    def __init__(self) -> None:
        self._frame = None
        self._lock = threading.Lock()

    def put(self, frame) -> None:
        with self._lock:
            self._frame = frame

    def get(self):
        with self._lock:
            return None if self._frame is None else self._frame.copy()


def crop_center(frame):
    h, w = frame.shape[:2]
    cw = int(w * CROP_WIDTH_RATIO)
    ch = int(h * CROP_HEIGHT_RATIO)
    x0 = (w - cw) // 2
    y0 = (h - ch) // 2
    return frame[y0 : y0 + ch, x0 : x0 + cw], (x0, y0, x0 + cw, y0 + ch)


def preprocess_for_ocr(bgr_crop):
    """Make a webcam crop look like a clean scan: grayscale, adaptive threshold, upscale."""
    gray = cv2.cvtColor(bgr_crop, cv2.COLOR_BGR2GRAY)
    binary = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        ADAPTIVE_BLOCK_SIZE,
        ADAPTIVE_C,
    )
    h, w = binary.shape
    upscaled = cv2.resize(
        binary, (w * UPSCALE_FACTOR, h * UPSCALE_FACTOR), interpolation=cv2.INTER_CUBIC
    )
    return cv2.cvtColor(upscaled, cv2.COLOR_GRAY2RGB)


def ocr_worker(
    buffer: FrameBuffer,
    capture: threading.Event,
    stop: threading.Event,
    model,
) -> None:
    while not stop.is_set():
        if not capture.wait(timeout=0.5):
            continue
        capture.clear()
        if stop.is_set():
            return

        frame = buffer.get()
        if frame is None:
            print("[no frame yet]", flush=True)
            continue

        cropped, _ = crop_center(frame)
        processed = preprocess_for_ocr(cropped)
        image = Image.fromarray(processed)

        print("Recognizing...", flush=True)
        try:
            equation = model(image).strip()
        except Exception as exc:
            print(f"[ocr error] {exc}", file=sys.stderr)
            continue

        timestamp = datetime.now().strftime("%H:%M:%S")
        if not equation:
            print(f"[{timestamp}] (no equation detected)", flush=True)
        else:
            print(f"[{timestamp}] {equation}", flush=True)


def main() -> int:
    print("Loading pix2tex model (first run downloads weights, ~few hundred MB)...", flush=True)
    from pix2tex.cli import LatexOCR

    model = LatexOCR()
    print("Model ready.", flush=True)

    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"Could not open camera index {CAMERA_INDEX}.", file=sys.stderr)
        return 1

    buffer = FrameBuffer()
    capture = threading.Event()
    stop = threading.Event()
    worker = threading.Thread(
        target=ocr_worker, args=(buffer, capture, stop, model), daemon=True
    )
    worker.start()

    print("Streaming. Aim equation inside the green box, press SPACE to capture, Q to quit.", flush=True)

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("Camera read failed; exiting.", file=sys.stderr)
                break

            buffer.put(frame)

            _, (x0, y0, x1, y1) = crop_center(frame)
            preview = frame.copy()
            cv2.rectangle(preview, (x0, y0), (x1, y1), (0, 255, 0), 2)
            cv2.putText(
                preview,
                "SPACE to capture, Q to quit",
                (x0, max(y0 - 8, 16)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 255, 0),
                2,
            )
            cv2.imshow(WINDOW_TITLE, preview)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord(" "):
                capture.set()
    finally:
        stop.set()
        capture.set()
        worker.join(timeout=5.0)
        cap.release()
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    sys.exit(main())
