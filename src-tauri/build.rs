use std::{
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
};

use resvg::{tiny_skia, usvg};

const MENU_ICON_IMAGE_SIZE: u32 = 36;
const LUCIDE_STROKE_WIDTH: f32 = 2.0;
const LUCIDE_GLYPH_SCALE: f32 = 0.8;
const MENU_ICON_OPACITY: f32 = 0.78;
const LUCIDE_LIGHT_STROKE: &str = "#111827";
const LUCIDE_DARK_STROKE: &str = "#e5e7eb";

struct LucideIcon {
    name: &'static str,
    body: &'static str,
}

const LUCIDE_ICONS: &[LucideIcon] = &[
    LucideIcon {
        name: "crop",
        body: r#"<path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" />"#,
    },
    LucideIcon {
        name: "monitor",
        body: r#"<rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" />"#,
    },
    LucideIcon {
        name: "app-window",
        body: r#"<rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 4v4" /><path d="M2 8h20" /><path d="M6 4v4" />"#,
    },
    LucideIcon {
        name: "settings",
        body: r#"<path d="M11 10.27 7 3.34" /><path d="m11 13.73-4 6.93" /><path d="M12 22v-2" /><path d="M12 2v2" /><path d="M14 12h8" /><path d="m17 20.66-1-1.73" /><path d="m17 3.34-1 1.73" /><path d="M2 12h2" /><path d="m20.66 17-1.73-1" /><path d="m20.66 7-1.73 1" /><path d="m3.34 17 1.73-1" /><path d="m3.34 7 1.73 1" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="12" r="8" />"#,
    },
    LucideIcon {
        name: "refresh-cw",
        body: r#"<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />"#,
    },
    LucideIcon {
        name: "info",
        body: r#"<circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />"#,
    },
    LucideIcon {
        name: "circle-x",
        body: r#"<circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />"#,
    },
];

fn main() {
    if let Err(error) = generate_menu_icons() {
        panic!("failed to generate Lucide menu icons: {error}");
    }

    println!("cargo:rerun-if-changed=build.rs");
    tauri_build::build()
}

fn generate_menu_icons() -> Result<(), Box<dyn Error>> {
    let output_dir =
        PathBuf::from(env::var_os("OUT_DIR").ok_or("OUT_DIR is not set")?).join("menu-icons");
    fs::create_dir_all(&output_dir)?;

    for icon in LUCIDE_ICONS {
        render_lucide_icon(
            icon,
            "light",
            LUCIDE_LIGHT_STROKE,
            &output_dir.join(format!("{}-light.png", icon.name)),
        )?;
        render_lucide_icon(
            icon,
            "dark",
            LUCIDE_DARK_STROKE,
            &output_dir.join(format!("{}-dark.png", icon.name)),
        )?;
    }

    Ok(())
}

fn render_lucide_icon(
    icon: &LucideIcon,
    theme_name: &str,
    stroke: &str,
    output_path: &Path,
) -> Result<(), Box<dyn Error>> {
    let svg = lucide_svg(icon, stroke);
    let tree = usvg::Tree::from_data(svg.as_bytes(), &usvg::Options::default())
        .map_err(|error| format!("{} {theme_name} SVG parse failed: {error}", icon.name))?;
    let mut pixmap = tiny_skia::Pixmap::new(MENU_ICON_IMAGE_SIZE, MENU_ICON_IMAGE_SIZE)
        .ok_or("failed to allocate menu icon pixmap")?;

    resvg::render(&tree, tiny_skia::Transform::default(), &mut pixmap.as_mut());
    apply_icon_opacity(&mut pixmap);
    pixmap
        .save_png(output_path)
        .map_err(|error| format!("{} {theme_name} PNG write failed: {error}", icon.name))?;

    Ok(())
}

fn apply_icon_opacity(pixmap: &mut tiny_skia::Pixmap) {
    for channel in pixmap.data_mut() {
        *channel = (*channel as f32 * MENU_ICON_OPACITY).round() as u8;
    }
}

fn lucide_svg(icon: &LucideIcon, stroke: &str) -> String {
    let inset = 12.0 * (1.0 - LUCIDE_GLYPH_SCALE);
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{MENU_ICON_IMAGE_SIZE}" height="{MENU_ICON_IMAGE_SIZE}" viewBox="0 0 24 24" fill="none" stroke="{stroke}" stroke-width="{LUCIDE_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">
  <g transform="translate({inset:.3} {inset:.3}) scale({LUCIDE_GLYPH_SCALE})">
    {body}
  </g>
</svg>
"##,
        body = icon.body
    )
}
