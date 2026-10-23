"""Prepare the extension icons and README hero from the master artwork.

The master (`assets/icon-source.png`) is a 1254px transparent PNG: a solid
subject on a clean alpha channel, so this script does no keying. It crops to the
subject, centres it in a square canvas, then emits each size with a light
unsharp pass so the 16px toolbar icon keeps its edges.

    python tools/prepare_icon.py
"""

from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "icon-source.png"

# Fraction of the canvas the subject may occupy. The mark is taller than wide,
# and the tiny toolbar sizes need every pixel they can get.
PADDING = {16: 0.03, 32: 0.04, 48: 0.05, 128: 0.06, 512: 0.06}
SIZES = (16, 32, 48, 128, 512)


def load_master() -> Image.Image:
    img = Image.open(SOURCE).convert("RGBA")
    bbox = img.split()[3].point(lambda a: 255 if a > 8 else 0).getbbox()
    if not bbox:
        raise SystemExit("master has no visible pixels")
    return img.crop(bbox)


def square(mark: Image.Image, size: int) -> Image.Image:
    """Centre the cropped subject on a transparent square canvas."""
    inner = max(1, int(size * (1 - PADDING.get(size, 0.06) * 2)))
    scale = inner / max(mark.width, mark.height)
    scaled = mark.resize(
        (max(1, round(mark.width * scale)), max(1, round(mark.height * scale))),
        Image.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(
        scaled,
        ((size - scaled.width) // 2, (size - scaled.height) // 2),
        scaled,
    )
    return canvas


def main() -> None:
    mark = load_master()
    print(f"master subject: {mark.width}x{mark.height}")

    for size in SIZES:
        # Small sizes are drawn from a larger intermediate so the resample has
        # room, then sharpened to hold the silhouette.
        work = square(mark, max(size, 256) if size < 256 else size)
        icon = work.resize((size, size), Image.LANCZOS)
        if size <= 48:
            icon = icon.filter(ImageFilter.UnsharpMask(radius=0.6, percent=110, threshold=2))
        out = ASSETS / f"icon-{size}.png"
        icon.save(out)
        alpha = icon.getchannel("A")
        print(f"{out.name:14} {icon.width}x{icon.height} alpha {alpha.getextrema()}")

    hero = square(mark, 512)
    hero.save(ASSETS / "hero.png")
    print(f"hero.png       512x512 ({len((ASSETS / 'hero.png').read_bytes())} bytes)")


if __name__ == "__main__":
    main()
