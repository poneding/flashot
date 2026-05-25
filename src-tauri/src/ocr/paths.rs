use std::path::PathBuf;

use crate::ocr::manifest::MODEL_VERSION;

const ACTIVE_VERSION_FILE: &str = "current-version.txt";

pub fn root_dir(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join("ocr")
}

/// Returns the absolute directory where model files for the pinned
/// `MODEL_VERSION` live. Caller is responsible for ensuring it exists.
pub fn install_dir(app_data_dir: &std::path::Path) -> PathBuf {
    let version = active_model_version(app_data_dir).unwrap_or_else(|| MODEL_VERSION.to_string());
    install_dir_for_version(app_data_dir, &version)
}

pub fn install_dir_for_version(app_data_dir: &std::path::Path, version: &str) -> PathBuf {
    root_dir(app_data_dir).join(version)
}

/// Returns the absolute path for a single asset file inside the install dir.
pub fn asset_path(app_data_dir: &std::path::Path, asset_name: &str) -> PathBuf {
    install_dir(app_data_dir).join(asset_name)
}

pub fn active_version_path(app_data_dir: &std::path::Path) -> PathBuf {
    root_dir(app_data_dir).join(ACTIVE_VERSION_FILE)
}

pub fn active_model_version(app_data_dir: &std::path::Path) -> Option<String> {
    let text = std::fs::read_to_string(active_version_path(app_data_dir)).ok()?;
    let version = text.trim();
    (!version.is_empty()).then(|| version.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn install_dir_includes_version() {
        let p = install_dir(Path::new("/tmp/app"));
        assert_eq!(p, PathBuf::from("/tmp/app/ocr/1.0.0"));
    }

    #[test]
    fn install_dir_for_version_uses_package_version() {
        let p = install_dir_for_version(Path::new("/tmp/app"), "1.2.3");
        assert_eq!(p, PathBuf::from("/tmp/app/ocr/1.2.3"));
    }

    #[test]
    fn asset_path_joins_correctly() {
        let p = asset_path(Path::new("/tmp/app"), "det.onnx");
        assert_eq!(p, PathBuf::from("/tmp/app/ocr/1.0.0/det.onnx"));
    }
}
