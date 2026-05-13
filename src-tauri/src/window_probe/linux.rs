use crate::types::WindowRect;
use anyhow::Result;

pub fn enumerate() -> Result<Vec<WindowRect>> {
    anyhow::bail!("Window enumeration is not yet supported on Linux")
}
