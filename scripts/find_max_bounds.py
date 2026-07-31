import os
import glob
from PIL import Image

renders_dir = os.path.expanduser("~/Documents/output/renders")
max_w = 0
max_h = 0
widest_file = ""
tallest_file = ""

for filepath in glob.glob(os.path.join(renders_dir, "*.png")):
    img = Image.open(filepath)
    bbox = img.getbbox()
    if bbox:
        # bbox is (left, upper, right, lower)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        if w > max_w:
            max_w = w
            widest_file = filepath
        if h > max_h:
            max_h = h
            tallest_file = filepath

print(f"Widest frame: {os.path.basename(widest_file)} (Width: {max_w}px)")
print(f"Tallest frame: {os.path.basename(tallest_file)} (Height: {max_h}px)")
