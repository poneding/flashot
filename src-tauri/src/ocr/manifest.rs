//! Model release manifest. Bound to a single Flashot binary version.
//!
//! To bump the model: publish a new GitHub Release, update the constants in
//! this file (URLs, sha256, sizes, MODEL_VERSION), and ship a new app release.

pub const MODEL_VERSION: &str = "1.0.0";

pub struct AssetSpec {
    pub name: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
}

// IMPORTANT: These URLs and hashes are PLACEHOLDERS for the future official
// release at `ocr-models-v1.0.0`. Until that release exists, local development
// pre-populates the install dir; the download path will not be exercised
// against these URLs. When the release is cut, fill these in with real values.
pub const ASSETS: &[AssetSpec] = &[
    AssetSpec {
        name: "det.onnx",
        url: "https://github.com/poneding/flashot/releases/download/ocr-models-v1.0.0/det.onnx",
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        size_bytes: 4_700_000,
    },
    AssetSpec {
        name: "rec.onnx",
        url: "https://github.com/poneding/flashot/releases/download/ocr-models-v1.0.0/rec.onnx",
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        size_bytes: 10_300_000,
    },
    AssetSpec {
        name: "ppocr_keys_v1.txt",
        url: "https://github.com/poneding/flashot/releases/download/ocr-models-v1.0.0/ppocr_keys_v1.txt",
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        size_bytes: 30_000,
    },
];

pub fn total_size_bytes() -> u64 {
    ASSETS.iter().map(|a| a.size_bytes).sum()
}
