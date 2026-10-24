#!/usr/bin/env python3
"""Generate public/og.png (1200x630) — the Open Graph / Twitter share card.

Draws the flat GolfMe mark with the same geometry as
src/components/brand/GolfMeIcon.tsx (48x48 grid, scaled) on the brand
forest gradient from public/icon-source.svg, with the wordmark split
(Golf = white, Me = brand gold) and the launch pitch. Re-run whenever the
pitch copy changes:  python3 scripts/make-og-image.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
OUT = Path(__file__).resolve().parent.parent / "public" / "og.png"
FONT_DIR = Path("/usr/share/fonts/opentype/inter")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    for candidate in (FONT_DIR / f"{name}.otf", FONT_DIR / f"Inter-{name}.otf"):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(w, h, c0, c1):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / w + y / h) / 2
            px[x, y] = lerp(c0, c1, t)
    return img


def draw_mark(draw: ImageDraw.ImageDraw, x0: int, y0: int, size: int):
    """Flat GolfMeIcon geometry (viewBox 0 0 48 48) scaled to `size`."""
    s = size / 48
    dot = (248, 250, 248)
    flag = (134, 239, 172)
    rim = (217, 154, 46)
    hole = (22, 101, 52)

    def circle(cx, cy, r, fill):
        draw.ellipse([x0 + (cx - r) * s, y0 + (cy - r) * s, x0 + (cx + r) * s, y0 + (cy + r) * s], fill=fill)

    circle(12.8, 12.8, 6.7, dot)
    circle(12.8, 35.2, 6.7, dot)
    circle(35.2, 12.8, 6.7, dot)
    draw.line([x0 + 35.2 * s, y0 + 12.8 * s, x0 + 35.2 * s, y0 + 1.2 * s], fill=flag, width=max(2, round(1.5 * s)))
    draw.polygon([(x0 + 35.2 * s, y0 + 1.4 * s), (x0 + 42.4 * s, y0 + 1.95 * s), (x0 + 35.2 * s, y0 + 2.95 * s)], fill=flag)
    draw.ellipse([x0 + (35.2 - 8.5) * s, y0 + (35.2 - 5.4) * s, x0 + (35.2 + 8.5) * s, y0 + (35.2 + 5.4) * s], fill=rim)
    draw.ellipse([x0 + (35.2 - 7.8) * s, y0 + (35.95 - 4.65) * s, x0 + (35.2 + 7.8) * s, y0 + (35.95 + 4.65) * s], fill=hole)


def main():
    img = gradient(W, H, (27, 74, 45), (14, 39, 23))
    draw = ImageDraw.Draw(img)

    # Soft "green" highlight in the corner for depth.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([700, -250, 1500, 450], fill=(79, 193, 105, 40))
    img = Image.alpha_composite(img.convert("RGBA"), glow.filter(__import__("PIL.ImageFilter", fromlist=["GaussianBlur"]).GaussianBlur(120)))
    draw = ImageDraw.Draw(img)

    # Icon chip: a translucent white square composited over the gradient
    # (drawing an RGBA fill directly writes alpha, which converts to white).
    chip = 132
    cx, cy = 96, 92
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(overlay).rounded_rectangle([cx, cy, cx + chip, cy + chip], radius=30, fill=(255, 255, 255, 28))
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)
    draw_mark(draw, cx + 24, cy + 24, chip - 48)

    # Wordmark next to chip
    f_word = font("InterDisplay-ExtraBold", 72)
    golf_w = draw.textlength("Golf", font=f_word)
    draw.text((cx + chip + 34, cy + 24), "Golf", font=f_word, fill=(255, 255, 255))
    draw.text((cx + chip + 34 + golf_w, cy + 24), "Me", font=f_word, fill=(240, 185, 63))

    # Headline + pitch
    f_h = font("InterDisplay-ExtraBold", 66)
    f_p = font("Inter-Medium", 30)
    draw.text((96, 290), "Find your foursome.", font=f_h, fill=(255, 255, 255))
    draw.text((96, 366), "Get better with AI Caddie.", font=f_h, fill=(246, 201, 111))
    draw.text((96, 470), "Golfers near you, open rounds, swing analysis. Built in NYC.", font=f_p, fill=(220, 252, 231))

    # App Store pill
    f_pill = font("Inter-SemiBold", 24)
    label = "Free on the App Store"
    pw = draw.textlength(label, font=f_pill) + 56
    draw.rounded_rectangle([96, 530, 96 + pw, 582], radius=26, fill=(244, 185, 66))
    draw.text((124, 541), label, font=f_pill, fill=(5, 46, 22))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(OUT, optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
