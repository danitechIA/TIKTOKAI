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
