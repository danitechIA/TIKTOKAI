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


def render_project(proj: dict, progress_cb=None) -> dict:
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

    # Generar el .ass con las dimensiones del lienzo final (subtítulos + títulos)
    ass_content = build_ass(
        proj["transcript"], proj.get("style") or {}, play_w, play_h,
        titles=proj.get("titles"),
    )
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

    # Recopilar TODOS los eventos de sonido: pista de sonidos + sonidos de títulos.
    # Cada uno se mezcla en su instante exacto (adelay) sin bajar la voz.
    sound_events = []
    for s in (proj.get("sounds") or []):
        name = (s.get("sfx") or "").strip()
        if name:
            sound_events.append((name, max(0.0, float(s.get("t", 0) or 0))))
    for t in (proj.get("titles") or []):
        name = (t.get("sound") or "").strip()
        if name:
            sound_events.append((name, max(0.0, float(t.get("start", 0) or 0))))

    resolved = []
    for name, at in sound_events:
        fname = name if name.endswith(".mp3") else name + ".mp3"
        cand = config.SFX_DIR / fname
        if cand.exists():
            resolved.append((str(cand), at))

    base = ["nice", "-n", "15", "ionice", "-c2", "-n7", "ffmpeg", "-y", "-i", src_path]
    if resolved:
        for path, _ in resolved:
            base += ["-i", path]
        parts = [f"[0:v]{vf}[v]"]
        mix_in = "[0:a]"
        for k, (_, at) in enumerate(resolved):
            ms = int(round(at * 1000))
            parts.append(f"[{k + 1}:a]adelay={ms}|{ms},volume=0.8[s{k}]")
            mix_in += f"[s{k}]"
        parts.append(
            f"{mix_in}amix=inputs={len(resolved) + 1}:duration=first:"
            f"dropout_transition=0:normalize=0[a]"
        )
        io = ["-filter_complex", ";".join(parts), "-map", "[v]", "-map", "[a]"]
    else:
        io = ["-vf", vf]

    cmd = base + io + [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-progress", "pipe:1", "-nostats",
        str(out_path),
    ]

    # Duración total para calcular el % de progreso
    duration = float((proj.get("source") or {}).get("duration") or 0)
    err_log = pdir / "render.log"

    with open(err_log, "w") as errf:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=errf, text=True)
        try:
            for line in proc.stdout:
                line = line.strip()
                if line.startswith("out_time_us=") and duration > 0 and progress_cb:
                    try:
                        us = int(line.split("=", 1)[1])
                        pct = max(0, min(99, us / 1e6 / duration * 100))
                        progress_cb(round(pct))
                    except Exception:
                        pass
        finally:
            proc.wait(timeout=1800)

    if proc.returncode != 0:
        tail = err_log.read_text(errors="ignore")[-500:] if err_log.exists() else ""
        raise RuntimeError(f"ffmpeg render falló: {tail}")
    if progress_cb:
        progress_cb(100)

    info = media.probe_video(out_path)
    return {
        "path": str(out_path),
        "width": play_w,
        "height": play_h,
        "size_bytes": info.get("size_bytes", out_path.stat().st_size),
        "duration": info.get("duration"),
        "rendered_at": time.time(),
    }
