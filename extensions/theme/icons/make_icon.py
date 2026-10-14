"""RoCreate toolbar icon: white Roblox-style mark, centre cut through,
on the same near-black tile the theme uses for the topbar and sidebar.
Drawn big and downsampled so the 16px size stays sharp.
Run: python icons/make_icon.py
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.dirname(os.path.abspath(__file__))

S = 1024                      # supersampled master
TILE = (22, 24, 27, 255)      # near-black tile, matches the theme chrome
MARK = (247, 247, 248, 255)   # Builder-white mark


def rsq(size, radius, fill):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=fill)
    return img


icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(icon).rounded_rectangle([0, 0, S - 1, S - 1], int(S * 0.23), fill=TILE)

# tilted rounded square with a cut-out centre (alpha punched, not filled)
m = int(S * 0.58)
mark = rsq(m, int(m * 0.17), MARK)
h = int(m * 0.36)
mark.paste(rsq(h, int(h * 0.24), (0, 0, 0, 0)), ((m - h) // 2, (m - h) // 2))
mark = mark.rotate(-15, resample=Image.BICUBIC, expand=True)
icon.paste(mark, ((S - mark.width) // 2, (S - mark.height) // 2), mark)

for px in (16, 48, 128):
    icon.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, f"icon-{px}.png"))
    print("wrote", f"icon-{px}.png")
