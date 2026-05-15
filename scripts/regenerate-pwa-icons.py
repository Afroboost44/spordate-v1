"""
Régénère toutes les icônes PWA + favicons + splash screens à partir du nouveau logo2.

Logo source : public/brand/logo2_spordateur (1).png (1500x1500, fond noir, neon centré)

Outputs :
- public/icons/icon-{16,32,192,512}.png (PWA manifest)
- public/icons/apple-touch-icon.png (180x180)
- public/icons/favicon-{16,32}.png
- public/favicon.ico (multi-resolution 16+32+48)
- public/splash/apple-splash-* (9 tailles iPhone/iPad)
- public/brand/icon-{16,32,48,192,512}.png (legacy refs)

Maskable safe zone : iOS/Android peuvent crop jusqu'à ~10% des bords pour les
coins arrondis. Le logo source a déjà une marge naturelle de ~15-18%, parfait
pour 'maskable any'.
"""

from PIL import Image
from pathlib import Path

BASE = Path("/sessions/zealous-hopeful-archimedes/mnt/spordate-v1/public")
SOURCE = BASE / "brand" / "logo2_spordateur (1).png"

# Sizes PWA icons + favicons
ICON_SIZES = {
    BASE / "icons" / "icon-16.png": 16,
    BASE / "icons" / "icon-32.png": 32,
    BASE / "icons" / "icon-192.png": 192,
    BASE / "icons" / "icon-512.png": 512,
    BASE / "icons" / "apple-touch-icon.png": 180,
    BASE / "icons" / "favicon-16.png": 16,
    BASE / "icons" / "favicon-32.png": 32,
    BASE / "brand" / "icon-16.png": 16,
    BASE / "brand" / "icon-32.png": 32,
    BASE / "brand" / "icon-48.png": 48,
    BASE / "brand" / "icon-192.png": 192,
    BASE / "brand" / "icon-512.png": 512,
}

# Splash screens iPhone/iPad — (width, height) format portrait
SPLASH_SIZES = {
    "apple-splash-750-1334.png": (750, 1334),    # iPhone 8, SE
    "apple-splash-828-1792.png": (828, 1792),    # iPhone XR, 11
    "apple-splash-1125-2436.png": (1125, 2436),  # iPhone X, XS, 11 Pro
    "apple-splash-1170-2532.png": (1170, 2532),  # iPhone 12, 13, 14
    "apple-splash-1242-2208.png": (1242, 2208),  # iPhone Plus
    "apple-splash-1242-2688.png": (1242, 2688),  # iPhone XS Max, 11 Pro Max
    "apple-splash-1284-2778.png": (1284, 2778),  # iPhone 12, 13, 14 Pro Max
    "apple-splash-1536-2048.png": (1536, 2048),  # iPad
    "apple-splash-2048-2732.png": (2048, 2732),  # iPad Pro 12.9"
}

print("=== Régénération PWA icons + splash screens ===\n")

# Load source
src = Image.open(SOURCE).convert("RGB")
print(f"✓ Source : {SOURCE.name} {src.size}\n")

# ICONS — resize square du logo source
print("=== Icons PWA / favicon ===")
for path, size in ICON_SIZES.items():
    path.parent.mkdir(parents=True, exist_ok=True)
    resized = src.resize((size, size), Image.LANCZOS)
    resized.save(path, "PNG", optimize=True)
    print(f"✓ {path.relative_to(BASE)} ({size}x{size})")

# FAVICON ICO multi-resolution
favicon_path = BASE / "favicon.ico"
ico_16 = src.resize((16, 16), Image.LANCZOS)
ico_32 = src.resize((32, 32), Image.LANCZOS)
ico_48 = src.resize((48, 48), Image.LANCZOS)
ico_16.save(favicon_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
print(f"✓ favicon.ico (16+32+48)\n")

# SPLASH SCREENS — center du logo sur fond noir aux dimensions iPhone
print("=== Splash screens iOS ===")
SPLASH_DIR = BASE / "splash"
SPLASH_DIR.mkdir(exist_ok=True)

for filename, (w, h) in SPLASH_SIZES.items():
    # Fond noir
    canvas = Image.new("RGB", (w, h), (0, 0, 0))
    # Logo centré, taille = 55% du plus petit côté (impact visuel sans écraser)
    logo_size = int(min(w, h) * 0.55)
    logo = src.resize((logo_size, logo_size), Image.LANCZOS)
    # Position centrée
    x = (w - logo_size) // 2
    y = (h - logo_size) // 2
    canvas.paste(logo, (x, y))
    out_path = SPLASH_DIR / filename
    canvas.save(out_path, "PNG", optimize=True)
    print(f"✓ {filename} ({w}x{h})")

print("\n✅ TERMINÉ")
print("Pense à bumper la version du SW (public/sw.js) + ?v=XX dans manifest.json")
print("pour forcer le refresh du cache PWA sur tous les devices.")
