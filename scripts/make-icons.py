"""Generate PNG app icons (PWA + Windows installer) without external assets."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT_DIRS = [ROOT / "apps" / "web" / "public" / "icons"]


def rounded_rect_gradient(size: int, radius_ratio: float, padding: int = 0) -> Image.Image:
    scale = 4
    big = size * scale
    base = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    gradient = Image.new("RGBA", (big, big))
    pixels = gradient.load()
    for y in range(big):
        for x in range(big):
            t = (x / big + y / big) / 2
            r = int(255 - 4 * t)
            g = int(122 - 38 * t)
            b = int(26 - 26 * t)
            pixels[x, y] = (r, g, b, 255)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [padding * scale, padding * scale, big - padding * scale, big - padding * scale],
        radius=int(big * radius_ratio),
        fill=255,
    )
    base.paste(gradient, (0, 0), mask)
    return base.resize((size, size), Image.LANCZOS)


def draw_rss_mark(image: Image.Image) -> None:
    size = image.size[0]
    draw = ImageDraw.Draw(image)
    unit = size / 192
    stroke = max(2, int(14 * unit))
    center = (int(55 * unit), int(140 * unit))

    # RSS arcs opening to the top-right.
    for radius in (30, 62, 94):
        box = [
            center[0] - int(radius * unit),
            center[1] - int(radius * unit),
            center[0] + int(radius * unit),
            center[1] + int(radius * unit),
        ]
        draw.arc(box, start=270, end=360, fill=(255, 255, 255, 255), width=stroke)

    dot_radius = int(11 * unit)
    draw.ellipse(
        [
            center[0] - dot_radius,
            center[1] - dot_radius,
            center[0] + dot_radius,
            center[1] + dot_radius,
        ],
        fill=(255, 255, 255, 255),
    )


def make_icon(size: int, radius_ratio: float = 0.23, padding_ratio: float = 0.0) -> Image.Image:
    image = rounded_rect_gradient(size, radius_ratio, padding=int(size * padding_ratio))
    draw_rss_mark(image)
    return image


def make_android_icons() -> None:
    res = ROOT / "apps" / "mobile" / "android" / "app" / "src" / "main" / "res"
    if not res.exists():
        return
    densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for name, factor in densities.items():
        legacy_size = int(48 * factor)
        foreground_size = int(108 * factor)
        directory = res / f"mipmap-{name}"
        directory.mkdir(parents=True, exist_ok=True)

        legacy = make_icon(legacy_size)
        legacy.save(directory / "ic_launcher.png")

        # Round legacy icon.
        round_icon = make_icon(legacy_size, radius_ratio=0.5)
        mask = Image.new("L", (legacy_size, legacy_size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, legacy_size - 1, legacy_size - 1], fill=255)
        rounded = Image.new("RGBA", (legacy_size, legacy_size), (0, 0, 0, 0))
        rounded.paste(round_icon, (0, 0), mask)
        rounded.save(directory / "ic_launcher_round.png")

        # Adaptive foreground: transparent canvas with the white mark in the safe zone.
        foreground = Image.new("RGBA", (foreground_size, foreground_size), (0, 0, 0, 0))
        mark = Image.new("RGBA", (foreground_size, foreground_size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(mark)
        unit = foreground_size / 192
        stroke = max(2, int(13 * unit))
        center = (int(72 * unit), int(128 * unit))
        for radius in (26, 54, 82):
            box = [
                center[0] - int(radius * unit),
                center[1] - int(radius * unit),
                center[0] + int(radius * unit),
                center[1] + int(radius * unit),
            ]
            draw.arc(box, start=270, end=360, fill=(255, 255, 255, 255), width=stroke)
        dot = int(10 * unit)
        draw.ellipse(
            [center[0] - dot, center[1] - dot, center[0] + dot, center[1] + dot],
            fill=(255, 255, 255, 255),
        )
        foreground.alpha_composite(mark)
        foreground.save(directory / "ic_launcher_foreground.png")


def main() -> None:
    for directory in OUT_DIRS:
        directory.mkdir(parents=True, exist_ok=True)

    icon_192 = make_icon(192)
    icon_512 = make_icon(512)
    maskable = make_icon(512, radius_ratio=0.5, padding_ratio=0.08)

    icon_192.save(ROOT / "apps" / "web" / "public" / "icons" / "icon-192.png")
    icon_512.save(ROOT / "apps" / "web" / "public" / "icons" / "icon-512.png")
    maskable.save(ROOT / "apps" / "web" / "public" / "icons" / "maskable-512.png")
    icon_512.save(ROOT / "apps" / "web" / "public" / "apple-touch-icon.png")
    # Source image for `pnpm --filter @flowread/desktop exec tauri icon`.
    icon_512.save(ROOT / "apps" / "desktop" / "src-tauri" / "app-icon.png")

    make_android_icons()
    print("icons written")


if __name__ == "__main__":
    main()
