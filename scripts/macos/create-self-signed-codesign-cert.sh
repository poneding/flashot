#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  cat <<'EOF'
Usage: CERT_PASSWORD=<password> scripts/macos/create-self-signed-codesign-cert.sh <output.p12> [identity]

Creates a fixed self-signed macOS code-signing certificate for release builds.
Keep the generated .p12 and password private; reuse the same certificate for
future releases so macOS sees the app as the same signing identity.
EOF
  exit 0
fi

OUTPUT_PATH="${1:-}"
IDENTITY="${2:-Flashot Local Code Signing}"

if [ -z "$OUTPUT_PATH" ]; then
  echo "error: output .p12 path is required" >&2
  exit 1
fi

if [ -z "${CERT_PASSWORD:-}" ]; then
  echo "error: CERT_PASSWORD is required" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "error: openssl is required" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

CONFIG_PATH="$TMP_DIR/codesign.cnf"
KEY_PATH="$TMP_DIR/codesign.key.pem"
CERT_PATH="$TMP_DIR/codesign.cert.pem"

cat > "$CONFIG_PATH" <<EOF
[ req ]
distinguished_name = dn
x509_extensions = v3_req
prompt = no

[ dn ]
CN = $IDENTITY

[ v3_req ]
basicConstraints = critical,CA:TRUE
keyUsage = critical,digitalSignature,keyCertSign
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
EOF

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -nodes \
  -days 3650 \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH" \
  -config "$CONFIG_PATH" >/dev/null 2>&1

openssl pkcs12 \
  -export \
  -legacy \
  -inkey "$KEY_PATH" \
  -in "$CERT_PATH" \
  -name "$IDENTITY" \
  -out "$OUTPUT_PATH" \
  -passout "pass:$CERT_PASSWORD" >/dev/null 2>&1

echo "Created $OUTPUT_PATH"
echo
echo "Add these GitHub repository secrets:"
echo "MACOS_CODESIGN_IDENTITY=$IDENTITY"
echo "MACOS_CODESIGN_CERTIFICATE_PASSWORD=<the CERT_PASSWORD value you entered>"
echo "MACOS_CODESIGN_CERTIFICATE:"
base64 -i "$OUTPUT_PATH" | tr -d '\n'
echo
