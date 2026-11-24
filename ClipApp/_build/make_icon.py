from PIL import Image, ImageDraw
import sys

S = 256
im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle([18, 18, 238, 238], radius=52, fill=(24, 25, 31, 255))
d.rounded_rectangle([82, 34, 174, 222], radius=20, fill=(255, 196, 70, 255))        # vertical frame
d.polygon([(112, 96), (112, 160), (160, 128)], fill=(20, 20, 24, 255))              # play
d.line([(40, 64), (216, 192)], fill=(239, 75, 75, 255), width=12)                   # cut line
d.ellipse([28, 52, 52, 76], fill=(239, 75, 75, 255))
im.save(sys.argv[1], sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
