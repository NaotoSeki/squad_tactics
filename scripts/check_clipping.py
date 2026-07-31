import os
import glob
from PIL import Image

def check_clipping():
    files = glob.glob(os.path.expanduser("~/Documents/output/renders_test/*.png"))
    l, r, t, b = 0, 0, 0, 0
    
    for f in files:
        img = Image.open(f)
        bbox = img.getbbox()
        if bbox:
            if bbox[0] <= 1: l += 1
            if bbox[1] <= 1: t += 1
            if bbox[2] >= img.width - 1: r += 1
            if bbox[3] >= img.height - 1: b += 1
                
    print(f"Total files: {len(files)}")
    print(f"Left: {l}, Right: {r}, Top: {t}, Bottom: {b}")

if __name__ == "__main__":
    check_clipping()
