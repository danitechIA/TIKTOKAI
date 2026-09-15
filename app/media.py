"""Utilidades de medios: probe del vídeo y extracción de audio (ffmpeg/ffprobe)."""
import json
import subprocess
from pathlib import Path


def _rotation(stream: dict) -> int:
    """Extrae la rotación (grados) de side_data o tags. Los vídeos de iPhone
    en vertical se almacenan como 1920x1080 + rotación 90/270."""
    rot = 0
    # Nuevo formato: side_data_list -> rotation
    for sd in stream.get("side_data_list", []) or []:
        if "rotation" in sd:
            try:
                rot = int(sd["rotation"])
            except Exception:
                pass
    # Formato antiguo: tags.rotate
    tags = stream.get("tags") or {}
    if rot == 0 and "rotate" in tags:
        try:
            rot = int(tags["rotate"])
        except Exception:
            pass
    return abs(rot) % 360


def probe_video(path: str | Path) -> dict:
    """Devuelve metadatos del vídeo: ancho, alto (ya orientados), duración, fps, tamaño."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_streams", "-show_format",
        "-of", "json", str(path),
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise RuntimeError(f"ffprobe falló: {out.stderr[:300]}")
    data = json.loads(out.stdout)
    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}
    fps = 0.0
    rate = stream.get("r_frame_rate", "0/1")
    try:
        num, den = rate.split("/")
        fps = round(float(num) / float(den), 2) if float(den) else 0.0
    except Exception:
        fps = 0.0

    w = int(stream.get("width") or 0)
    h = int(stream.get("height") or 0)
    # Si el vídeo está rotado 90/270, el tamaño mostrado lleva ancho/alto intercambiados
    if _rotation(stream) in (90, 270):
        w, h = h, w

    return {
        "width": w,
        "height": h,
        "duration": round(float(fmt.get("duration") or 0), 2),
        "fps": fps,
        "size_bytes": int(fmt.get("size") or 0),
    }


def make_proxy(video_path: str | Path, proxy_path: str | Path):
    """Genera el vídeo de trabajo para el editor (NO afecta al render final).

    Un .mov de iPhone son ~15 Mbps: para reproducirlo el navegador tiene que
    bajar ~1,9 MB por cada segundo, y en cada salto de posición vacía el búfer
    y vuelve a empezar. De ahí los tirones y las esperas largas al dar al play.

    El proxy baja a 480p / 30 fps / ~800 kbps (unas 20 veces menos datos) y,
    sobre todo, mete un fotograma clave por segundo: así saltar por la línea
    de tiempo es instantáneo en vez de tener que decodificar medio vídeo.
    """
    cmd = [
        "nice", "-n", "15", "ffmpeg", "-y", "-i", str(video_path),
        "-vf", "scale=480:-2:flags=fast_bilinear,fps=30",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
        "-profile:v", "baseline", "-level", "3.1",   # el perfil que todo móvil decodifica
        "-g", "30", "-keyint_min", "30", "-sc_threshold", "0",
        "-c:a", "aac", "-b:a", "96k", "-ac", "1",
        "-movflags", "+faststart",
        str(proxy_path),
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if out.returncode != 0:
        raise RuntimeError(f"Proxy falló: {out.stderr[-300:]}")
    return proxy_path


def make_strip(video_path: str | Path, strip_path: str | Path, duration: float, tiles: int = 40):
    """Tira de miniaturas en una sola imagen (mosaico horizontal).

    Antes el navegador generaba las miniaturas descargando el vídeo entero y
    haciendo decenas de saltos: en el móvil eso competía con la reproducción.
    Aquí se hace una vez en el servidor y el cliente baja un JPEG de ~60 KB.
    """
    duration = max(float(duration or 0), 0.1)
    fps = tiles / duration          # un fotograma por cada tramo
    cmd = [
        "nice", "-n", "15", "ffmpeg", "-y", "-i", str(video_path),
        "-vf", f"fps={fps:.6f},scale=54:96:force_original_aspect_ratio=increase,"
               f"crop=54:96,tile={tiles}x1",
        "-frames:v", "1", "-q:v", "5",
        str(strip_path),
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if out.returncode != 0:
        raise RuntimeError(f"Tira de miniaturas falló: {out.stderr[-300:]}")
    return strip_path


def extract_audio(video_path: str | Path, audio_path: str | Path):
    """Extrae audio mono 16kHz mp3 (ligero) para enviar a la transcripción."""
    cmd = [
        "nice", "-n", "15", "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "libmp3lame", "-q:a", "5",
        str(audio_path),
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        raise RuntimeError(f"Extracción de audio falló: {out.stderr[-300:]}")
    return audio_path
