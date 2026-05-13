use crate::types::{FrozenFrame, MonitorInfo};
use anyhow::Result;

pub fn enumerate_monitors() -> Result<Vec<MonitorInfo>> {
    anyhow::bail!("Screen capture is not yet supported on Linux")
}

pub fn capture_all_monitors() -> Result<(Vec<MonitorInfo>, Vec<FrozenFrame>)> {
    anyhow::bail!("Screen capture is not yet supported on Linux")
}
