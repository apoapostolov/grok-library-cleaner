"""Generate the Grok Library Cleaner mark and its extension icon sizes.

The mark is drawn as vectors with Pillow at 4x supersampling, so the PNGs stay
crisp at 16px and at 512px without shipping an SVG rasteriser dependency.

    python tools/make_icons.py            # writes assets/ and the candidate sheet
"""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SS = 4  # supersample factor

BG_TOP = (20, 21, 26)
BG_BOTTOM = (11, 12, 15)
WHITE = (245, 246, 248)
RED = (217, 58, 63)
MUTED = (150, 154, 164)


def _rounded_bg(size, radius_ratio=0.26, top=BG_TOP, bottom=BG_BOTTOM):
    """Vertical gradient clipped to a rounded square, drawn at supersample size."""
    n = size * SS
    grad = Image.new("RGB", (1, n))
    for y in range(n):
        t = y / max(1, n - 1)
        grad.putpixel(
            (0, y),
            tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
        )
    grad = grad.resize((n, n), Image.NEAREST)

    mask = Image.new("L", (n, n), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * radius_ratio), fill=255)

    card = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    card.paste(grad, (0, 0), mask)
    return card


def draw_trash(d, cx, cy, h, color, lid_color=None, stroke=None):
    """Trash can outline inside a box of height h centred on (cx, cy)."""
    lid_color = lid_color or color
    w = h * 0.72
    sw = stroke or max(2, h * 0.095)
    left = cx - w / 2
    top = cy - h / 2

    # lid
    d.line(
        [(left - w * 0.06, top + h * 0.17), (left + w + w * 0.06, top + h * 0.17)],
        fill=lid_color,
        width=int(sw),
    )
    # handle
    d.rounded_rectangle(
        [left + w * 0.31, top + h * 0.02, left + w * 0.69, top + h * 0.17],
        radius=int(sw * 0.9),
        outline=lid_color,
        width=int(sw),
    )
    # body
    body = [
        (left + w * 0.07, top + h * 0.23),
        (left + w * 0.93, top + h * 0.23),
        (left + w * 0.84, top + h * 0.97),
        (left + w * 0.16, top + h * 0.97),
        (left + w * 0.07, top + h * 0.23),
    ]
    d.line(body, fill=color, width=int(sw), joint="curve")
    # slots
    mid = top + h * 0.60
    d.line(
        [(cx - w * 0.17, top + h * 0.38), (cx - w * 0.17, mid + h * 0.20)],
        fill=color,
        width=int(sw * 0.85),
    )
    d.line(
        [(cx + w * 0.17, top + h * 0.38), (cx + w * 0.17, mid + h * 0.20)],
        fill=color,
        width=int(sw * 0.85),
    )


def draw_photo(d, box, radius, color, width, hill=True):
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=radius, outline=color, width=width)
    if not hill:
        return
    inset = (x1 - x0) * 0.18
    bx0, by0 = x0 + inset, y0 + (y1 - y0) * 0.46
    bx1, by1 = x1 - inset, y1 - (y1 - y0) * 0.18
    d.polygon(
        [(bx0, by1), (bx0 + (bx1 - bx0) * 0.38, by0), (bx0 + (bx1 - bx0) * 0.60, by1)],
        fill=color,
    )
    d.polygon(
        [
            (bx0 + (bx1 - bx0) * 0.42, by1),
            (bx0 + (bx1 - bx0) * 0.72, by0 + (by1 - by0) * 0.28),
            (bx1, by1),
        ],
        fill=color,
    )


def variant_a(size=512, glyph=0.56, radius_ratio=0.26):
    """Recommended: trash can, red lid, white body."""
    img = _rounded_bg(size, radius_ratio=radius_ratio)
    d = ImageDraw.Draw(img)
    draw_trash(
        d,
        cx=size * SS / 2,
        cy=size * SS * 0.50,
        h=size * SS * glyph,
        color=WHITE + (255,),
        lid_color=RED + (255,),
    )
    return img


def variant_b(size=512):
    """Photo frame behind the bin."""
    img = _rounded_bg(size)
    d = ImageDraw.Draw(img)
    s = size * SS
    draw_photo(d, [s * 0.19, s * 0.20, s * 0.81, s * 0.62], int(s * 0.06), MUTED + (255,), int(s * 0.028))
    draw_trash(d, cx=s * 0.60, cy=s * 0.62, h=s * 0.46, color=WHITE + (255,), lid_color=RED + (255,))
    return img


def variant_c(size=512):
    """Bin centred inside a frame with a corner notch."""
    img = _rounded_bg(size)
    d = ImageDraw.Draw(img)
    s = size * SS
    draw_photo(d, [s * 0.16, s * 0.16, s * 0.84, s * 0.84], int(s * 0.10), (92, 96, 106, 255), int(s * 0.022), hill=False)
    draw_trash(d, cx=s * 0.5, cy=s * 0.52, h=s * 0.42, color=WHITE + (255,), lid_color=RED + (255,))
    return img


def variant_d(size=512):
    """Circular badge, bin plus a row of library dots."""
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([0, 0, n - 1, n - 1], fill=(15, 16, 20, 255))
    d.ellipse([0, 0, n - 1, n - 1], outline=(58, 60, 68, 255), width=int(n * 0.012))
    draw_trash(d, cx=n * 0.5, cy=n * 0.46, h=n * 0.40, color=WHITE + (255,), lid_color=RED + (255,))
    dot = n * 0.035
    for i, x in enumerate((0.42, 0.5, 0.58)):
        color = RED + (255,) if i == 1 else (110, 114, 124, 255)
        d.ellipse([n * x - dot, n * 0.76 - dot, n * x + dot, n * 0.76 + dot], fill=color)
    return img


VARIANTS = {"A": variant_a, "B": variant_b, "C": variant_c, "D": variant_d}


def main():
    ASSETS.mkdir(exist_ok=True)

    masters = {}
    cand_dir = ASSETS / "candidates"
    cand_dir.mkdir(exist_ok=True)
    for key, fn in VARIANTS.items():
        img = fn(512).resize((512, 512), Image.LANCZOS)
        masters[key] = img
        img.save(cand_dir / f"candidate-{key}.png")

    # Contact sheet: A B / C D on a dark canvas, for review.
    cell, gap = 256, 24
    sheet = Image.new("RGB", (cell * 2 + gap * 3, cell * 2 + gap * 3), (8, 9, 11))
    order = [("A", 0, 0), ("B", 1, 0), ("C", 0, 1), ("D", 1, 1)]
    for key, col, row in order:
        thumb = masters[key].resize((cell, cell), Image.LANCZOS)
        sheet.paste(thumb, (gap + col * (cell + gap), gap + row * (cell + gap)), thumb)
    sheet.save(cand_dir / "candidates.png")

    # Extension sizes get their own geometry: a downscaled padded master leaves the
    # glyph only ~6px wide at 16px, so the small sizes are drawn with a fuller mark.
    sizes = {
        16: dict(glyph=0.76, radius_ratio=0.22),
        32: dict(glyph=0.70, radius_ratio=0.24),
        48: dict(glyph=0.64, radius_ratio=0.25),
        128: dict(glyph=0.58, radius_ratio=0.26),
    }
    for px, kw in sizes.items():
        img = variant_a(px, **kw).resize((px, px), Image.LANCZOS)
        img.save(ASSETS / f"icon-{px}.png")

    masters["A"].save(ASSETS / "icon-512.png")

    for f in sorted(ASSETS.glob("*.png")):
        with Image.open(f) as im:
            print(f"{f.name:22} {im.size[0]}x{im.size[1]} {im.mode}")


if __name__ == "__main__":
    main()
