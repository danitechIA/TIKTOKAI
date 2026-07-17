"""Configuración: carga .env de forma sencilla (sin dependencias extra)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
PROJECTS_DIR = DATA_DIR / "projects"
FONTS_DIR = BASE_DIR / "fonts"
STATIC_DIR = BASE_DIR / "static"


def _load_env():
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        # No sobreescribir variables ya presentes en el entorno real
        os.environ.setdefault(key, val)


_load_env()

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
TRANSCRIBE_MODEL = os.environ.get("TRANSCRIBE_MODEL", "whisper-large-v3")
CAPTION_MODEL = os.environ.get("CAPTION_MODEL", "llama-3.3-70b-versatile")
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
DEFAULT_LANGUAGE = os.environ.get("DEFAULT_LANGUAGE", "es")

GROQ_BASE = "https://api.groq.com/openai/v1"

# Asegurar carpetas
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


# Estilo por defecto de los subtítulos (todo editable desde la UI)
DEFAULT_STYLE = {
    "font": "Montserrat Black",
    "font_size": 92,            # tamaño a resolución 1080 de ancho
    "primary_color": "#FFFFFF", # color del texto normal (blanco puro)
    "highlight_color": "#FE2C55", # color de la palabra activa
    "outline_color": "#000000", # borde
    "outline_width": 8,
    "shadow": 4,
    "position_v": 62,           # % vertical (0 arriba, 100 abajo)
    "margin_h": 90,             # margen horizontal en px
    "words_per_line": 4,        # palabras visibles por bloque
    "max_gap": 0.7,             # corta bloque si hay silencio mayor (s)
    "uppercase": True,
    "active_scale": 116,        # % de "pop" de la palabra activa
    "active_color_mode": "color", # color | box
    "time_offset": 0.0,         # desfase global en segundos (+/-)
    # Gancho / título inicial (los primeros segundos, para retención)
    "hook_enabled": False,
    "hook_text": "",
    "hook_seconds": 2.5,        # duración del título
    "hook_position": 24,        # % vertical (arriba)
    "hook_size": 120,           # tamaño (a resolución 1080 de ancho)
    "hook_color": "#FFFFFF",
    "hook_sound": "",           # efecto de sonido del gancho ("" = ninguno)
}

SFX_DIR = BASE_DIR / "sfx"
