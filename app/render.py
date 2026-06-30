"""Renderizado: quema los subtítulos ASS sobre el vídeo con ffmpeg.

Normaliza el ancho a 1080 (manteniendo proporción vertical) y deprioriza
la CPU con nice/ionice para no competir con TradingAI.
"""
import subprocess
import time
from pathlib import Path

from . import config, media
from .subtitles import build_ass

TARGET_WIDTH = 1080


def _even(n: int) -> int:
    return n if n % 2 == 0 else n + 1


def render_project(proj: dict) -> dict:
    pid = proj["id"]
    pdir = config.PROJECTS_DIR / pid
    source = proj.get("source")
    if not source or not source.get("path"):
        raise RuntimeError("El proyecto no tiene vídeo de origen")
    if not proj.get("transcript"):
        raise RuntimeError("Hay que transcribir antes de renderizar")

    src_path = source["path"]
    src_w = source.get("width") or 1080
    src_h = source.get("height") or 1920

    # Escalar a 1080 de ancho manteniendo proporción
    play_w = TARGET_WIDTH
    play_h = _even(int(round(TARGET_WIDTH * src_h / max(src_w, 1))))

    # Generar el .ass con las dimensiones del lienzo final
    ass_content = build_ass(proj["transcript"], proj.get("style") or {}, play_w, play_h)
    ass_path = pdir / "subs.ass"
    ass_path.write_text(ass_content, encoding="utf-8")

    out_path = pdir / "output.mp4"

    # Escapar la ruta del .ass para el filtro de ffmpeg
    ass_filter_path = str(ass_path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    fonts_dir = str(config.FONTS_DIR).replace("\\", "/").replace(":", "\\:")

    # Cap a 30fps: TikTok no necesita más y reduce a la mitad el coste de render
    vf = (
        f"scale={play_w}:{play_h}:flags=lanczos,fps=30,"
        f"ass='{ass_filter_path}':fontsdir='{fonts_dir}'"
    )

    cmd = [
        "nice", "-n", "15", "ionice", "-c2", "-n7",
        "ffmpeg", "-y", "-i", src_path,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(out_path),
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg render falló: {proc.stderr[-500:]}")

    info = media.probe_video(out_path)
    return {
        "path": str(out_path),
        "width": play_w,
        "height": play_h,
        "size_bytes": info.get("size_bytes", out_path.stat().st_size),
        "duration": info.get("duration"),
        "rendered_at": time.time(),
    }
