"""
Generate UsageWatch app icon at all required sizes.

Design: A rounded-square dark background with a stylized gauge meter.
The gauge arc transitions from cyan (#38BDF8) to amber (#F59E0B),
with a needle and tick marks. A small "eye" dot in the center
suggests "watching." Clean, modern, recognizable at 16px.
"""

import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import struct
import os

def lerp_color(c1, c2, t):
    """Linear interpolate between two RGB tuples."""
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))

def draw_icon(size):
    """Draw the UsageWatch icon at the given pixel size."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = size / 2, size / 2
    margin = size * 0.06
    radius = size / 2 - margin
    corner_r = size * 0.22  # rounded square corner radius

    # --- Background: dark rounded square with subtle gradient ---
    bg_top = (15, 23, 42)       # slate-900
    bg_bot = (30, 41, 59)       # slate-800
    # Draw rounded rect background
    for y in range(size):
        t = y / max(size - 1, 1)
        color = lerp_color(bg_top, bg_bot, t)
        for x in range(size):
            # Check if point is inside rounded rect
            rx, ry = x, y
            # Distance from edges
            in_rect = True
            corners = [
                (margin + corner_r, margin + corner_r),                    # top-left
                (size - margin - corner_r, margin + corner_r),             # top-right
                (margin + corner_r, size - margin - corner_r),             # bottom-left
                (size - margin - corner_r, size - margin - corner_r),      # bottom-right
            ]
            if rx < margin + corner_r and ry < margin + corner_r:
                # top-left corner
                dist = math.hypot(rx - corners[0][0], ry - corners[0][1])
                if dist > corner_r:
                    in_rect = False
            elif rx > size - margin - corner_r and ry < margin + corner_r:
                dist = math.hypot(rx - corners[1][0], ry - corners[1][1])
                if dist > corner_r:
                    in_rect = False
            elif rx < margin + corner_r and ry > size - margin - corner_r:
                dist = math.hypot(rx - corners[2][0], ry - corners[2][1])
                if dist > corner_r:
                    in_rect = False
            elif rx > size - margin - corner_r and ry > size - margin - corner_r:
                dist = math.hypot(rx - corners[3][0], ry - corners[3][1])
                if dist > corner_r:
                    in_rect = False
            elif rx < margin or rx > size - margin or ry < margin or ry > size - margin:
                in_rect = False

            if in_rect:
                img.putpixel((x, y), (*color, 255))

    # --- Gauge arc ---
    gauge_cx, gauge_cy = cx, cy * 1.08  # slightly below center
    gauge_r = size * 0.32
    arc_width = max(size * 0.07, 2)

    # Arc from 210 degrees to -30 degrees (240 degree sweep, bottom-open gauge)
    start_angle = 210
    end_angle = -30
    total_sweep = 240

    # Colors: cyan -> green -> amber
    color_cyan = (56, 189, 248)     # #38BDF8
    color_green = (52, 211, 153)    # #34D399
    color_amber = (245, 158, 11)    # #F59E0B
    color_red = (239, 68, 68)       # #EF4444

    # Draw arc with gradient - many small segments
    segments = max(int(size * 1.5), 120)
    for i in range(segments):
        t = i / segments
        angle_deg = start_angle - t * total_sweep
        angle_rad = math.radians(angle_deg)
        next_angle_deg = start_angle - (i + 1) / segments * total_sweep
        next_angle_rad = math.radians(next_angle_deg)

        # Color gradient: cyan -> green -> amber -> red
        if t < 0.33:
            color = lerp_color(color_cyan, color_green, t / 0.33)
        elif t < 0.66:
            color = lerp_color(color_green, color_amber, (t - 0.33) / 0.33)
        else:
            color = lerp_color(color_amber, color_red, (t - 0.66) / 0.34)

        x1 = gauge_cx + gauge_r * math.cos(angle_rad)
        y1 = gauge_cy - gauge_r * math.sin(angle_rad)
        x2 = gauge_cx + gauge_r * math.cos(next_angle_rad)
        y2 = gauge_cy - gauge_r * math.sin(next_angle_rad)

        draw.line([(x1, y1), (x2, y2)], fill=(*color, 255), width=max(int(arc_width), 1))

    # Draw rounded end caps for the arc
    for t_val, cap_color_t in [(0, 0), (1, 1)]:
        angle_deg = start_angle - cap_color_t * total_sweep
        angle_rad = math.radians(angle_deg)
        cap_x = gauge_cx + gauge_r * math.cos(angle_rad)
        cap_y = gauge_cy - gauge_r * math.sin(angle_rad)
        cap_r = arc_width / 2
        if cap_color_t < 0.33:
            cap_color = lerp_color(color_cyan, color_green, cap_color_t / 0.33)
        elif cap_color_t < 0.66:
            cap_color = lerp_color(color_green, color_amber, (cap_color_t - 0.33) / 0.33)
        else:
            cap_color = lerp_color(color_amber, color_red, (cap_color_t - 0.66) / 0.34)
        draw.ellipse(
            [cap_x - cap_r, cap_y - cap_r, cap_x + cap_r, cap_y + cap_r],
            fill=(*cap_color, 255)
        )

    # --- Tick marks ---
    tick_count = 9
    tick_inner_r = gauge_r + arc_width * 0.8
    tick_outer_r = gauge_r + arc_width * 1.6
    tick_width = max(int(size * 0.015), 1)

    for i in range(tick_count):
        t = i / (tick_count - 1)
        angle_deg = start_angle - t * total_sweep
        angle_rad = math.radians(angle_deg)

        if t < 0.33:
            tick_color = lerp_color(color_cyan, color_green, t / 0.33)
        elif t < 0.66:
            tick_color = lerp_color(color_green, color_amber, (t - 0.33) / 0.33)
        else:
            tick_color = lerp_color(color_amber, color_red, (t - 0.66) / 0.34)

        # Make ticks semi-transparent
        alpha = 140

        tx1 = gauge_cx + tick_inner_r * math.cos(angle_rad)
        ty1 = gauge_cy - tick_inner_r * math.sin(angle_rad)
        tx2 = gauge_cx + tick_outer_r * math.cos(angle_rad)
        ty2 = gauge_cy - tick_outer_r * math.sin(angle_rad)

        draw.line([(tx1, ty1), (tx2, ty2)], fill=(*tick_color, alpha), width=tick_width)

    # --- Needle ---
    # Needle pointing at ~65% usage (leaning toward amber)
    needle_t = 0.65
    needle_angle_deg = start_angle - needle_t * total_sweep
    needle_angle_rad = math.radians(needle_angle_deg)

    needle_len = gauge_r * 0.75
    needle_tip_x = gauge_cx + needle_len * math.cos(needle_angle_rad)
    needle_tip_y = gauge_cy - needle_len * math.sin(needle_angle_rad)

    # Needle base (small circle at center)
    needle_base_r = max(size * 0.035, 2)
    # Needle color: white with slight glow
    needle_color = (255, 255, 255, 240)

    # Draw needle as a tapered line
    needle_width = max(int(size * 0.025), 1)
    draw.line(
        [(gauge_cx, gauge_cy), (needle_tip_x, needle_tip_y)],
        fill=needle_color,
        width=needle_width
    )

    # Needle center dot
    draw.ellipse(
        [gauge_cx - needle_base_r, gauge_cy - needle_base_r,
         gauge_cx + needle_base_r, gauge_cy + needle_base_r],
        fill=(255, 255, 255, 255)
    )

    # --- "UW" text or subtle branding below gauge ---
    # Small subtle text below the gauge center
    text_y = gauge_cy + gauge_r * 0.45
    dot_r = max(size * 0.015, 1)

    # Three small dots representing the three providers (Claude/Codex/Cursor)
    dot_spacing = size * 0.06
    dots = [
        (cx - dot_spacing, text_y, color_cyan),
        (cx, text_y, color_green),
        (cx + dot_spacing, text_y, color_amber),
    ]
    for dx, dy, dc in dots:
        draw.ellipse(
            [dx - dot_r, dy - dot_r, dx + dot_r, dy + dot_r],
            fill=(*dc, 200)
        )

    # --- Subtle outer glow ring ---
    glow_r = size * 0.44
    glow_width = max(int(size * 0.01), 1)
    # Very subtle ring
    draw.arc(
        [cx - glow_r, cy - glow_r, cx + glow_r, cy + glow_r],
        0, 360,
        fill=(56, 189, 248, 25),
        width=glow_width
    )

    return img


def create_ico(images, path):
    """Create an ICO file from a list of PIL Images."""
    # ICO format: header + directory entries + image data
    num = len(images)
    # Header: 3 x uint16 (reserved=0, type=1, count)
    header = struct.pack('<HHH', 0, 1, num)

    # We'll store each image as PNG inside the ICO
    png_data_list = []
    for img in images:
        import io
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        png_data_list.append(buf.getvalue())

    # Directory entries are 16 bytes each
    dir_offset = 6 + num * 16  # after header + all dir entries
    entries = b''
    current_offset = dir_offset

    for i, img in enumerate(images):
        w = img.width if img.width < 256 else 0
        h = img.height if img.height < 256 else 0
        data_size = len(png_data_list[i])
        entry = struct.pack('<BBBBHHII',
            w, h,           # width, height (0 means 256)
            0,              # color palette
            0,              # reserved
            1,              # color planes
            32,             # bits per pixel
            data_size,      # size of image data
            current_offset  # offset of image data
        )
        entries += entry
        current_offset += data_size

    with open(path, 'wb') as f:
        f.write(header)
        f.write(entries)
        for data in png_data_list:
            f.write(data)


def main():
    icon_dir = "src-tauri/icons"
    os.makedirs(icon_dir, exist_ok=True)

    # Generate master icon at high resolution
    master_size = 1024
    master = draw_icon(master_size)

    # Save main icon.png (1024x1024 used as source)
    master.save(os.path.join(icon_dir, "icon.png"))
    print(f"  icon.png (1024x1024)")

    # Generate all required sizes
    png_sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
    }

    for filename, sz in png_sizes.items():
        resized = master.resize((sz, sz), Image.LANCZOS)
        resized.save(os.path.join(icon_dir, filename))
        print(f"  {filename} ({sz}x{sz})")

    # Windows Square logos
    square_sizes = {
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
    }
    for filename, sz in square_sizes.items():
        resized = master.resize((sz, sz), Image.LANCZOS)
        resized.save(os.path.join(icon_dir, filename))
        print(f"  {filename} ({sz}x{sz})")

    # StoreLogo
    resized = master.resize((50, 50), Image.LANCZOS)
    resized.save(os.path.join(icon_dir, "StoreLogo.png"))
    print(f"  StoreLogo.png (50x50)")

    # ICO file (multiple sizes embedded)
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_images = [master.resize((s, s), Image.LANCZOS) for s in ico_sizes]
    ico_path = os.path.join(icon_dir, "icon.ico")
    create_ico(ico_images, ico_path)
    print(f"  icon.ico ({', '.join(str(s) for s in ico_sizes)})")

    # ICNS file - pure Python writer (no iconutil needed)
    # ICNS uses PNG-compressed entries for modern sizes
    icns_entries = [
        (b'ic07', 128),    # 128x128
        (b'ic08', 256),    # 256x256
        (b'ic09', 512),    # 512x512
        (b'ic10', 1024),   # 1024x1024 (512@2x)
        (b'ic11', 32),     # 16x16@2x
        (b'ic12', 64),     # 32x32@2x
        (b'ic13', 256),    # 128x128@2x
        (b'ic14', 512),    # 256x256@2x
    ]
    icns_path = os.path.join(icon_dir, "icon.icns")
    import io
    chunks = []
    for ostype, sz in icns_entries:
        resized = master.resize((sz, sz), Image.LANCZOS)
        buf = io.BytesIO()
        resized.save(buf, format='PNG')
        png_bytes = buf.getvalue()
        # Each chunk: 4-byte type + 4-byte length (including header) + data
        chunk_len = 8 + len(png_bytes)
        chunks.append(struct.pack('>4sI', ostype, chunk_len) + png_bytes)

    all_chunks = b''.join(chunks)
    total_len = 8 + len(all_chunks)  # 'icns' header + length + all chunks
    with open(icns_path, 'wb') as f:
        f.write(struct.pack('>4sI', b'icns', total_len))
        f.write(all_chunks)
    print(f"  icon.icns (pure Python, {len(icns_entries)} entries)")

    print("\nDone! All icons generated.")


if __name__ == "__main__":
    main()
