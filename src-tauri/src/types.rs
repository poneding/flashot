use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    pub fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x
            && px < self.x + self.width as i32
            && py >= self.y
            && py < self.y + self.height as i32
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowRect {
    pub rect: Rect,
    pub title: String,
    #[serde(rename = "appName")]
    pub app_name: String,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: u32,
    pub rect: Rect,
    #[serde(rename = "scaleFactor")]
    pub scale_factor: f32,
}

#[derive(Debug, Clone)]
pub struct FrozenFrame {
    pub monitor_id: u32,
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub icc_profile: Option<Vec<u8>>,
}
