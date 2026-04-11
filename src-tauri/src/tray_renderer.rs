use rusttype::{Font, Scale, point};
use tiny_skia::{Pixmap, Color};

use crate::models::{TrayFormat, UsageData};

fn color_u8(r: u8, g: u8, b: u8, a: u8) -> Color {
    Color::from_rgba(
        r as f32 / 255.0,
        g as f32 / 255.0,
        b as f32 / 255.0,
        a as f32 / 255.0,
    )
    .unwrap_or(Color::WHITE)
}

const SCALE: f32 = 2.0; // Retina 2x
const HEIGHT: f32 = 22.0;
const LABEL_SIZE: f32 = 10.0;
const VALUE_SIZE: f32 = 13.0;
const TIMER_SIZE: f32 = 10.0;
const PADDING: f32 = 2.0;
const SEP_MARGIN: f32 = 6.0;

static FONT_MEDIUM: &[u8] = include_bytes!("../fonts/Inter-Medium.ttf");
static FONT_BOLD: &[u8] = include_bytes!("../fonts/Inter-Bold.ttf");

fn usage_color(pct: f64) -> Color {
    if pct >= 90.0 {
        color_u8(239, 68, 68, 255) // red
    } else if pct >= 75.0 {
        color_u8(245, 158, 11, 255) // orange
    } else {
        color_u8(34, 197, 94, 255) // green
    }
}

fn label_color() -> Color {
    // Light gray for labels — works on dark menu bar
    color_u8(160, 160, 170, 255)
}

fn timer_color() -> Color {
    color_u8(140, 140, 150, 255)
}

fn sep_color() -> Color {
    color_u8(100, 100, 110, 120)
}

struct TextSegment {
    text: String,
    color: Color,
    size: f32,
    bold: bool,
}

fn format_countdown(resets_at: &str) -> String {
    let reset = match chrono::DateTime::parse_from_rfc3339(resets_at) {
        Ok(dt) => dt,
        Err(_) => return String::new(),
    };
    let now = chrono::Utc::now();
    let diff = reset.signed_duration_since(now);
    if diff.num_seconds() <= 0 {
        return "now".to_string();
    }
    let hours = diff.num_hours();
    let minutes = diff.num_minutes() % 60;
    if hours >= 48 {
        let days = hours / 24;
        let rem = hours % 24;
        format!("{}d{}h", days, rem)
    } else if hours > 0 {
        format!("{}h{}m", hours, minutes)
    } else {
        format!("{}m", minutes)
    }
}

fn build_segments(data: &UsageData, format: &TrayFormat) -> Vec<Vec<TextSegment>> {
    let mut groups: Vec<Vec<TextSegment>> = Vec::new();

    // Session group
    if format.show_session_pct || format.show_session_timer {
        if let Some(ref fh) = data.five_hour {
            let mut segs = Vec::new();
            if format.show_session_pct {
                segs.push(TextSegment {
                    text: "S ".to_string(),
                    color: label_color(),
                    size: LABEL_SIZE,
                    bold: false,
                });
                segs.push(TextSegment {
                    text: format!("{}%", fh.utilization.round() as i32),
                    color: usage_color(fh.utilization),
                    size: VALUE_SIZE,
                    bold: true,
                });
            }
            if format.show_session_timer {
                if let Some(ref reset) = fh.resets_at {
                    let cd = format_countdown(reset);
                    if !cd.is_empty() {
                        segs.push(TextSegment {
                            text: format!(" {}", cd),
                            color: timer_color(),
                            size: TIMER_SIZE,
                            bold: false,
                        });
                    }
                }
            }
            if !segs.is_empty() {
                groups.push(segs);
            }
        }
    }

    // Weekly group
    if format.show_weekly_pct || format.show_weekly_timer {
        if let Some(ref sd) = data.seven_day {
            let mut segs = Vec::new();
            if format.show_weekly_pct {
                segs.push(TextSegment {
                    text: "W ".to_string(),
                    color: label_color(),
                    size: LABEL_SIZE,
                    bold: false,
                });
                segs.push(TextSegment {
                    text: format!("{}%", sd.utilization.round() as i32),
                    color: usage_color(sd.utilization),
                    size: VALUE_SIZE,
                    bold: true,
                });
            }
            if format.show_weekly_timer {
                if let Some(ref reset) = sd.resets_at {
                    let cd = format_countdown(reset);
                    if !cd.is_empty() {
                        segs.push(TextSegment {
                            text: format!(" {}", cd),
                            color: timer_color(),
                            size: TIMER_SIZE,
                            bold: false,
                        });
                    }
                }
            }
            if !segs.is_empty() {
                groups.push(segs);
            }
        }
    }

    // Sonnet
    if format.show_sonnet_pct {
        if let Some(ref ss) = data.seven_day_sonnet {
            if ss.utilization > 0.0 {
                groups.push(vec![
                    TextSegment { text: "So ".to_string(), color: label_color(), size: LABEL_SIZE, bold: false },
                    TextSegment { text: format!("{}%", ss.utilization.round() as i32), color: usage_color(ss.utilization), size: VALUE_SIZE, bold: true },
                ]);
            }
        }
    }

    // Opus
    if format.show_opus_pct {
        if let Some(ref op) = data.seven_day_opus {
            if op.utilization > 0.0 {
                groups.push(vec![
                    TextSegment { text: "Op ".to_string(), color: label_color(), size: LABEL_SIZE, bold: false },
                    TextSegment { text: format!("{}%", op.utilization.round() as i32), color: usage_color(op.utilization), size: VALUE_SIZE, bold: true },
                ]);
            }
        }
    }

    // Extra usage
    if format.show_extra_usage {
        if let Some(ref eu) = data.extra_usage {
            if eu.is_enabled {
                groups.push(vec![
                    TextSegment {
                        text: format!("${}/{}", (eu.used_credits / 100.0).round() as i32, (eu.monthly_limit / 100.0).round() as i32),
                        color: color_u8(139, 92, 246, 255), // purple
                        size: VALUE_SIZE,
                        bold: false,
                    },
                ]);
            }
        }
    }

    groups
}

fn measure_segment_width(seg: &TextSegment, font_medium: &Font, font_bold: &Font) -> f32 {
    let font = if seg.bold { font_bold } else { font_medium };
    let scale = Scale::uniform(seg.size * SCALE);
    let glyphs: Vec<_> = font.layout(&seg.text, scale, point(0.0, 0.0)).collect();
    glyphs.last().map(|g| {
        let pos = g.position();
        pos.x + g.unpositioned().h_metrics().advance_width
    }).unwrap_or(0.0)
}

pub fn render_tray_image(data: &UsageData, format: &TrayFormat) -> Option<Vec<u8>> {
    let font_medium = Font::try_from_bytes(FONT_MEDIUM)?;
    let font_bold = Font::try_from_bytes(FONT_BOLD)?;

    let groups = build_segments(data, format);
    if groups.is_empty() {
        return None;
    }

    // Calculate total width
    let mut total_width: f32 = PADDING * SCALE;
    for (i, group) in groups.iter().enumerate() {
        if i > 0 {
            total_width += SEP_MARGIN * 2.0 * SCALE + 1.0; // separator + margins
        }
        for seg in group {
            total_width += measure_segment_width(seg, &font_medium, &font_bold);
        }
    }
    total_width += PADDING * SCALE;

    let pixel_height = (HEIGHT * SCALE) as u32;
    let pixel_width = total_width.ceil().max(1.0) as u32;

    let mut pixmap = Pixmap::new(pixel_width.max(1), pixel_height.max(1))?;
    // Transparent background

    let mut x = PADDING * SCALE;
    let baseline_y = HEIGHT * SCALE * 0.72; // approximate baseline

    for (i, group) in groups.iter().enumerate() {
        // Draw separator line before each group (except first)
        if i > 0 {
            x += SEP_MARGIN * SCALE;
            // Draw separator line manually (fill_rect crashes on hairlines)
            let sep_x = x.round() as u32;
            let sep_top = (4.0 * SCALE) as u32;
            let sep_bottom = ((HEIGHT - 4.0) * SCALE) as u32;
            let sc = sep_color();
            let sr = (sc.red() * 255.0) as u8;
            let sg = (sc.green() * 255.0) as u8;
            let sb = (sc.blue() * 255.0) as u8;
            let sa = (sc.alpha() * 255.0) as u8;
            let data = pixmap.data_mut();
            for py in sep_top..sep_bottom {
                if sep_x < pixel_width && py < pixel_height {
                    let idx = (py * pixel_width + sep_x) as usize * 4;
                    if idx + 3 < data.len() {
                        let a = sa as f32 / 255.0;
                        data[idx] = (sr as f32 * a) as u8;
                        data[idx + 1] = (sg as f32 * a) as u8;
                        data[idx + 2] = (sb as f32 * a) as u8;
                        data[idx + 3] = sa;
                    }
                }
            }
            x += 2.0 + SEP_MARGIN * SCALE;
        }

        for seg in group {
            let font = if seg.bold { &font_bold } else { &font_medium };
            let scale = Scale::uniform(seg.size * SCALE);
            let glyphs = font.layout(&seg.text, scale, point(x, baseline_y));

            for glyph in glyphs {
                if let Some(bb) = glyph.pixel_bounding_box() {
                    glyph.draw(|gx, gy, v| {
                        let px_i = bb.min.x + gx as i32;
                        let py_i = bb.min.y + gy as i32;
                        if px_i < 0 || py_i < 0 { return; }
                        let px = px_i as u32;
                        let py = py_i as u32;
                        if px < pixel_width && py < pixel_height {
                            let alpha = (v * seg.color.alpha() * 255.0) as u8;
                            if alpha > 0 {
                                let idx = (py * pixel_width + px) as usize * 4;
                                let data = pixmap.data_mut();
                                if idx + 3 < data.len() {
                                    let a = alpha as f32 / 255.0;
                                    data[idx] = (seg.color.red() * 255.0 * a) as u8;
                                    data[idx + 1] = (seg.color.green() * 255.0 * a) as u8;
                                    data[idx + 2] = (seg.color.blue() * 255.0 * a) as u8;
                                    data[idx + 3] = alpha;
                                }
                            }
                        }
                    });
                }
            }

            x += measure_segment_width(seg, &font_medium, &font_bold);
        }
    }

    pixmap.encode_png().ok()
}
