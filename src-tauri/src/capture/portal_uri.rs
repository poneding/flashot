use anyhow::{anyhow, bail, Context, Result};
use std::path::PathBuf;

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn portal_screenshot_uri_to_path(uri: &str) -> Result<PathBuf> {
    let rest = uri
        .strip_prefix("file://")
        .ok_or_else(|| anyhow!("Portal screenshot URI is not a local file URI: {uri}"))?;

    let path = if let Some(path) = rest.strip_prefix('/') {
        format!("/{path}")
    } else if let Some(path) = rest.strip_prefix("localhost/") {
        format!("/{path}")
    } else {
        let authority = rest.split('/').next().unwrap_or(rest);
        bail!("Portal screenshot URI has unsupported file URI authority `{authority}`: {uri}");
    };

    let decoded = urlencoding::decode(&path)
        .with_context(|| format!("Portal screenshot URI path is not valid UTF-8: {uri}"))?;
    Ok(PathBuf::from(decoded.into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portal_file_uri_decodes_to_local_path() {
        let path = portal_screenshot_uri_to_path("file:///tmp/Flashot%20Shot.png").unwrap();

        assert_eq!(path, PathBuf::from("/tmp/Flashot Shot.png"));
    }

    #[test]
    fn portal_file_uri_accepts_localhost_authority() {
        let path = portal_screenshot_uri_to_path("file://localhost/tmp/shot.png").unwrap();

        assert_eq!(path, PathBuf::from("/tmp/shot.png"));
    }

    #[test]
    fn portal_file_uri_rejects_non_local_authority() {
        let err = portal_screenshot_uri_to_path("file://remotehost/tmp/shot.png").unwrap_err();

        assert!(err.to_string().contains("unsupported file URI authority"));
    }

    #[test]
    fn portal_file_uri_rejects_non_file_schemes() {
        let err = portal_screenshot_uri_to_path("document://portal/screenshot").unwrap_err();

        assert!(err.to_string().contains("not a local file URI"));
    }
}
