//! Model download. Each asset is fetched into a `*.partial` temp file,
//! sha256-verified, then atomically renamed into the install dir. Failures
//! and cancellation leave no partial files behind.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::ocr::manifest::AssetSpec;
use crate::ocr::types::OcrError;

/// Download a single asset to `install_dir/<asset.name>`. The function:
/// 1. Streams the response body into `<asset.name>.partial`.
/// 2. Computes sha256 incrementally.
/// 3. On checksum match, atomically renames `.partial` to the final name.
/// 4. On any error or cancel, removes the `.partial` file.
///
/// `on_chunk` is invoked with `(bytes_just_read, total_bytes_for_this_asset)`
/// after each chunk so the caller can aggregate progress across assets.
pub async fn download_one(
    asset: &AssetSpec,
    install_dir: &Path,
    cancel: Arc<AtomicBool>,
    on_chunk: &dyn Fn(u64, u64),
) -> Result<(), OcrError> {
    let final_path: PathBuf = install_dir.join(asset.name);
    let partial_path: PathBuf = install_dir.join(format!("{}.partial", asset.name));

    fs::create_dir_all(install_dir).await?;
    // Pre-clean any stale partial file from a previous interrupted run.
    let _ = fs::remove_file(&partial_path).await;

    let result = async {
        let response = reqwest::get(asset.url)
            .await
            .map_err(|e| OcrError::DownloadFailed(e.to_string()))?
            .error_for_status()
            .map_err(|e| OcrError::DownloadFailed(e.to_string()))?;

        let mut file = fs::File::create(&partial_path).await?;
        let mut hasher = Sha256::new();
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                return Err(OcrError::Cancelled);
            }
            let bytes = chunk.map_err(|e| OcrError::DownloadFailed(e.to_string()))?;
            hasher.update(&bytes);
            file.write_all(&bytes).await?;
            on_chunk(bytes.len() as u64, asset.size_bytes);
        }
        file.flush().await?;
        drop(file);

        let digest = hex::encode(hasher.finalize());
        if digest != asset.sha256 {
            return Err(OcrError::ChecksumMismatch {
                asset: asset.name.into(),
                expected: asset.sha256.into(),
                got: digest,
            });
        }

        fs::rename(&partial_path, &final_path).await?;
        Ok(())
    }
    .await;

    if result.is_err() {
        let _ = fs::remove_file(&partial_path).await;
    }
    result
}

/// Aggregated progress callback signature.
pub type ProgressFn = Arc<dyn Fn(u64, u64) + Send + Sync>;

/// Download every asset in `assets` into `install_dir` sequentially. Progress
/// is reported as `(total_downloaded_bytes, grand_total_bytes)`. Sequential
/// (not concurrent) keeps the implementation simple and avoids hammering the
/// GitHub Release CDN — total bytes are small enough that parallel download
/// wouldn't save measurable time anyway.
///
/// On any failure or cancel, all `*.partial` files are already cleaned up by
/// `download_one`. Successfully-installed siblings are **not** rolled back —
/// the caller can call `uninstall_version` if a clean wipe is needed.
pub async fn download_all(
    assets: &[AssetSpec],
    install_dir: &Path,
    cancel: Arc<AtomicBool>,
    on_progress: ProgressFn,
) -> Result<(), OcrError> {
    let grand_total: u64 = assets.iter().map(|a| a.size_bytes).sum();
    let downloaded = Arc::new(AtomicU64::new(0));

    for asset in assets {
        let downloaded = downloaded.clone();
        let on_progress = on_progress.clone();
        download_one(asset, install_dir, cancel.clone(), &move |chunk, _per_asset_total| {
            let now = downloaded.fetch_add(chunk, Ordering::Relaxed) + chunk;
            on_progress(now, grand_total);
        })
        .await?;
    }
    Ok(())
}

/// Delete an old install directory. Used to clean up after a successful
/// upgrade. Non-fatal: silently swallows errors so upgrade flows keep going.
pub async fn uninstall_version(version_dir: &Path) {
    let _ = fs::remove_dir_all(version_dir).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn make_asset(server: &MockServer, name: &'static str, body: &[u8]) -> (AssetSpec, String) {
        let digest = hex::encode(Sha256::digest(body));
        let url: &'static str = Box::leak(format!("{}/{}", server.uri(), name).into_boxed_str());
        let sha: &'static str = Box::leak(digest.clone().into_boxed_str());
        (
            AssetSpec { name, url, sha256: sha, size_bytes: body.len() as u64 },
            digest,
        )
    }

    #[tokio::test]
    async fn success_writes_final_file_and_removes_partial() {
        let server = MockServer::start().await;
        let body = b"hello world".to_vec();
        let (asset, _digest) = make_asset(&server, "test.bin", &body);
        Mock::given(method("GET"))
            .and(path("/test.bin"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(body.clone()))
            .mount(&server)
            .await;

        let tmp = tempfile::tempdir().unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        download_one(&asset, tmp.path(), cancel, &|_, _| {}).await.unwrap();

        let final_path = tmp.path().join("test.bin");
        let partial = tmp.path().join("test.bin.partial");
        assert!(final_path.exists());
        assert!(!partial.exists());
        assert_eq!(fs::read(&final_path).await.unwrap(), body);
    }

    #[tokio::test]
    async fn checksum_mismatch_leaves_no_files() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/bad.bin"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"bad".to_vec()))
            .mount(&server)
            .await;
        let url: &'static str = Box::leak(format!("{}/bad.bin", server.uri()).into_boxed_str());
        // 64-char hex string that won't match Sha256("bad")
        let bad_sha: &'static str = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
        let asset = AssetSpec {
            name: "bad.bin",
            url,
            sha256: bad_sha,
            size_bytes: 3,
        };

        let tmp = tempfile::tempdir().unwrap();
        let err = download_one(&asset, tmp.path(), Arc::new(AtomicBool::new(false)), &|_, _| {})
            .await
            .unwrap_err();
        assert!(matches!(err, OcrError::ChecksumMismatch { .. }));
        assert!(!tmp.path().join("bad.bin").exists());
        assert!(!tmp.path().join("bad.bin.partial").exists());
    }

    #[tokio::test]
    async fn cancel_during_stream_leaves_no_files() {
        let server = MockServer::start().await;
        // Large body, delay each chunk so the cancel can fire.
        Mock::given(method("GET"))
            .and(path("/slow.bin"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_bytes(vec![0u8; 1_000_000])
                    .set_delay(std::time::Duration::from_millis(200)),
            )
            .mount(&server)
            .await;
        let (asset, _) = make_asset(&server, "slow.bin", &vec![0u8; 1_000_000]);

        let tmp = tempfile::tempdir().unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_clone = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            cancel_clone.store(true, Ordering::Relaxed);
        });

        let err = download_one(&asset, tmp.path(), cancel, &|_, _| {}).await.unwrap_err();
        assert!(matches!(err, OcrError::Cancelled));
        assert!(!tmp.path().join("slow.bin").exists());
        assert!(!tmp.path().join("slow.bin.partial").exists());
    }

    #[tokio::test]
    async fn download_all_aggregates_progress() {
        let server = MockServer::start().await;
        let body_a = b"aaaa".to_vec(); // 4 bytes
        let body_b = b"bbbbbbbb".to_vec(); // 8 bytes
        let (asset_a, _) = make_asset(&server, "a.bin", &body_a);
        let (asset_b, _) = make_asset(&server, "b.bin", &body_b);
        Mock::given(method("GET")).and(path("/a.bin"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(body_a.clone()))
            .mount(&server).await;
        Mock::given(method("GET")).and(path("/b.bin"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(body_b.clone()))
            .mount(&server).await;

        let tmp = tempfile::tempdir().unwrap();
        let progress_log: Arc<std::sync::Mutex<Vec<(u64, u64)>>> = Arc::default();
        let log = progress_log.clone();
        let progress: ProgressFn = Arc::new(move |done, total| {
            log.lock().unwrap().push((done, total));
        });

        download_all(
            &[asset_a, asset_b],
            tmp.path(),
            Arc::new(AtomicBool::new(false)),
            progress,
        ).await.unwrap();

        let log = progress_log.lock().unwrap();
        assert!(!log.is_empty());
        assert_eq!(log.iter().map(|(_, t)| *t).max().unwrap(), 12);
        assert_eq!(log.last().unwrap().0, 12);
    }
}
