"""Central paths used by KB3D Forge scripts."""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

KB_BLEND_PATH = Path(
    r"C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2"
    r"\Kitbash3D - World War 2 [Blender Native]"
    r"\kb3d_worldwartwo.blender.native"
    r"\kb3d_worldwartwo-native.blend"
)

TEX2K_DIR = Path(
    r"C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2"
    r"\Kitbash3D - World War 2 [PNG 2k]"
    r"\kb3d_worldwartwo.png.2k"
)

DEFAULT_CATALOG_OUT = PROJECT_ROOT / "scratch" / "kb3d_forge" / "parts_catalog.json"

BLENDER_EXE = Path(r"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe")
