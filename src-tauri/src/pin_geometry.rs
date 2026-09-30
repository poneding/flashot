use serde::{Deserialize, Serialize};

pub const PIN_MIN_SCALE: f64 = 0.5;
pub const PIN_MAX_SCALE: f64 = 3.0;
// Match TOOLBAR_GAP in src/lib/geometry.ts (screenshot toolbars).
const TOOL_GAP: f64 = 4.0;
const HOVER_MARGIN: f64 = 8.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PinRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The gap between the image and its palettes belongs to the same hover area.
/// This changes hit testing only; it never adds transparent native window space.
pub fn pin_interaction_contains_point(
    image: PinRect,
    tools: &[PinRect],
    x: f64,
    y: f64,
    scale: f64,
) -> bool {
    let margin = HOVER_MARGIN * scale;
    std::iter::once(&image).chain(tools).any(|rect| {
        x >= rect.x - margin
            && x <= rect.x + rect.width + margin
            && y >= rect.y - margin
            && y <= rect.y + rect.height + margin
    })
}

#[derive(Clone, Copy, Debug)]
pub struct PinToolWindowState {
    pub rect: PinRect,
    pub parent: PinRect,
    pub side: &'static str,
    pub visible: bool,
}

impl PinToolWindowState {
    /// AppKit moves owned windows with their parent. Compare against that new
    /// position, not the last position we explicitly set, to avoid moving twice.
    pub fn followed_rect(self, parent: PinRect, native_follow: bool) -> PinRect {
        if native_follow && self.visible {
            PinRect {
                x: self.rect.x + parent.x - self.parent.x,
                y: self.rect.y + parent.y - self.parent.y,
                ..self.rect
            }
        } else {
            self.rect
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PinToolKind {
    Controls,
    Editor,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PinToolLayout {
    pub width: f64,
    pub height: f64,
    pub anchor_x: f64,
    pub anchor_y: f64,
    pub anchor_width: f64,
    pub anchor_height: f64,
}

impl PinToolLayout {
    pub fn is_valid(self) -> bool {
        [
            self.width,
            self.height,
            self.anchor_x,
            self.anchor_y,
            self.anchor_width,
            self.anchor_height,
        ]
        .into_iter()
        .all(f64::is_finite)
            && self.width > 0.0
            && self.width <= 8192.0
            && self.height > 0.0
            && self.height <= 8192.0
            && self.anchor_x >= 0.0
            && self.anchor_y >= 0.0
            && self.anchor_width > 0.0
            && self.anchor_height > 0.0
            && self.anchor_x + self.anchor_width <= self.width + 1.0
            && self.anchor_y + self.anchor_height <= self.height + 1.0
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum PinResizeDirection {
    North,
    NorthEast,
    East,
    SouthEast,
    South,
    SouthWest,
    West,
    NorthWest,
}

#[derive(Clone, Copy, Debug)]
pub struct PinResizeSession {
    pub origin: PinRect,
    pub scale: f64,
    pub dpi: f64,
    pub direction: PinResizeDirection,
}

pub fn scaled_image_size(width: u32, height: u32, scale: f64) -> Option<(f64, f64, f64)> {
    if width == 0 || height == 0 || !scale.is_finite() {
        return None;
    }
    let scale = scale.clamp(PIN_MIN_SCALE, PIN_MAX_SCALE);
    Some((
        (width as f64 * scale).max(1.0),
        (height as f64 * scale).max(1.0),
        scale,
    ))
}

/// Keep the opposite corner (or the opposite edge's midpoint) fixed while scaling.
pub fn resize_image(
    session: PinResizeSession,
    original_width: u32,
    original_height: u32,
    dx: f64,
    dy: f64,
) -> Option<(PinRect, f64)> {
    if !dx.is_finite() || !dy.is_finite() || !session.dpi.is_finite() || session.dpi <= 0.0 {
        return None;
    }
    use PinResizeDirection::*;
    let west = matches!(session.direction, West | NorthWest | SouthWest);
    let east = matches!(session.direction, East | NorthEast | SouthEast);
    let north = matches!(session.direction, North | NorthWest | NorthEast);
    let south = matches!(session.direction, South | SouthWest | SouthEast);
    let r = session.origin;
    let dx = dx * session.dpi * if west { -1.0 } else { 1.0 };
    let dy = dy * session.dpi * if north { -1.0 } else { 1.0 };
    let fraction = if (west || east) && (north || south) {
        (dx * r.width + dy * r.height) / (r.width * r.width + r.height * r.height)
    } else if west || east {
        dx / r.width
    } else {
        dy / r.height
    };
    let (width, height, scale) = scaled_image_size(
        original_width,
        original_height,
        session.scale * (1.0 + fraction),
    )?;
    let width = (width * session.dpi).round().max(1.0);
    let height = (height * session.dpi).round().max(1.0);
    Some((
        PinRect {
            x: if west {
                r.x + r.width - width
            } else if east {
                r.x
            } else {
                r.x + (r.width - width) / 2.0
            },
            y: if north {
                r.y + r.height - height
            } else if south {
                r.y
            } else {
                r.y + (r.height - height) / 2.0
            },
            width,
            height,
        },
        scale,
    ))
}

fn overflow(rect: PinRect, work: PinRect) -> f64 {
    (work.x - rect.x).max(0.0)
        + (work.y - rect.y).max(0.0)
        + (rect.x + rect.width - work.x - work.width).max(0.0)
        + (rect.y + rect.height - work.y - work.height).max(0.0)
}

/// Palette dimensions are independent of the image dimensions; clamp to the monitor.
pub fn place_tool_window(
    pin: PinRect,
    work: PinRect,
    layout: PinToolLayout,
    kind: PinToolKind,
    dpi: f64,
) -> (PinRect, &'static str) {
    let width = (layout.width * dpi).ceil().min(work.width).max(1.0);
    let height = (layout.height * dpi).ceil().min(work.height).max(1.0);
    let gap = TOOL_GAP * dpi;
    let ax = layout.anchor_x * dpi;
    let ay = layout.anchor_y * dpi;
    let (mut rect, side) = match kind {
        PinToolKind::Controls => {
            let right = PinRect {
                x: pin.x + pin.width + gap,
                y: pin.y - ay,
                width,
                height,
            };
            let left = PinRect {
                x: pin.x - gap - width,
                ..right
            };
            if overflow(right, work) <= overflow(left, work) {
                (right, "right")
            } else {
                (left, "left")
            }
        }
        PinToolKind::Editor => {
            let below = PinRect {
                x: pin.x + (pin.width - layout.anchor_width * dpi) / 2.0 - ax,
                y: pin.y + pin.height + gap,
                width,
                height,
            };
            let above = PinRect {
                y: pin.y - gap - height,
                ..below
            };
            if overflow(below, work) <= overflow(above, work) {
                (below, "bottom")
            } else {
                (above, "top")
            }
        }
    };
    rect.x = rect.x.clamp(work.x, work.x + work.width - width);
    rect.y = rect.y.clamp(work.y, work.y + work.height - height);
    (rect, side)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hover_includes_sidebar_and_gap_but_not_unrelated_empty_space() {
        let image = PinRect {
            x: 100.0,
            y: 100.0,
            width: 120.0,
            height: 80.0,
        };
        let sidebar = PinRect {
            x: 228.0,
            y: 100.0,
            width: 40.0,
            height: 212.0,
        };
        for (x, y) in [
            (160.0, 140.0),
            (224.0, 140.0),
            (224.0, 280.0),
            (250.0, 300.0),
        ] {
            assert!(pin_interaction_contains_point(image, &[sidebar], x, y, 1.0));
        }
        assert!(!pin_interaction_contains_point(
            image,
            &[sidebar],
            150.0,
            240.0,
            1.0
        ));
        assert!(!pin_interaction_contains_point(
            image,
            &[sidebar],
            300.0,
            150.0,
            1.0
        ));
        // A hidden palette must not hold the controls open at its former bounds.
        assert!(!pin_interaction_contains_point(
            image,
            &[],
            250.0,
            300.0,
            1.0
        ));
    }

    #[test]
    fn hover_includes_flipped_controls_and_a_wide_bottom_palette() {
        let image = PinRect {
            x: 100.0,
            y: 100.0,
            width: 120.0,
            height: 80.0,
        };
        let left = PinRect {
            x: 52.0,
            y: 100.0,
            width: 40.0,
            height: 212.0,
        };
        let bottom = PinRect {
            x: 0.0,
            y: 188.0,
            width: 537.0,
            height: 200.0,
        };
        assert!(pin_interaction_contains_point(
            image,
            &[left],
            96.0,
            140.0,
            1.0
        ));
        assert!(pin_interaction_contains_point(
            image,
            &[bottom],
            160.0,
            184.0,
            1.0
        ));
        assert!(pin_interaction_contains_point(
            image,
            &[bottom],
            500.0,
            350.0,
            1.0
        ));
    }

    #[test]
    fn hover_uses_scaled_gaps_and_negative_monitor_coordinates() {
        let image = PinRect {
            x: -800.0,
            y: 200.0,
            width: 240.0,
            height: 160.0,
        };
        let sidebar = PinRect {
            x: -544.0,
            y: 200.0,
            width: 80.0,
            height: 424.0,
        };
        assert!(pin_interaction_contains_point(
            image,
            &[sidebar],
            -552.0,
            280.0,
            2.0
        ));
        assert!(pin_interaction_contains_point(
            image,
            &[sidebar],
            -552.0,
            580.0,
            2.0
        ));
        assert!(!pin_interaction_contains_point(
            image,
            &[sidebar],
            -600.0,
            420.0,
            2.0
        ));
    }

    #[test]
    fn native_follow_does_not_request_a_second_translation() {
        let parent = PinRect {
            x: 100.0,
            y: 200.0,
            width: 120.0,
            height: 80.0,
        };
        let state = PinToolWindowState {
            rect: PinRect {
                x: 228.0,
                y: 200.0,
                width: 40.0,
                height: 212.0,
            },
            parent,
            side: "right",
            visible: true,
        };
        let moved = PinRect {
            x: 175.0,
            y: 230.0,
            ..parent
        };
        assert_eq!(
            state.followed_rect(moved, true),
            PinRect {
                x: 303.0,
                y: 230.0,
                ..state.rect
            }
        );
        assert_eq!(state.followed_rect(moved, false), state.rect);
        assert_eq!(
            PinToolWindowState {
                visible: false,
                ..state
            }
            .followed_rect(moved, true),
            state.rect
        );
    }

    #[test]
    fn expanded_palette_bounds_stay_outside_the_image_without_flipping_back() {
        let work = PinRect {
            x: 0.0,
            y: 0.0,
            width: 1200.0,
            height: 900.0,
        };
        let pin = PinRect {
            x: 950.0,
            y: 200.0,
            width: 120.0,
            height: 80.0,
        };
        let layout = PinToolLayout {
            width: 280.0,
            height: 250.0,
            anchor_x: 0.0,
            anchor_y: 0.0,
            anchor_width: 40.0,
            anchor_height: 212.0,
        };
        let (before, side) = place_tool_window(pin, work, layout, PinToolKind::Controls, 1.0);
        assert_eq!(side, "left");
        assert!(before.x + before.width < pin.x);
        // Once its popup opens to the left, the anchor moves within the native
        // window. That must not make the placement algorithm flip right again.
        let (after, side) = place_tool_window(
            pin,
            work,
            PinToolLayout {
                anchor_x: 240.0,
                ..layout
            },
            PinToolKind::Controls,
            1.0,
        );
        assert_eq!(side, "left");
        assert_eq!(before, after);
        let (below, side) = place_tool_window(
            pin,
            work,
            PinToolLayout {
                anchor_y: 30.0,
                ..layout
            },
            PinToolKind::Editor,
            1.0,
        );
        assert_eq!(side, "bottom");
        assert!(below.y > pin.y + pin.height);
    }

    fn origin(direction: PinResizeDirection) -> PinResizeSession {
        PinResizeSession {
            origin: PinRect {
                x: 100.0,
                y: 200.0,
                width: 400.0,
                height: 200.0,
            },
            scale: 1.0,
            dpi: 2.0,
            direction,
        }
    }

    #[test]
    fn image_size_has_no_tool_or_shadow_gutters() {
        assert_eq!(scaled_image_size(120, 80, 1.0), Some((120.0, 80.0, 1.0)));
        assert_eq!(scaled_image_size(120, 80, 1.5), Some((180.0, 120.0, 1.5)));
        assert_eq!(scaled_image_size(120, 80, f64::NAN), None);
    }

    #[test]
    fn corner_resize_preserves_ratio_and_opposite_corner_at_retina_scale() {
        let (rect, scale) = resize_image(
            origin(PinResizeDirection::NorthWest),
            200,
            100,
            -100.0,
            -50.0,
        )
        .unwrap();
        assert_eq!(scale, 1.5);
        assert_eq!(
            rect,
            PinRect {
                x: -100.0,
                y: 100.0,
                width: 600.0,
                height: 300.0
            }
        );
    }

    #[test]
    fn horizontal_resize_keeps_opposite_edge_center_and_enforces_scale_limits() {
        let (rect, scale) =
            resize_image(origin(PinResizeDirection::East), 200, 100, 100.0, 50.0).unwrap();
        assert_eq!(scale, 1.5);
        assert_eq!(
            rect,
            PinRect {
                x: 100.0,
                y: 150.0,
                width: 600.0,
                height: 300.0
            }
        );
        let (_, scale) =
            resize_image(origin(PinResizeDirection::East), 200, 100, -1000.0, 0.0).unwrap();
        assert_eq!(scale, PIN_MIN_SCALE);
    }

    #[test]
    fn a_narrow_image_does_not_clip_a_wide_editor_palette() {
        let work = PinRect {
            x: -1280.0,
            y: 30.0,
            width: 1280.0,
            height: 900.0,
        };
        let pin = PinRect {
            x: -1250.0,
            y: 820.0,
            width: 40.0,
            height: 60.0,
        };
        let layout = PinToolLayout {
            width: 550.0,
            height: 100.0,
            anchor_x: 6.0,
            anchor_y: 6.0,
            anchor_width: 538.0,
            anchor_height: 40.0,
        };
        let (rect, _) = place_tool_window(pin, work, layout, PinToolKind::Editor, 1.0);
        assert_eq!(rect.width, 550.0);
        assert!(rect.x >= work.x && rect.x + rect.width <= work.x + work.width);
        assert!(rect.y >= work.y && rect.y + rect.height <= pin.y);
    }

    #[test]
    fn controls_flip_left_at_the_right_monitor_edge() {
        let work = PinRect {
            x: 0.0,
            y: 0.0,
            width: 1000.0,
            height: 700.0,
        };
        let pin = PinRect {
            x: 890.0,
            y: 20.0,
            width: 100.0,
            height: 60.0,
        };
        let layout = PinToolLayout {
            width: 52.0,
            height: 224.0,
            anchor_x: 6.0,
            anchor_y: 6.0,
            anchor_width: 40.0,
            anchor_height: 212.0,
        };
        let (rect, side) = place_tool_window(pin, work, layout, PinToolKind::Controls, 1.0);
        assert_eq!(side, "left");
        assert!(rect.x + rect.width < pin.x);
        assert_eq!(rect.height, 224.0);
    }
}
