"""Generación de subtítulos ASS estilo karaoke palabra a palabra (look TikTok)."""
from . import config


def _hex_to_ass(hex_color: str) -> str:
    """#RRGGBB -> &H00BBGGRR (formato de color ASS, sin transparencia)."""
    h = hex_color.lstrip("#")
    if len(h) != 6:
        h = "FFFFFF"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}".upper()


def _fmt_time(t: float) -> str:
    if t < 0:
        t = 0
    cs = int(round(t * 100))
    h = cs // 360000
    cs %= 360000
    m = cs // 6000
    cs %= 6000
    s = cs // 100
    cs %= 100
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _escape(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def _approx_width(text: str, font_size: int) -> float:
    """Ancho aproximado del texto en px (Montserrat Black ~0.62em por carácter)."""
    return len(text) * font_size * 0.60


def _wrap_chunk(chunk: list[dict], font_size: int, max_width: float, upper: bool) -> list[list[dict]]:
    """Reparte las palabras de un bloque en varias líneas que quepan en max_width."""
    lines: list[list[dict]] = []
    current: list[dict] = []
    cur_w = 0.0
    space_w = font_size * 0.32
    for w in chunk:
        txt = w["word"].strip()
        if upper:
            txt = txt.upper()
        ww = _approx_width(txt, font_size)
        add = ww + (space_w if current else 0)
        if current and cur_w + add > max_width:
            lines.append(current)
            current = [w]
            cur_w = ww
        else:
            current.append(w)
            cur_w += add
    if current:
        lines.append(current)
    return lines


def _group_words(words: list[dict], words_per_line: int, max_gap: float) -> list[list[dict]]:
    """Agrupa palabras en bloques (líneas) por número y por silencios."""
    chunks: list[list[dict]] = []
    current: list[dict] = []
    for w in words:
        if not w.get("enabled", True):
            continue
        if not w.get("word", "").strip():
            continue
        if current:
            gap = w["start"] - current[-1]["end"]
            if len(current) >= words_per_line or gap > max_gap:
                chunks.append(current)
                current = []
        current.append(w)
    if current:
        chunks.append(current)
    return chunks


def build_ass(transcript: dict, style: dict, play_w: int, play_h: int) -> str:
    """Construye el contenido del fichero .ass a partir de palabras y estilo."""
    st = {**config.DEFAULT_STYLE, **(style or {})}

    font = st["font"]
    font_size = int(st["font_size"])
    primary = _hex_to_ass(st["primary_color"])
    highlight = _hex_to_ass(st["highlight_color"])
    outline_c = _hex_to_ass(st["outline_color"])
    outline_w = st["outline_width"]
    shadow = st["shadow"]
    margin_h = int(st["margin_h"])
    upper = bool(st["uppercase"])
    active_scale = int(st["active_scale"])
    words_per_line = int(st["words_per_line"])
    max_gap = float(st["max_gap"])
    # Desfase global en segundos (negativo = adelanta los subtítulos)
    offset = float(st.get("time_offset", 0.0) or 0.0)

    # Posición vertical: % de la altura del lienzo
    pos_y = int(play_h * (float(st["position_v"]) / 100.0))
    pos_x = play_w // 2

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {play_w}
PlayResY: {play_h}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,{font},{font_size},{primary},&H000000FF,{outline_c},&H80000000,1,0,0,0,100,100,0,0,1,{outline_w},{shadow},5,{margin_h},{margin_h},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    lines = [header]
    words = (transcript or {}).get("words", []) or []
    chunks = _group_words(words, words_per_line, max_gap)

    pos_tag = f"\\an5\\pos({pos_x},{pos_y})"
    max_width = play_w - 2 * margin_h

    # Aplanar todas las palabras conservando a qué bloque pertenecen y su
    # distribución en líneas. Así cada evento dura exactamente hasta la
    # siguiente palabra (global) y NUNCA se solapan dos bloques en pantalla.
    flat = []  # (word, chunk, wrapped)
    for chunk in chunks:
        wrapped = _wrap_chunk(chunk, font_size, max_width, upper)
        for w in chunk:
            flat.append((w, chunk, wrapped))

    for idx, (w, chunk, wrapped) in enumerate(flat):
        start = w["start"]
        last_in_chunk = w is chunk[-1]
        if idx + 1 < len(flat):
            nxt_start = flat[idx + 1][0]["start"]
            if last_in_chunk and (nxt_start - w["end"]) > max_gap:
                # Hay silencio antes del próximo bloque: no mantener el texto
                end = w["end"] + 0.35
            else:
                end = nxt_start
        else:
            end = w["end"] + 0.35
        if end <= start:
            end = start + 0.08

        # Aplicar el desfase global y proteger límites
        start = max(0.0, start + offset)
        end = max(start + 0.05, end + offset)

        # Renderizar todas las líneas del bloque, resaltando la palabra activa
        line_strs = []
        for line in wrapped:
            parts = []
            for ww in line:
                txt = _escape(ww["word"].strip())
                if upper:
                    txt = txt.upper()
                if ww is w:
                    # Palabra activa: color de resaltado + "pop" de escala
                    parts.append(
                        f"{{\\c{highlight}\\fscx{active_scale}\\fscy{active_scale}}}{txt}{{\\r}}"
                    )
                else:
                    parts.append(txt)
            line_strs.append(" ".join(parts))
        text = "\\N".join(line_strs)
        dialogue = (
            f"Dialogue: 0,{_fmt_time(start)},{_fmt_time(end)},Base,,0,0,0,,"
            f"{{{pos_tag}}}{text}"
        )
        lines.append(dialogue)

    return "\n".join(lines) + "\n"
