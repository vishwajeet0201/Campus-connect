#!/usr/bin/env python3
"""Constrained multi-hypothesis stitcher for translated floor-map screenshots."""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
GENERATED_IMAGES = {"stitched.png", "debug.png", "crop-detection.png"}
DEFAULT_CROP = {"x": 34, "y": 280, "w": 1012, "h": 1690}
DEFAULT_SETTINGS = {
    "min_shift_fraction": 0.35,
    "max_shift_fraction": 0.85,
    "max_cross_shift_px": 120,
}


def load_images(folder: Path) -> list[tuple[Path, np.ndarray]]:
    paths = sorted(
        (p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTENSIONS
         and p.name not in GENERATED_IMAGES and not p.name.startswith("seam-")),
        key=lambda p: (p.stem.isdigit(), int(p.stem) if p.stem.isdigit() else p.name),
    )
    images = []
    for path in paths:
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is not None:
            images.append((path, image))
    return images


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def crop_settings(folder: Path, image: np.ndarray) -> dict[str, int]:
    data = read_json(folder / "crop.json", read_json(folder / "crop.default.json", DEFAULT_CROP))
    return {key: int(data[key]) for key in ("x", "y", "w", "h")}


def settings(folder: Path) -> dict[str, float]:
    result = dict(DEFAULT_SETTINGS)
    result.update(read_json(folder / "settings.json", {}))
    return result


def crop_images(images: list[tuple[Path, np.ndarray]], folder: Path) -> list[tuple[Path, np.ndarray]]:
    crop = crop_settings(folder, images[0][1])
    x, y, w, h = crop["x"], crop["y"], crop["w"], crop["h"]
    cropped = [(path, image[y:y + h, x:x + w]) for path, image in images]
    if any(image.shape[:2] != (h, w) for _, image in cropped):
        raise ValueError(f"Crop {crop} exceeds one or more source images")
    return cropped


def edge_image(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 40, 120)


def ocr_labels(image: np.ndarray) -> list[dict[str, Any]]:
    try:
        import pytesseract
    except ImportError:
        return []
    if shutil.which("tesseract") is None:
        return []
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    labels = []
    for i, text in enumerate(data["text"]):
        text = " ".join(text.split())
        if text and int(float(data["conf"][i])) >= 35:
            labels.append({"text": text.lower(), "x": int(data["left"][i]), "y": int(data["top"][i])})
    return labels


def color_points(image: np.ndarray) -> list[tuple[float, float]]:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    masks = [
        cv2.inRange(hsv, np.array([5, 35, 120]), np.array([40, 180, 255])),
        cv2.inRange(hsv, np.array([85, 25, 120]), np.array([125, 180, 255])),
    ]
    points = []
    for mask in masks:
        corners = cv2.goodFeaturesToTrack(mask, 80, 0.03, 18)
        if corners is not None:
            points.extend((float(point[0][0]), float(point[0][1])) for point in corners)
    return points


def stair_points(image: np.ndarray) -> list[tuple[float, float]]:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, np.array([0, 110, 100]), np.array([10, 255, 255]))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    points = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area > 40:
            moments = cv2.moments(contour)
            if moments["m00"]:
                points.append((moments["m10"] / moments["m00"], moments["m01"] / moments["m00"]))
    return points


def hint_for(hints: dict[str, Any], first: str, second: str) -> tuple[float, float] | None:
    for item in hints.get("pairs", []):
        if item.get("from") == first and item.get("to") == second:
            return float(item["dx"]), float(item["dy"])
    return None


def constrained(dx: float, dy: float, width: int, height: int, config: dict[str, float]) -> bool:
    low = width * config["min_shift_fraction"]
    high = width * config["max_shift_fraction"]
    return low <= abs(dx) <= high and abs(dy) <= config["max_cross_shift_px"]


def vote_translation(points_a: list[tuple[float, float]], points_b: list[tuple[float, float]], tolerance: int = 8) -> tuple[float, float, int] | None:
    votes = []
    for ax, ay in points_a:
        for bx, by in points_b:
            votes.append((round(bx - ax), round(by - ay)))
    if not votes:
        return None
    best = max(votes, key=lambda candidate: sum(abs(candidate[0] - x) <= tolerance and abs(candidate[1] - y) <= tolerance for x, y in votes))
    count = sum(abs(best[0] - x) <= tolerance and abs(best[1] - y) <= tolerance for x, y in votes)
    return float(best[0]), float(best[1]), count


def candidate_shifts(first: np.ndarray, second: np.ndarray, first_name: str, second_name: str, config: dict[str, float], hints: dict[str, Any], labels: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    height, width = first.shape[:2]
    minimum = int(width * config["min_shift_fraction"])
    maximum = int(width * config["max_shift_fraction"])
    key_a, desc_a = cv2.ORB_create(nfeatures=6000, fastThreshold=5).detectAndCompute(edge_image(first), None)
    key_b, desc_b = cv2.ORB_create(nfeatures=6000, fastThreshold=5).detectAndCompute(edge_image(second), None)
    raw: list[tuple[float, float, float, str]] = []
    if desc_a is not None and desc_b is not None:
        matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
        for pair in matcher.knnMatch(desc_a, desc_b, k=2):
            if len(pair) == 2 and pair[0].distance < 0.82 * pair[1].distance:
                a, b = key_a[pair[0].queryIdx].pt, key_b[pair[0].trainIdx].pt
                dx, dy = b[0] - a[0], b[1] - a[1]
                if constrained(dx, dy, width, height, config):
                    raw.append((dx, dy, 1.0 / (1.0 + pair[0].distance), "orb"))
    label_vote = vote_translation(
        [(item["x"], item["y"]) for item in labels.get(first_name, [])],
        [(item["x"], item["y"]) for item in labels.get(second_name, [])],
    )
    if label_vote and constrained(label_vote[0], label_vote[1], width, height, config):
        raw.extend([(label_vote[0], label_vote[1], 2.0 + label_vote[2], "label")] * max(1, label_vote[2]))
    colour_vote = vote_translation(color_points(first), color_points(second))
    if colour_vote and constrained(colour_vote[0], colour_vote[1], width, height, config):
        raw.extend([(colour_vote[0], colour_vote[1], 0.7 + colour_vote[2] * 0.1, "colour")] * max(1, colour_vote[2]))
    stair_vote = vote_translation(stair_points(first), stair_points(second))
    if stair_vote and constrained(stair_vote[0], stair_vote[1], width, height, config):
        raw.extend([(stair_vote[0], stair_vote[1], 1.0 + stair_vote[2], "stairs")] * max(1, stair_vote[2]))
    hint = hint_for(hints, first_name, second_name)
    if hint and constrained(hint[0], hint[1], width, height, config):
        raw.append((hint[0], hint[1], 4.0, "hint"))
    if not raw:
        return []
    clusters: list[dict[str, Any]] = []
    for dx, dy, score, method in raw:
        target = next((item for item in clusters if abs(item["dx"] - dx) <= 8 and abs(item["dy"] - dy) <= 8), None)
        if target is None:
            clusters.append({"dx": dx, "dy": dy, "score": score, "votes": 1, "methods": [method]})
        else:
            target["dx"] = (target["dx"] * target["votes"] + dx) / (target["votes"] + 1)
            target["dy"] = (target["dy"] * target["votes"] + dy) / (target["votes"] + 1)
            target["score"] += score
            target["votes"] += 1
            target["methods"].append(method)
    clusters.sort(key=lambda item: item["score"], reverse=True)
    if hint:
        hinted = [item for item in clusters if abs(item["dx"] - hint[0]) <= 25 and abs(item["dy"] - hint[1]) <= 25]
        if hinted:
            clusters = hinted + [item for item in clusters if item not in hinted]
    for item in clusters:
        item["confidence"] = min(1.0, item["score"] / max(8.0, clusters[0]["score"]))
    return clusters[:5]


def solve_layout(images: list[tuple[Path, np.ndarray]], folder: Path, hints: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    config = settings(folder)
    labels = {path.name: ocr_labels(image) for path, image in images}
    pair_results = []
    for index in range(len(images) - 1):
        first, second = images[index], images[index + 1]
        candidates = candidate_shifts(first[1], second[1], first[0].name, second[0].name, config, hints, labels)
        if not candidates:
            raise RuntimeError(f"No constrained candidates for {first[0].name} -> {second[0].name}")
        ambiguous = len(candidates) > 1 and candidates[0]["score"] <= candidates[1]["score"] * 1.15
        pair_results.append({"a": index, "b": index + 1, "from": first[0].name, "to": second[0].name, "candidates": candidates, "ambiguous": ambiguous})
    positions = [(0.0, 0.0)]
    for pair in pair_results:
        chosen = pair["candidates"][0]
        positions.append((positions[-1][0] + chosen["dx"], positions[-1][1] + chosen["dy"]))
    layout = []
    for index, (path, image) in enumerate(images):
        layout.append({"index": index, "file": path.name, "x": round(positions[index][0], 2), "y": round(positions[index][1], 2), "width": image.shape[1], "height": image.shape[0], "labels": len(labels[path.name])})
    return layout, pair_results, labels


def overlap_diff(first: np.ndarray, second: np.ndarray, dx: int, dy: int, folder: Path, seam_index: int) -> dict[str, Any]:
    h, w = first.shape[:2]
    x1, x2 = max(0, dx), min(w, w + dx)
    y1, y2 = max(0, dy), min(h, h + dy)
    if x2 <= x1 or y2 <= y1:
        return {"status": "NO_OVERLAP", "mean_difference": 0.0}
    a = first[y1:y2, x1:x2]
    b = second[y1 - dy:y2 - dy, x1 - dx:x2 - dx]
    difference = cv2.absdiff(a, b).mean(axis=2)
    bad = difference > 22
    result = {"status": "VERIFIED" if float(bad.mean()) < 0.08 else "MISALIGNED", "mean_difference": round(float(difference.mean()), 2), "changed_fraction": round(float(bad.mean()), 4)}
    if result["status"] == "MISALIGNED":
        debug = cv2.addWeighted(a, 0.5, b, 0.5, 0)
        debug[bad] = (0, 0, 255)
        cv2.imwrite(str(folder / f"seam-{seam_index}.png"), debug)
    return result


def render(images: list[tuple[Path, np.ndarray]], layout: list[dict[str, Any]], folder: Path, pairs: list[dict[str, Any]]) -> None:
    min_x = math.floor(min(item["x"] for item in layout))
    min_y = math.floor(min(item["y"] for item in layout))
    max_x = math.ceil(max(item["x"] + item["width"] for item in layout))
    max_y = math.ceil(max(item["y"] + item["height"] for item in layout))
    canvas = np.zeros((max_y - min_y, max_x - min_x, 3), np.uint8)
    occupied = np.zeros(canvas.shape[:2], np.uint8)
    seams = []
    for index, ((_, image), item) in enumerate(zip(images, layout)):
        x, y = round(item["x"] - min_x), round(item["y"] - min_y)
        if index:
            previous = layout[index - 1]
            dx, dy = round(item["x"] - previous["x"]), round(item["y"] - previous["y"])
            seam = overlap_diff(images[index - 1][1], image, dx, dy, folder, index)
            seams.append(seam)
        for row in range(image.shape[0]):
            for col in range(image.shape[1]):
                if occupied[y + row, x + col] == 0:
                    canvas[y + row, x + col] = image[row, col]
        occupied[y:y + image.shape[0], x:x + image.shape[1]] = 1
    cv2.imwrite(str(folder / "stitched.png"), canvas)
    report = {"layout": layout, "pairs": pairs, "seams": seams, "origin": {"x": min_x, "y": min_y}}
    (folder / "layout.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--ocr", action="store_true")
    args = parser.parse_args()
    folder = args.folder.resolve()
    hints = read_json(folder / "hints.json", {})
    raw_images = load_images(folder)
    order = {name: index for index, name in enumerate(
        sorted(hints.get("files", {}), key=lambda name: hints["files"][name])
    )}
    raw_images.sort(key=lambda item: order.get(item[0].name, len(order)))
    images = crop_images(raw_images, folder)
    manual = read_json(folder / "layout.json", None)
    if manual and "layout" in manual:
        layout = manual["layout"]
        pairs = manual.get("pairs", [])
        labels = {path.name: ocr_labels(image) for path, image in images}
        print("Using manual layout.json; matching skipped.")
    else:
        layout, pairs, labels = solve_layout(images, folder, hints)
    render(images, layout, folder, pairs)
    names = {path.name: hints.get("files", {}).get(path.name, path.name) for path, _ in images}
    duplicates = [text for text, count in Counter(item["text"] for values in labels.values() for item in values).items() if count > 1]
    offsets = []
    hint_map = {(item["from"], item["to"]): item for item in hints.get("pairs", [])}
    for pair in pairs:
        chosen = pair["candidates"][0]
        hint = hint_map.get((pair["from"], pair["to"]))
        offsets.append({
            "from": pair["from"],
            "to": pair["to"],
            "dx": round(chosen["dx"], 2),
            "dy": round(chosen["dy"], 2),
            "hint_dx": hint.get("dx") if hint else None,
            "hint_dy": hint.get("dy") if hint else None,
            "x_unknown": bool(hint and hint.get("x_unknown")),
            "confidence": round(chosen["confidence"], 4),
            "ambiguous": pair["ambiguous"],
        })
    report = {"files_by_content": names, "duplicate_ocr_labels": duplicates, "ocr_available": bool(any(labels.values())), "hint_pairs": hints.get("pairs", []), "final_offsets": offsets, "pairs": pairs}
    (folder / "stitch-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"stitched": str(folder / "stitched.png"), "layout": str(folder / "layout.json"), "report": str(folder / "stitch-report.json"), "files_by_content": names, "final_offsets": offsets, "duplicate_ocr_labels": duplicates, "ocr_available": report["ocr_available"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
