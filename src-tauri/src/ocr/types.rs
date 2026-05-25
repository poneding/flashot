use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OcrResult {
    pub full_text: String,
    pub lines: Vec<OcrLine>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OcrLine {
    pub text: String,
    pub bbox: TextBox,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextBox {
    pub points: [(f32, f32); 4],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OcrInstallStatus {
    NotInstalled,
    Installed { size_bytes: u64 },
}

#[derive(Debug, thiserror::Error)]
pub enum OcrError {
    #[error("model not installed")]
    ModelNotInstalled,
    #[error("model load failed: {0}")]
    ModelLoadFailed(String),
    #[error("inference failed: {0}")]
    InferenceFailed(String),
    #[error("download failed: {0}")]
    DownloadFailed(String),
    #[error("asset manifest invalid: {0}")]
    ManifestInvalid(String),
    #[error("checksum mismatch for {asset}: expected {expected}, got {got}")]
    ChecksumMismatch {
        asset: String,
        expected: String,
        got: String,
    },
    #[error("cancelled")]
    Cancelled,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ocr_result_roundtrip() {
        let r = OcrResult {
            full_text: "hello".into(),
            lines: vec![OcrLine {
                text: "hello".into(),
                bbox: TextBox {
                    points: [(0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (0.0, 5.0)],
                },
                confidence: 0.9,
            }],
            elapsed_ms: 123,
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: OcrResult = serde_json::from_str(&json).unwrap();
        assert_eq!(r, back);
    }

    #[test]
    fn install_status_tagged_serialisation() {
        let s = OcrInstallStatus::Installed { size_bytes: 1234 };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"kind\":\"installed\""));
        assert!(json.contains("\"size_bytes\":1234"));

        let not = OcrInstallStatus::NotInstalled;
        let json = serde_json::to_string(&not).unwrap();
        assert_eq!(json, r#"{"kind":"not_installed"}"#);
    }
}
