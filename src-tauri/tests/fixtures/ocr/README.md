# OCR test fixtures

PNG screenshots used by `tests/ocr_integration.rs`. These are NOT committed
to git initially — engineers create them locally to verify OCR works on real
images. CI cannot run these tests because (a) no model files installed and
(b) no fixtures.

## Required files

- `english_code.png` — a snippet of source code in a monospace font, English
  only. Must contain at least one `fn` token.
- `chinese_ui.png` — a Chinese-language UI screenshot. Must contain at least
  one common token like `设置` or `文件`.
- `mixed_zh_en.png` — interleaved Chinese and English content (any).

Keep dimensions under 1500px on the long edge so tests run quickly.

## How to populate

Take screenshots, crop tightly, save as PNG with the names above in this
directory. They will then be picked up by:

    cd src-tauri && cargo test --test ocr_integration -- --ignored

Add an entry to `.gitignore` if you don't want to track them.
