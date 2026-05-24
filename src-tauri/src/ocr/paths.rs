use std::path::PathBuf;

use crate::ocr::manifest::MODEL_VERSION;

/// Returns the absolute directory where model files for the pinned
/// `MODEL_VERSION` live. Caller is responsible for ensuring it exists.
pub fn install_dir(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join("ocr").join(MODEL_VERSION)
}

/// Returns the absolute path for a single asset file inside the install dir.
pub fn asset_path(app_data_dir: &std::path::Path, asset_name: &str) -> PathBuf {
    install_dir(app_data_dir).join(asset_name)
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
    fn asset_path_joins_correctly() {
        let p = asset_path(Path::new("/tmp/app"), "det.onnx");
        assert_eq!(p, PathBuf::from("/tmp/app/ocr/1.0.0/det.onnx"));
    }
}
