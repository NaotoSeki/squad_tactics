import urllib.request
import zipfile
import os
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

assets = [
    "Bricks076A_1K-JPG.zip",
    "Concrete031_1K-JPG.zip",
    "Ground037_1K-JPG.zip",
    "Metal040_1K-JPG.zip"
]

base_url = "https://ambientcg.com/get?file="
dest_dir = "C:/Projects/squad_tactics/asset/environment/pbr"
os.makedirs(dest_dir, exist_ok=True)

for asset in assets:
    url = base_url + asset
    zip_path = os.path.join(dest_dir, asset)
    print(f"Downloading {asset}...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response, open(zip_path, 'wb') as out_file:
            data = response.read()
            out_file.write(data)
            
        print(f"Extracting {asset}...")
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(os.path.join(dest_dir, asset.split('_')[0]))
        os.remove(zip_path)
    except Exception as e:
        print(f"Failed {asset}: {e}")
