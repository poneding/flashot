//! Model release manifest. Flashot fetches a generic asset index from the
//! `flashot-assets` release repository, then accepts only the OCR package id
//! and engine this binary knows how to run.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use serde::Deserialize;

use crate::ocr::types::OcrError;

pub const MODEL_VERSION: &str = "1.0.0";
pub const ASSET_INDEX_RELEASE_API_URL: &str =
    "https://api.github.com/repos/poneding/flashot-assets/releases/tags/asset-index-v1";
pub const ASSET_INDEX_ASSET_NAME: &str = "index.json";
pub const OCR_PACKAGE_ID: &str = "ocr.ppocrv4.zh-en";
pub const OCR_ENGINE: &str = "paddleocr-ppocrv4";
const SCHEMA_VERSION: u32 = 1;
const REQUIRED_OCR_ASSETS: &[&str] = &["det.onnx", "rec.onnx", "ppocr_keys_v1.txt"];

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct AssetSpec {
    pub name: String,
    pub url: String,
    pub sha256: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
}

#[derive(Debug, Deserialize)]
pub struct GitHubRelease {
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
pub struct AssetIndex {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    packages: BTreeMap<String, AssetIndexPackage>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct AssetIndexPackage {
    pub latest: String,
    pub engine: String,
    #[serde(rename = "minAppVersion")]
    pub min_app_version: String,
    #[serde(rename = "manifestUrl")]
    pub manifest_url: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct PackageManifest {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    #[serde(rename = "packageId")]
    pub package_id: String,
    pub version: String,
    pub engine: String,
    #[serde(rename = "minAppVersion")]
    pub min_app_version: String,
    pub assets: Vec<AssetSpec>,
}

impl AssetIndex {
    pub fn supported_ocr_package(&self) -> Result<&AssetIndexPackage, OcrError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(OcrError::ManifestInvalid(format!(
                "unsupported index schema {}",
                self.schema_version
            )));
        }
        let package = self.packages.get(OCR_PACKAGE_ID).ok_or_else(|| {
            OcrError::ManifestInvalid(format!("missing package {OCR_PACKAGE_ID}"))
        })?;
        if package.engine != OCR_ENGINE {
            return Err(OcrError::ManifestInvalid(format!(
                "unsupported OCR engine {}",
                package.engine
            )));
        }
        Ok(package)
    }
}

impl PackageManifest {
    pub fn into_supported_ocr_assets(self) -> Result<Vec<AssetSpec>, OcrError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(OcrError::ManifestInvalid(format!(
                "unsupported package schema {}",
                self.schema_version
            )));
        }
        if self.package_id != OCR_PACKAGE_ID {
            return Err(OcrError::ManifestInvalid(format!(
                "unsupported package {}",
                self.package_id
            )));
        }
        if self.engine != OCR_ENGINE {
            return Err(OcrError::ManifestInvalid(format!(
                "unsupported OCR engine {}",
                self.engine
            )));
        }

        let names: BTreeSet<&str> = self
            .assets
            .iter()
            .map(|asset| asset.name.as_str())
            .collect();
        for required in REQUIRED_OCR_ASSETS {
            if !names.contains(required) {
                return Err(OcrError::ManifestInvalid(format!(
                    "missing OCR asset {required}",
                )));
            }
        }
        for asset in &self.assets {
            validate_asset(asset)?;
        }

        Ok(self.assets)
    }
}

pub fn required_asset_names() -> &'static [&'static str] {
    REQUIRED_OCR_ASSETS
}

pub fn total_size_bytes(assets: &[AssetSpec]) -> u64 {
    assets.iter().map(|a| a.size_bytes).sum()
}

pub fn index_url_from_release(release: &GitHubRelease) -> Result<&str, OcrError> {
    release
        .assets
        .iter()
        .find(|asset| asset.name == ASSET_INDEX_ASSET_NAME)
        .map(|asset| asset.browser_download_url.as_str())
        .ok_or_else(|| {
            OcrError::ManifestInvalid("latest asset release is missing index.json".into())
        })
}

pub async fn fetch_supported_ocr_package() -> Result<PackageManifest, OcrError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Flashot")
        .build()
        .map_err(|e| OcrError::DownloadFailed(e.to_string()))?;

    let release: GitHubRelease = fetch_json(&client, ASSET_INDEX_RELEASE_API_URL).await?;
    let index_url = index_url_from_release(&release)?.to_string();
    let index: AssetIndex = fetch_json(&client, &index_url).await?;
    let package = index.supported_ocr_package()?.clone();
    let manifest: PackageManifest = fetch_json(&client, &package.manifest_url).await?;
    manifest.clone().into_supported_ocr_assets()?;
    Ok(manifest)
}

async fn fetch_json<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
) -> Result<T, OcrError> {
    let bytes = client
        .get(url)
        .send()
        .await
        .map_err(|e| OcrError::DownloadFailed(e.to_string()))?
        .error_for_status()
        .map_err(|e| OcrError::DownloadFailed(e.to_string()))?
        .bytes()
        .await
        .map_err(|e| OcrError::DownloadFailed(e.to_string()))?;
    serde_json::from_slice(&bytes).map_err(|e| OcrError::ManifestInvalid(e.to_string()))
}

fn validate_asset(asset: &AssetSpec) -> Result<(), OcrError> {
    if asset.name.trim().is_empty() {
        return Err(OcrError::ManifestInvalid("asset name is empty".into()));
    }
    if asset.url.trim().is_empty() {
        return Err(OcrError::ManifestInvalid(format!(
            "{} URL is empty",
            asset.name
        )));
    }
    if asset.size_bytes == 0 {
        return Err(OcrError::ManifestInvalid(format!(
            "{} sizeBytes must be positive",
            asset.name
        )));
    }
    if asset.sha256.len() != 64 || !asset.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(OcrError::ManifestInvalid(format!(
            "{} sha256 must be 64 hex characters",
            asset.name
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latest_release_finds_index_asset_download_url() {
        let body = r#"{
          "assets": [
            { "name": "readme.txt", "browser_download_url": "https://example.test/readme.txt" },
            { "name": "index.json", "browser_download_url": "https://example.test/index.json" }
          ]
        }"#;

        let release: GitHubRelease = serde_json::from_str(body).unwrap();

        assert_eq!(
            index_url_from_release(&release).unwrap(),
            "https://example.test/index.json",
        );
    }

    #[test]
    fn asset_index_selects_supported_ocr_package() {
        let body = r#"{
          "schemaVersion": 1,
          "packages": {
            "ocr.ppocrv4.zh-en": {
              "latest": "1.0.0",
              "engine": "paddleocr-ppocrv4",
              "minAppVersion": "0.4.0",
              "manifestUrl": "https://example.test/manifest.json"
            }
          }
        }"#;

        let index: AssetIndex = serde_json::from_str(body).unwrap();
        let package = index.supported_ocr_package().unwrap();

        assert_eq!(package.latest, "1.0.0");
        assert_eq!(package.manifest_url, "https://example.test/manifest.json");
    }

    #[test]
    fn package_manifest_validates_required_ocr_assets() {
        let body = r#"{
          "schemaVersion": 1,
          "packageId": "ocr.ppocrv4.zh-en",
          "version": "1.0.0",
          "engine": "paddleocr-ppocrv4",
          "minAppVersion": "0.4.0",
          "assets": [
            {
              "name": "det.onnx",
              "url": "https://example.test/det.onnx",
              "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "sizeBytes": 3
            },
            {
              "name": "rec.onnx",
              "url": "https://example.test/rec.onnx",
              "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "sizeBytes": 4
            },
            {
              "name": "ppocr_keys_v1.txt",
              "url": "https://example.test/ppocr_keys_v1.txt",
              "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              "sizeBytes": 5
            }
          ]
        }"#;

        let manifest: PackageManifest = serde_json::from_str(body).unwrap();
        let assets = manifest.into_supported_ocr_assets().unwrap();

        assert_eq!(assets.len(), 3);
        assert_eq!(assets[0].name, "det.onnx");
        assert_eq!(total_size_bytes(&assets), 12);
    }

    #[test]
    fn package_manifest_rejects_incompatible_engine() {
        let body = r#"{
          "schemaVersion": 1,
          "packageId": "ocr.ppocrv4.zh-en",
          "version": "1.0.0",
          "engine": "other-engine",
          "minAppVersion": "0.4.0",
          "assets": []
        }"#;

        let manifest: PackageManifest = serde_json::from_str(body).unwrap();

        assert!(manifest.into_supported_ocr_assets().is_err());
    }
}
